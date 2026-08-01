# stdio↔WebSocket 桥（ticket 02 / 13）

每个 Worker Pod 内的小 shim：把 `pi --mode rpc` 子进程的 stdin/stdout JSONL 协议暴露为一个 WebSocket 端点，供网关网络驱动。

- pi RPC 为严格 LF 分隔 JSONL（命令写 stdin，事件流读 stdout）
- 保持进程隔离（pi 为独立子进程）
- 桥是每个 Pod 内唯一的自有代码，应保持最小并独立可测

本地最小端到端 PoC（ticket 13）将在此起一个可运行雏形。
