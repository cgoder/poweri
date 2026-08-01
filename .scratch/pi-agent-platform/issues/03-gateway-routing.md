# 03 — 网关骨架：认证 + 路由（主缝）

**What to build:** 无状态网关层：认证每个请求，把请求路由到承载该请求的 Worker Pod（经其桥的 WS），并把 Pod 的流式事件转发回客户端。测试以网关客户端 API 为主缝，用 fake 内存 Pod 起步、可切换到真实 Pod。

**Blocked by:** 02 — stdio↔WebSocket 桥

**Status:** done（53b4c7d 网关骨架：Bearer 认证 + /v1/chat SSE 路由 + PodProvider fake/bridge；真实链路 client→网关→桥→pi→模型验证通过）

- [ ] 未认证请求被拒绝
- [ ] 一个客户端请求 → 网关路由到 Pod → 流式回答回到客户端
- [ ] 网关无状态（可水平扩展），状态外置
- [ ] 主缝测试：fake pod 下网关路由/认证/事件转发端到端通过
- [ ] 可切换到真实 Pod 验证
