# 10 — 云端部署闭环（harbor 正式镜像 + k3s 部署 + 云端冒烟）

**What to build:** 让部署闭环：本地验证基线 → monorepo 部署物补齐（web Dockerfile / manifest 归位）→ 正式镜像推送 harbor → 云端 k3s 部署 → 云端全链路冒烟。CI 流水线为后续迭代（本次交付可重复的手动脚本）。

**Status:** resolved

## 完成内容

### 1. 本地验证基线
- `verify-33-local-e2e.mjs` 修复脆弱断言：`session_created` id 前缀 `/^msr/` 是 T07 实测时的时间戳 36 进制巧合（`gateway/store.mjs newSessionId = Date.now().toString(36)-uuid8`，前缀随日期变化）→ 改为格式校验。**13/13 PASS**。
- 环境注记：本机 docker.io 不可达（registry mirror 未生效），worker 镜像从 harbor 拉取 trial1 复用（与云端同源）。

### 2. monorepo 部署物补齐（此前缺失，部署闭环硬缺口）
- **`web/Dockerfile`（新增）**：多阶段自包含构建（builder npm ci + next build；runtime 只拷产物），对齐云端 trial1 运行时（piuser 非 root、PI_OFFLINE、next start -p 30141）。
- **`web/deploy/k8s/poweri-web.yaml`（新增）**：自描述 manifest（Deployment + NodePort 30341，探针/资源/securityContext 对齐云端已验证配置）。
- **`web/.dockerignore`（新增）**：排除 node_modules/.next 等，控制构建上下文。
- **`scripts/gen-k8s.mjs`**：`WEB_DIR` 从旧仓库路径（/Users/tianzhao/code/leoao/poweri-web）改为 monorepo `web/`（ticket 04-06 遗留）。
- **生产构建修复（部署暴露的真问题）**：`web/lib/session-reader.ts:76` 类型断言错误 + `gatewaySessionToInfo` 返回类型标宽 → 生产 `next build` 编译失败（dev 模式不报，T04-07 未覆盖）。改为返回 `SessionInfo` 类型。
- **`web/package-lock.json` 同步**：适配层新增 eventsource-parser 后 lock 未更新，npm ci 严格校验失败。

### 3. 正式镜像 + harbor
- 三镜像构建（本机，基础镜像经 docker.1ms.run mirror 显式拉取绕过 docker.io 不可达），推 harbor：`harbor.litta.cn/poweri/{poweri-gateway,poweri-web,poweri-worker}:20260814`。

### 4. 云端部署（litta-llms-gw 118.178.241.158，k3s 单节点）
- **`scripts/deploy-cloud.mjs`（新增）**：渲染 manifest → scp → kubectl apply → 滚动更新 worker → rollout 等待 → 冒烟。
- 部署结果：gateway / poweri-web / worker-bob / worker-carol 全部运行 20260814 镜像。
- **网络排障记录**：k3s 节点拉 harbor 超时（harbor 走阿里云 ALB 118.178.34.101，节点不可达；26h 前 trial1 部署时可拉，ALB 来源限制或网络变化）。兜底方案：本机 docker save → scp → 节点 `ctr -n k8s.io images import`（镜像落本地后 IfNotPresent 不拉取）。

### 5. 云端全链路验证
- **`scripts/verify-34-cloud-e2e.mjs`（新增）**：ssh 隧道（NodePort 安全组未全放行）→ 同 verify-33 断言集。
- **13/13 PASS**（认证守卫 / 新建会话 / 事件流完整含工具调用 / 流式真实回复 / 历史续接 / 多用户隔离）。
- 排障记录：bob 断言最初假设"列表为空"，云端 bob 有历史会话（trial1 时代）→ 改为"列表不含 alice 会话"（隔离语义更准）。
- **动态开通路径**：worker-alice 缩容 0 后 verify-34 自动拉起并完整跑通（ticket 32 闭环在正式镜像下验证）。

## 验证结果汇总

| 验证 | 结果 |
|---|---|
| verify-33 本地全链路（web dev → gateway docker → worker 容器 → 真实模型） | 13/13 PASS |
| web 生产构建（next build，类型修复后） | PASS |
| 三镜像 harbor 推送 + 节点导入 | PASS（digest 一致） |
| verify-34 云端全链路（热 worker） | 13/13 PASS |
| verify-34 云端全链路（动态开通，worker 0 副本拉起） | 13/13 PASS |

## 已知问题 / 后续

- **harbor ALB 从 k3s 节点不可达**：部署脚本依赖 ctr import 兜底；建议运维放行 ALB 来源（节点出口 IP）后走正常拉取。
- **NodePort 公网**：30341（web）可达，31080（gateway）被安全组挡 → 内网访问或 ssh 隧道（verify-34 内置）。建议按需放行。
- **gitlab CI 流水线**（spec out of scope 项）：本次交付手动脚本（deploy-cloud + verify-34），CI 化（构建/推送/部署/冒烟）为下一步。
- **温池**（ADR-0004）：首次动态开通含冷启动，本次实测镜像预热后动态拉起正常；如需首请求低延迟可后续启用温池。
- 本机 `~/.docker/config.json` 为 WSL 遗留（wincred credsStore 不可用），构建/推送需 `DOCKER_CONFIG` 指向干净配置（scripts 未内置，见 README）。
