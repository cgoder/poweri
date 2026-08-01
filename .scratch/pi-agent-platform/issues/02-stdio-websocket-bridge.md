# 02 — stdio↔WebSocket 桥

**What to build:** 在每个 Worker Pod 内运行的小 shim：把 `pi --mode rpc` 子进程的 stdin/stdout JSONL 协议暴露成一个 WebSocket 端点。网关可通过 WS 写入 RPC 命令（prompt/steer/…）并读取流式事件（message_update/tool_execution_*/…），同时管理子进程生命周期。

**Blocked by:** 01 — pi 沙箱容器镜像

**Status:** ready-for-agent

- [ ] 客户端经 WS 连接后发送 prompt，能收到流式消息事件
- [ ] JSONL 帧以 LF 严格分隔，命令/事件映射正确（对齐 pi RPC 协议）
- [ ] 子进程退出/异常时桥能干净处理并上报
- [ ] 桥保持进程隔离（pi 为独立子进程）
- [ ] 存活探针可用（如 get_state 返回 success）
