# 网关层（ticket 03 / 13）

无状态、水平扩展的网关：认证、路由到 Worker Pod（经其桥的 WebSocket）、流式转发。

- **主测试缝**：网关客户端 API，Pod 层用 fake 内存 Pod 替换（测试只测外部行为）
- **无状态**：不保存会话；路由/认证全靠请求自身，状态外置（后续在元数据存储）
- **运行时**：Node（镜像单运行时原则），唯一依赖 `ws`

## API
- `GET /healthz` → 存活探针
- `POST /v1/chat`（`Authorization: Bearer <token>`，body `{session, message}`）→ **SSE** 事件流
  - 事件即 Pod 上游事件（`message_update` 等），含 token/cost usage（可供 ADR-0006 计量）

## 运行
```bash
node gateway/server.mjs   # POWERI_GATEWAY_PORT(8080) / POWERI_GATEWAY_TOKEN(dev-token)
```

## Pod 选型（POWERI_POD_PROVIDER）
- `fake`（默认）：内存假 Pod，主测试缝，无真实 pi
- `bridge`：经 WS 连真实桥（`POWERI_POD_BRIDGE_URL=ws://host:port`）

## 已实测（本地 PoC）
- 未认证/错 token → 401 ✅
- 正确 token + fake pod → SSE 事件流（agent_start→…→agent_end）✅
- `POWERI_POD_PROVIDER=bridge` 切真实：client → 网关 → 桥 → pi → 真实模型，
  流式返回 `pong`，事件含真实 usage（totalTokens 1573）✅
