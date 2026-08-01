# 06 — 流式转发 + 长/短连接

**What to build:** 网关把 Pod 的流式事件（消息增量、工具执行更新）逐跳转发给客户端；同时支持长连接的持续流式（聊天）与短连接的一次性处理。网关做轻量缓冲转发，客户端经 SSE/WS 实时看到进展。

**Blocked by:** 03 — 网关骨架：认证 + 路由

**Status:** done（commit 见下）

**Done:** 网关新增 WS 长连接端点 `/v1/ws`（多轮 + abort + busy 拒绝 + 断线 drain）与历史补发接口 `GET /v1/sessions/<id>/messages`；streamPod 统一返回 `{stream, abort}`；verify-06 全链路 8 项断言通过。

- [x] 客户端实时收到消息增量与工具执行事件（SSE + WS 均验证）
- [x] 长连接（WS /v1/ws 多轮 + abort）与短处理（POST /v1/chat SSE）两形态（verify-06 Part A/B）
- [x] 连接中断可重连且不丢已持久化事件（事件持久化于会话 JSONL；GET /v1/sessions/<id>/messages 补发；B3 跨连接续接验证）
