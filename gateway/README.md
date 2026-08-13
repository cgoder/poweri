# poweri-gateway（PowerI 网关，独立仓库）

无状态、水平扩展的网关：认证、路由到 Worker Pod（经其桥的 WebSocket）、流式转发、会话续接、并发控制、计量。2026-08 自 PowerI 仓库拆分为独立项目（三模块：PowerI / poweri-gateway / PowerI-Web），由 K8s 管理运行的独立容器。

- **主测试缝**：网关客户端 API，Pod 层用 fake 内存 Pod 替换（测试只测外部行为）
- **无状态**：不保存会话；路由/认证全靠请求自身，状态外置（元数据存储 store.mjs）
- **运行时**：Node（镜像单运行时原则），唯一依赖 `ws`

## API
- `GET /healthz` → 存活探针
- `POST /v1/chat`（`Authorization: Bearer <token>`，body `{session, message}`）→ **SSE** 事件流（短连接一次性处理）
  - 事件即 Pod 上游事件（`message_update` 等），含 token/cost usage（ADR-0006 计量）
- `GET /v1/sessions/<sessionId>/messages`（Bearer）→ 会话历史（断线重连补发，从 PVC 上 JSONL 提取）
- `WS /v1/ws?token=<token>` → **长连接**多轮对话：
  - 发 `{message, session?}` 发起一轮（同连接同一时刻一个请求，busy 则 `error` 事件）
  - 发 `{type:"abort"}` 中断当前轮（pi RPC abort：停止生成，会话 JSONL 保持完整）
  - 断开时网关仍 drain 完当前轮（JSONL 完整性，ADR-0005）
- 会话语义：省略/`continue` → 续接最近会话；`new` → 新建；`<id>` → 续接指定会话
- `GET/POST /v1/admin/usage`、`/v1/admin/invoice`（`Bearer <ADMIN_TOKEN>`）→ 计量与账单

## 独立能力（三模块各自独立编译 / 镜像 / 运行）

| 能力 | 命令 | 产物 |
|---|---|---|
| 单测 | `node --test "test/*.test.mjs"` | 14 用例（metering/queue/session-parse） |
| 独立镜像 | `node scripts/build-gateway.mjs` | `poweri-gateway:local`（Dockerfile.gateway，247MB） |
| 本地运行 | `node server.mjs`（fake provider，零依赖外设） | 8080 端口，`POWERI_POD_PROVIDER=fake/bridge/docker` |
| K8s 运行 | 见下 | NodePort 31080 |

### K8s 部署（自描述 manifest，`deploy/k8s/gateway.yaml`）

```bash
# 独立部署（需 Secret poweri-secrets 已存在：POWERI_GATEWAY_USERS 键；POWERI_K8S_USERS 占位符需替换为每用户 worker 映射）
kubectl apply -f deploy/k8s/gateway.yaml
# 聚合一键部署（开发环境推荐）：由 PowerI 控制面注入 K8S_USERS + Secret 并部署全链路
cd /Users/tianzhao/code/github/Poweri && POWERI_AI_API_KEY=<key> node scripts/gen-k8s.mjs alice,bob --ui
```

> manifest 归本仓库自描述（Deployment + PVC + Service NodePort 31080），PowerI 的 `gen-k8s` 控制面只做聚合引用（注入 `${K8S_USERS}` 与 Secret），不改动本仓库部署形态。


## Pod 选型（POWERI_POD_PROVIDER）
- `fake`（默认）：内存假 Pod，主测试缝，无真实 pi（`POWERI_FAKE_DELAY_MS`/`POWERI_FAKE_USAGE` 控制时序与计量）
- `bridge`：经 WS 连单个已运行桥（`POWERI_POD_BRIDGE_URL=ws://host:port`）
- `docker`：按请求调度容器，挂载该用户数据目录（PoC 版 per-user PVC）+ 会话文件，复用同会话容器

## 已实测（本地 PoC）
- 未认证/错 token → 401 ✅；正确 token → SSE 事件流 ✅
- `bridge`/`docker` 切真实：client → 网关 → 桥 → pi → 真实模型，流式返回，事件含真实 usage ✅
- 每用户 token 认证 + 会话续接（pod 重建后数据仍在，用户间物理隔离）✅
- 同会话并发串行、跨会话并行、并发下 JSONL 无损坏 ✅
- 计量聚合 + 幂等账单（fake 精确算账与真实 pi 两条链路）✅
- WS 长连接多轮 / abort 提前中断 / busy 拒绝 / 历史补发 / 断线重连续接 ✅
