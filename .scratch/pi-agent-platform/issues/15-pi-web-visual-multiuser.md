# 15 — pi-web 可视化多用户验证（多租户并发实践 UI）

**What to build:** 为真实环境多用户/多住户并发验证提供一个可视化交互界面：把 `@agegr/pi-web`（pi 的 Web UI）容器化，每测试用户一个实例（挂该用户 PVC），各自访问自己的界面，可视化观察真实 pi 的多实例并发、隔离与续接行为。

**Blocked by:** 01 — pi 沙箱容器镜像（容器化基底经验）

**Status:** done（dev 分支实现，commit 见下）

**背景:** 调研见 `docs/research/pi-web-visual-multiuser.md`。pi-web 0.8.6 进程内 SDK 驱动 pi（依赖 pi 0.83.0 = 与平台锁定版本一致）；无 Dockerfile；Basic Auth 单密码。方案 A（每用户实例直连，无改造）为首选，方案 B（fork 改造为网关客户端）记入后续。

- [x] pi-web 容器镜像（node:24-bookworm-slim 基底，锁版本安装 pi-web@0.8.6，非 root，暴露 30141，PI_CODING_AGENT_DIR 指向挂载点）→ `deploy/docker/Dockerfile.piweb` + `scripts/build-piweb.mjs`（1.11GB，npm 包内含 .next 构建产物，无需运行时构建）
- [x] 每测试用户一个实例：挂载该用户 `.pi/agent`（含已播种 models.json）与 workspace；端口/域名矩阵编排（compose 或脚本）→ `scripts/run-piweb.mjs`（start/stop/status/seed；端口矩阵 30141+ 序号；密码 `poweri-<user>` 可经 `POWERI_PIWEB_PASSWORD_<USER>` 覆盖）
- [x] 用户 A/B/C 各自登录（Basic Auth 各实例独立密码），各自看到自己的会话/文件/记忆，互不可见（多租户隔离可视化）→ verify-15 Part A（无认证/错密码 401、各自密码 200、跨实例 401）
- [x] 多用户并发操作：A/B 同时发请求互不干扰；每实例续接既有会话（跨进程续接验证）→ verify-15 Part C（alice+bob 同时对话 1760ms，红队/蓝队互不混淆）+ Part D（docker restart 后同会话追问 zebra 命中）
- [x] 界面配置联动：用户在 pi-web 改模型/thinking，写回该用户 PVC 的 models.json，不影响他用户（配置隔离）→ verify-15 Part E（PUT /api/models-config 落盘各自 models.json，bob 不受影响）
- [ ] 网关路径评估（后续项）：fork pi-web 将 agent 驱动层换为网关客户端（SSE/WS + Bearer token）——需另立 ticket（已立 ticket 17），本 ticket 不做

## Comments

- 2026-08-01 实现（dev 分支）：镜像 `Dockerfile.piweb` + `build-piweb.mjs`；编排 `run-piweb.mjs`；验证 `verify-15.mjs` 全通过（A 认证隔离 / B 数据隔离 / C 并发 1760ms / D 重启续接 zebra / E 配置隔离）。
- **实证发现（pi 0.83 会话布局）**：pi-web 经 SessionManager 把会话写在 `sessions/<slug>/<时间戳>_<sessionId>.jsonl`（嵌套 + 前缀），与网关 `--session <path>` 显式指定的顶层 `sessions/<id>.jsonl` 不同——平台续接不受影响（路径由网关显式指定，verify-06/k8s 已验证）；pi-web 侧按其规范布局即可。
- **实证发现（agent/new API）**：body 需带 `type:"ensure_session"` 才只建运行时返回 sessionId；`prompt` 为 fire-and-forget，回复走 `/api/agent/[id]/events` SSE，结束事件 `prompt_done`。
