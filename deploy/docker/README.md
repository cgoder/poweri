# pi 沙箱容器镜像（ticket 01）

Worker Pod 的基础镜像。基于官方 `docs/containerization.md` 的 "Plain Docker" 模板 + 生产加固。

- **运行时**：Node（pi 是 Node CLI，Bun 仅用于编译独立二进制，非必需运行时）
- **锁版本**：`ARG PI_VERSION` 固定 pi 版本，保证可复现构建（官方模板不锁版本，此处为生产实践）
- **非 root**：以 `piuser` 运行，缩小被注入工具的影响面
- **离线**：`PI_OFFLINE=1` 关闭启动外呼（版本检查/telemetry/pi.dev）

## 构建与运行

```bash
docker build -t poweri-worker:local -f Dockerfile.pi .
# 一次性（print 模式）
docker run --rm -e ANTHROPIC_API_KEY=$KEY -v "$PWD:/workspace" poweri-worker:local -p "Hello"
# 长驻 headless（RPC，供桥驱动）
docker run --rm -i -e ANTHROPIC_API_KEY=$KEY poweri-worker:local --mode rpc --no-session
```

> 生产：凭据经 secret 管理注入环境变量，不要写进镜像。自定义 provider/model 走 `models.json`（`apiKey` 支持 `$ENV_VAR` 插值）。

## 镜像大小说明（512MB arm64，考证于 2026-08）

| 构成 | 大小 | 说明 |
|---|---|---|
| pi 依赖树 | 163MB | pi dist 本体仅 11M；大头是 pi-ai 静态加载的 provider SDK（Mistral 24M + OpenTelemetry 15M + Gemini 14M + OpenAI 13M + AWS 11.6M + Anthropic 6.5M ≈ 96M，均未使用但仍被 `providers/all.js` 顶层 import）+ 其他依赖 |
| apt: git + ripgrep + bash | 101MB | pi 官方 containerization.md 模板明确包含（git 有运行时用途：`.git/HEAD` 仓库上下文）；apt lists 已按官方清理 |
| 基础 node:24-bookworm-slim | ~150MB | Node 运行时 |

**决策（用户拍板，2026-08）：维持官方形态，不裁剪 provider SDK。** 裁剪需 patch pi-ai `providers/all.js`（非官方 hack，升级需重做），评估后放弃。typebox 为运行时必需（pi-ai 入口 + 记忆扩展 import）。

**运行资源实测**：本地镜像冷启动 273–639ms（容器创建→桥就绪）；销毁毫秒级无残留；单会话活跃内存 ~210MB（桥 58M + pi 152M），512MB 限额余 ~60%。镜像大小成本在存储与首拉带宽，不随运行波动。
