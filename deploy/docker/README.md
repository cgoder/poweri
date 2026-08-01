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
