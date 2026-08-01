# 网关层（ticket 03 / 13）

无状态、水平扩展的网关：认证、路由到 Worker Pod（经其桥的 WebSocket）、会话续接、并发控制（会话内串行/跨会话并行）、流式转发、每用户计量。

- **主测试缝**：网关客户端 API，Pod 层用 fake 内存 Pod 替换（测试只测外部行为）
- 状态全部外置：用户数据在 per-user PVC，user→session 映射与记账在元数据存储

本地最小端到端 PoC（ticket 13）将在此起一个可运行雏形。
