# stdio↔WebSocket bridge in each worker pod

Each worker pod runs `pi --mode rpc` as a child process plus a small shim that exposes pi's JSONL stdio protocol over a WebSocket. The gateway holds a WebSocket to the pod: it writes RPC commands (`prompt`, `steer`, …) and reads the streamed event lines (`message_update`, `tool_execution_*`, …). We chose this because pi has no built-in HTTP server and its RPC transport is stdin/stdout, so a network-facing surface must be added per pod; WebSocket carries long-lived streaming for chat while staying language-agnostic and keeping pi as an isolated child process.

_Considered and rejected:_ embedding the SDK in a Node service inside the pod (no shim, but loses process isolation and couples pods to Node); one-shot per-request pods (simplest but no streaming and high churn).
