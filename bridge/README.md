# stdio↔WebSocket 桥（ticket 02 / 13）

每个 Worker Pod 内的小 shim：把 `pi --mode rpc` 子进程的 stdin/stdout JSONL 协议暴露为一个 WebSocket 端点，供网关网络驱动。

- **实现**：`server.mjs`（Bun 原生 WebSocket server + `spawn`，零第三方依赖）
- **模型**：每个 WS 连接对应一个独立 `pi --mode rpc` 子进程（进程隔离，连接关闭即 kill）
- **映射**：WS 消息 → pi stdin（一条命令一行）；pi stdout 的 JSONL 事件流 → WS 逐行转发
- **帧**：严格 LF 分隔（勿用 Node readline，会把 U+2028/29 当换行）
- **健康探针**：客户端发送 `{"type":"get_state"}`，`success:true` 即存活

## 运行
```bash
# 容器内（需 bun + pi + 挂载配置）
bun /bridge/server.mjs
# 读取 .env：POWERI_BRIDGE_PORT(默认8081) / POWERI_AI_MODEL
```

## 测试
```bash
bun run bridge/test-client.mjs [ws://host:port] ["提示词"]
# 流程：连接 → get_state(探针) → prompt → 流式收事件 → isStreaming=false 后取最终文本
```

## 已实测（本地 PoC）
- WS 连接 → 桥 spawn pi（独立子进程）✅
- `get_state` 健康探针 → success=true, model=agent ✅
- `prompt` → 流式事件全链路（agent_start/message_start/message_update/turn_end/agent_end…）✅
- 连接关闭 → kill pi（SIGTERM），进程隔离 ✅
