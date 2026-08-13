# Worker 沙箱镜像（worker/docker）

本目录维护 Worker 沙箱镜像的 Dockerfile 与文档（ticket 01 monorepo 起随 worker 沙箱归位 `worker/`；gateway 镜像在网关仓库维护，ticket 02 并入 monorepo 后更新）。

| 文件 | 镜像 | 归属 |
|---|---|---|
| `Dockerfile.poweri` | `poweri-worker:local` | Worker 沙箱（bridge + pi@0.83.0 + 扩展 + skills）——PowerI 本体 |

> PowerI-Web（UI 壳）镜像在独立仓库 `poweri-web`（/Users/tianzhao/code/leoao/poweri-web）维护，不在本目录。

## Worker 镜像（Dockerfile.poweri）

Worker Pod 的基础镜像。基于官方 `docs/containerization.md` 的 "Plain Docker" 模板 + 生产加固。

- **运行时**：Node（pi 是 Node CLI，Bun 仅用于编译独立二进制，非必需运行时）
- **锁版本**：`ARG PI_VERSION` 固定 pi 版本，保证可复现构建（官方模板不锁版本，此处为生产实践）
- **非 root**：以 `piuser` 运行，缩小被注入工具的影响面
- **离线**：`PI_OFFLINE=1` 关闭启动外呼（版本检查/telemetry/pi.dev）
- **内嵌**：`worker/bridge/`（桥，与 gateway 通信）+ 会话 DTO 契约副本（`session-parse.mjs`，源在 gateway 侧，副本同步至 `worker/bridge/session-parse.mjs`）+ `/poweri/extensions/` 用户记忆扩展

```bash
node scripts/build-image.mjs            # → poweri-worker:local（512MB，可传 tag 与 pi 版本参数）
```

### 镜像大小说明（512MB arm64，考证于 2026-08）

| 构成 | 大小 | 说明 |
|---|---|---|
| pi 依赖树 | 163MB | pi dist 本体仅 11M；大头是 pi-ai 静态加载的 provider SDK（Mistral 24M + OpenTelemetry 15M + Gemini 14M + OpenAI 13M + AWS 11.6M + Anthropic 6.5M ≈ 96M，均未使用但仍被 `providers/all.js` 顶层 import）+ 其他依赖 |
| apt: git + ripgrep + bash | 101MB | pi 官方 containerization.md 模板明确包含（git 有运行时用途：`.git/HEAD` 仓库上下文）；apt lists 已按官方清理 |
| 基础 node:24-bookworm-slim | ~150MB | Node 运行时 |

**决策（用户拍板，2026-08）：维持官方形态，不裁剪 provider SDK。** 裁剪需 patch pi-ai `providers/all.js`（非官方 hack，升级需重做），评估后放弃。typebox 为运行时必需（pi-ai 入口 + 记忆扩展 import）。

**运行资源实测**：本地镜像冷启动 273–639ms（容器创建→桥就绪）；销毁毫秒级无残留；单会话活跃内存 ~210MB（桥 58M + pi 152M），512MB 限额余 ~60%。镜像大小成本在存储与首拉带宽，不随运行波动。

## Gateway 镜像（monorepo gateway/，ticket 02 已并入）

无状态网关层（认证/路由/计量/账单）已并入 monorepo `gateway/`（原独立仓库 /Users/tianzhao/code/leoao/poweri-gateway）。其 `Dockerfile.gateway` 与 `scripts/build-gateway.mjs` 随模块归位，构建产物 `poweri-gateway:local` 供根级 gen-k8s 部署引用：

```bash
cd gateway && node scripts/build-gateway.mjs  # → poweri-gateway:local（247MB）
```

- 多阶段：依赖层 `npm install --omit=dev`（锁 ws@^8.18），运行时层只拷 `*.mjs`（不含 test/node_modules）
- 非 root（内置 `node` 用户 uid 1000）；数据目录默认 `cwd/data`，镜像内预建并授权
- 契约：`session-parse.mjs`（会话 DTO）以副本形式同步到本仓库 `worker/bridge/session-parse.mjs`（worker 镜像内）
- 部署：K8s Deployment + PVC + NodePort（`scripts/gen-k8s.mjs`，见 `deploy/k8s/README.md`）；密钥经 Secret 注入（`POWERI_GATEWAY_USERS`、worker 侧 `POWERI_AI_API_KEY`）
