# 15 — pi-web 可视化多用户验证（多租户并发实践 UI）

**What to build:** 为真实环境多用户/多住户并发验证提供一个可视化交互界面：把 `@agegr/pi-web`（pi 的 Web UI）容器化，每测试用户一个实例（挂该用户 PVC），各自访问自己的界面，可视化观察真实 pi 的多实例并发、隔离与续接行为。

**Blocked by:** 01 — pi 沙箱容器镜像（容器化基底经验）

**Status:** ready-for-agent

**背景:** 调研见 `docs/research/pi-web-visual-multiuser.md`。pi-web 0.8.6 进程内 SDK 驱动 pi（依赖 pi 0.83.0 = 与平台锁定版本一致）；无 Dockerfile；Basic Auth 单密码。方案 A（每用户实例直连，无改造）为首选，方案 B（fork 改造为网关客户端）记入后续。

- [ ] pi-web 容器镜像（node:24-bookworm-slim 基底，锁版本安装 pi-web@0.8.6，非 root，暴露 30141，PI_CODING_AGENT_DIR 指向挂载点）
- [ ] 每测试用户一个实例：挂载该用户 `.pi/agent`（含已播种 models.json）与 workspace；端口/域名矩阵编排（compose 或脚本）
- [ ] 用户 A/B/C 各自登录（Basic Auth 各实例独立密码），各自看到自己的会话/文件/记忆，互不可见（多租户隔离可视化）
- [ ] 多用户并发操作：A/B 同时发请求互不干扰；每实例续接既有会话（跨进程续接验证）
- [ ] 界面配置联动：用户在 pi-web 改模型/thinking，写回该用户 PVC 的 models.json，不影响他用户（配置隔离）
- [ ] 网关路径评估（后续项）：fork pi-web 将 agent 驱动层换为网关客户端（SSE/WS + Bearer token）——需另立 ticket，本 ticket 不做
