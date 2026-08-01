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

## pi-web 可视化多用户验证镜像（ticket 15）

`Dockerfile.piweb` → `poweri-piweb:local`：pi 的本地 Web UI（Next.js 16，进程内 SDK 驱动 pi@0.83.0 = 平台锁定版本）。每测试用户一个实例（挂该用户 `.pi/agent` + workspace），各自访问各自界面 → 多租户隔离 / 真实 pi 并发 / 会话续接的可视化。**绕过网关**（每实例直接驱动一个独立 pi），测的是底层隔离与并发；网关行为由 verify-05/06/09/16 覆盖。

```bash
# 构建
node scripts/build-piweb.mjs          # → poweri-piweb:local（1.11GB，npm 包内含 .next，无运行时构建）
# 每测试用户一个实例（端口矩阵 30141+，密码默认 poweri-<user>）
node scripts/run-piweb.mjs start alice,bob,carol
node scripts/run-piweb.mjs status     # 实例/端口/密码表（浏览器打开，用户名固定 pi）
node scripts/run-piweb.mjs stop       # 停止全部
# 全链路验证（A 认证隔离 / B 数据隔离 / C 并发 / D 重启续接 / E 配置隔离）
node scripts/verify-15.mjs
```

关键点：`PI_CODING_AGENT_DIR=/home/piuser/.pi/agent`（会话+配置一体挂载）；`PI_WEB_PASSWORD` 每实例独立 Basic Auth（username 恒为 pi）。

> **实证（2026-08）**：pi 0.83 经 SessionManager 把会话写在 `sessions/<slug>/<时间戳>_<sessionId>.jsonl`（嵌套+前缀）——pi-web 侧按此规范布局；与网关 `--session <path>` 显式指定的顶层 `sessions/<id>.jsonl` 不同，互不影响。

## Gateway 镜像（ticket 19）

无状态网关层（认证/路由/计量/账单）的容器形态，构建：

```bash
node scripts/build-gateway.mjs    # → poweri-gateway:local（约 150MB，node:24-bookworm-slim + 仅 ws 依赖）
```

- 多阶段：依赖层 `npm install --omit=dev`（锁 ws@^8.18），运行时层只拷 `gateway/*.mjs`（不含 test/node_modules）
- 非 root（内置 `node` 用户 uid 1000）；数据目录默认 `cwd/data`，镜像内预建并授权
- 部署：K8s Deployment + PVC + NodePort（`scripts/gen-k8s.mjs`，见 `deploy/k8s/README.md`）；密钥经 Secret 注入（`POWERI_GATEWAY_USERS`、worker 侧 `POWERI_AI_API_KEY`）
