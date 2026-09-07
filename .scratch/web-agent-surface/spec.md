Status: ready-for-agent

# PowerI-Web Agent Surface 与端云双模式架构验证

## Problem Statement

PowerI 的目标是一个包含 web、gateway、worker 三个独立部署单元的 monorepo。web 既要提供 UI，也要承载端侧 pi 三件套智能框架的本地使用入口；云端则需要由 Gateway 负责 PowerI 业务控制，由 Worker pod 负责隔离执行。

旧的 web 描述容易把 UI、Agent Runtime、网关适配和上游 pi-web 文件关系混成一个边界：UI 可能直接依赖某种运行时，旧 JSONL/pi session 可能被误当成业务模型，subtree 跟随也可能被误解为终局约束。这样会让本地验证和云端验证共用不了稳定契约，也会在尚未证明需求前引入 native-agent 独立进程。

本规格要验证的是 UI 通过一个传输无关的 AgentClient 完成本地 C 外部行为，并为后续 B 的 web → gateway → worker 链路留下明确协议接缝。它不是已完成实现的声明，也不承诺本轮完成云端部署或进程拆分。

## Solution

将 web 定义为 UI + AgentClient + 端侧 Agent Runtime 集成边界，并把 Agent Runtime 与 UI 先逻辑分层、协议分层：

- UI 只依赖 AgentClient，不直接依赖本地文件、旧 JSONL、pi session 或 Worker 协议。
- LocalAgentClient 对接 LocalAgentHost；初期 LocalAgentHost 可以继续在 web 宿主进程内运行。
- RemoteAgentClient 对接 Gateway；Gateway 负责 Task、Session、Workspace、Operation、权限、路由、会话串行、事件和计量，再把请求送到 Worker pod 的 CloudAgentHost/sandbox。
- PowerI 自有 TaskId、SessionId、OperationId、WorkspaceId。旧 JSONL/pi session 只作为 Runtime adapter 的兼容存储或恢复来源。
- 先验证本地 C 闭环，再接入云端 B。是否把 LocalAgentHost 物理拆分，取决于真实的 OS 权限、独立升级、后台运行或资源/崩溃隔离需求。

## User Stories

1. 作为用户，我希望 UI 可以提交一个带 WorkspaceId 的任务，以便执行范围明确。
2. 作为用户，我希望本地 C 使用 LocalAgentClient 时能创建或续接 PowerI Session，以便保留连续对话。
3. 作为用户，我希望一次操作拥有可追踪的 OperationId，以便观察运行中、成功、失败、取消或未知状态。
4. 作为用户，我希望 UI 通过统一 AgentClient 接缝收取增量事件，以便不关心本地传输细节。
5. 作为用户，我希望本地 Agent 能访问明确授权的本地工作区，以便文件操作不超出我的意图。
6. 作为用户，我希望本地任务的结果、错误和终态能回到 UI，以便知道执行是否真的完成。
7. 作为用户，我希望关闭或重连观察端后可以查询原操作，而不是无意重复执行有副作用的操作。
8. 作为用户，我希望 Session 续接不依赖某个具体 JSONL 文件名，以便 Runtime 存储可以兼容演进。
9. 作为用户，我希望不同 Session 的状态彼此区分，以便不会把一个会话的事件显示到另一个会话。
10. 作为用户，我希望取消请求能区分“已收到取消”和“执行已停止”，以便不会误判副作用。
11. 作为开发者，我希望 UI 只依赖 AgentClient，以便替换 LocalAgentHost 的实现不会要求重写界面业务。
12. 作为开发者，我希望 AgentClient 协议能明确映射 TaskId、SessionId、OperationId 和 WorkspaceId，以便后续接入 Gateway。
13. 作为开发者，我希望协议能表达不支持的能力和明确拒绝，以便本地与云端能力差异不会被静默回退掩盖。
14. 作为开发者，我希望 LocalAgentHost 可以先与 web 宿主进程同进程，以便用最小改动完成 C 验证。
15. 作为维护者，我希望旧 JSONL/pi session 通过 adapter 兼容，而不是被提升为 PowerI 业务模型，以便未来能替换 Runtime 存储。
16. 作为维护者，我希望端侧 pi 三件套被视为底层 Runtime，以便 Gateway 的业务控制职责保持独立。
17. 作为平台开发者，我希望未来 RemoteAgentClient 只对接 Gateway，以便 web 不直接读取宿主文件或调用云端 Worker。
18. 作为平台开发者，我希望 Gateway 能按 Workspace 权限路由到 Worker pod 的 CloudAgentHost，以便云端执行有清晰的控制面和执行面边界。
19. 作为平台开发者，我希望未来云端事件能关联 PowerI 的 OperationId 和 Usage meter，以便事件与计量可对账。
20. 作为平台开发者，我希望 C 的协议测试结果能成为 B 的前置契约，以便接入 web → gateway → worker 时不复制 UI 业务逻辑。
21. 作为用户，我希望在断线后可以按事件序号恢复或重新获取 Session 快照，以便不会因网络重连重复执行操作或丢失状态。
22. 作为用户，我希望能查询任务产生的 artifacts 及其 Workspace 归属，以便区分执行结果和临时事件。
23. 作为维护者，我希望只有在 OS 权限、独立升级或后台运行等真实需求出现时才拆分 LocalAgentHost，以便避免过早引入 native-agent 复杂度。
24. 作为维护者，我希望迁移期仍可使用上游 pi-web 的 UI/交互资产，但不把 subtree pull 当作终局运行时约束，以便保留迁移弹性。

## Implementation Decisions

1. **主接缝**：UI 与 AgentClient 之间是传输无关的外部契约；AgentClient 与 AgentHost 之间是执行宿主契约。UI 不直接调用 Agent Runtime 内部接口。最小语义面包括 `createSession`、`sendTurn`、`subscribeEvents`、`getSnapshot`、`cancelOperation`、`getArtifacts` 和 `getCapabilities`；它们表达 PowerI 语义，不泄漏 pi 对象、JSONL 字段或 Worker RPC 细节。
2. **ID、事件与权威宿主**：请求/事件携带适用的 TaskId、SessionId、OperationId、WorkspaceId；事件具有单调序号并支持断线重连后的补偿或快照恢复；同一 Session 同一时刻只有一个权威 AgentHost，重连不能创建第二个宿主。
3. **双 adapter**：LocalAgentClient 连接 LocalAgentHost；RemoteAgentClient 连接 Gateway。RemoteAgentClient 不绕过 Gateway 连接 Worker。
3. **本地优先**：先实现和验证本地 C 的任务、会话、操作、事件、错误和本地工作区外部行为，再以同一 PowerI ID 语义推进 B。
4. **同进程是允许的阶段形态**：LocalAgentHost 初期可以运行在 web/Next 宿主进程内；这不取消逻辑边界，也不承诺永久同进程。
5. **云端职责**：Gateway 是业务控制面，负责权限、路由、Session 串行、事件关联、Usage meter 和 Invoice 所需的业务数据；Worker pod 是运行 CloudAgentHost/sandbox 的执行平面。
6. **业务 ID 优先**：TaskId、SessionId、OperationId、WorkspaceId 由 PowerI 产生和管理。旧 Runtime ID、旧 JSONL 和旧 pi session 通过 adapter 映射，不反向定义 PowerI 业务对象。
7. **能力差异显式化**：本地或云端不支持的操作返回明确能力错误或拒绝，不自动改走另一种宿主，不静默访问宿主文件。
8. **事件语义先于传输**：事件、状态、取消、错误、结果和未知结果需要有稳定语义；具体使用本地传输、Gateway 传输或 Worker RPC 不写入 UI 业务模型。
9. **渐进兼容**：迁移期可以继续读取旧 Session 存储并把它转换成 PowerI Session 视图；不要求本轮一次性删除旧存储或完成历史数据全量迁移。
10. **上游边界**：仍需保留的 web UI/交互资产可以从上游迁移；上游 subtree 是迁移工具，不规定 AgentClient、AgentHost、Gateway 或 Worker 的终局实现。
11. **物理拆分门槛**：仅当 OS 权限、独立升级、后台运行、资源/崩溃隔离或测量到的性能/可靠性瓶颈无法由同进程满足时，才创建独立 LocalAgentHost 进程。
12. **不虚构完成度**：本规格描述待验证的目标和接缝；通过规格评审不代表 C、B、Gateway、Worker 或隔离能力已经实现。

## Testing Decisions

### 主测试缝：UI 通过 AgentClient 的本地 C 外部行为

主测试不检查某个类、文件或进程是否存在，而是从 UI 入口通过 LocalAgentClient 完成本地 C 闭环。至少覆盖：创建/续接 Session、提交 Task、观察 Operation 状态、接收增量事件、读取结果、处理错误、取消与重连查询，以及 Workspace 边界下的文件操作。断言使用 PowerI 的 TaskId、SessionId、OperationId、WorkspaceId 和可观察结果，不以旧 JSONL 的布局作为成功标准。

### 辅助测试缝：AgentClient 协议映射

使用可控的 LocalAgentHost 替身或测试宿主，验证 AgentClient 到 AgentHost 的请求/事件/错误映射：PowerI ID 不丢失、不串用；不支持能力会明确拒绝；运行时记录仅作为 adapter 数据；取消、终态和未知结果不会被错误折叠。该测试缝验证协议，不替代真实本地 Agent Runtime 行为。

### 后续测试缝：B 的 web → gateway → worker

B 是后续测试缝，不作为本轮 C 已通过的证明。后续应从 web 的 RemoteAgentClient 进入 Gateway，验证认证、Workspace 权限、Session 串行、路由到 Worker pod、CloudAgentHost/sandbox 执行、事件回传、User data store 隔离和 Usage meter 关联。Worker 的真实执行与隔离不能只用 UI 或 Gateway mock 宣称通过。

### 回归原则

- 只断言外部行为和业务语义，不把上游文件布局或某个 Runtime 内部调用顺序当作契约。
- C 的本地路径使用隔离测试工作区和合成数据，避免生产凭据和用户数据。
- 对取消、超时、连接断开和宿主异常分别检查实际状态与产物，不能只检查 UI 文案。
- 记录尚未覆盖的 B、权限、隔离、计量和跨进程需求；缺少证据时标记为待验证，不写成完成。

## Out of Scope

- 立即把 LocalAgentHost 拆为 native-agent 独立进程。
- 立即把 web UI 与 Agent Runtime 拆成两个完整独立框架或独立部署服务。
- 本轮完成 web → gateway → worker 的云端生产链路、Worker pod 弹性、sandbox 生产隔离或多租户上线。
- 让 web 在 Gateway 模式下直读宿主文件或直接执行云端业务。
- 重写 pi-ai、pi-agent-core、pi-coding-agent，或让它们承担 PowerI 业务控制面。
- 把旧 JSONL/pi session 删除、强制迁移或提升为新的业务模型源头。
- 承诺透明的本地/云端自动切换、活跃 Session 自动迁移或双向同步。
- 把上游 subtree 代码立即删除，或承诺永久持续 subtree pull。
- 在没有真实需求和证据前新增 native-agent 进程、后台服务或独立升级链路。

## Further Notes

- 终局架构以 ADR-0011 为准；ADR-0010 仍保留 monorepo、三模块和独立部署部分，其 subtree/upstream 运行时约束已被部分取代。
- CONTEXT.md 中的 Gateway、Worker pod、User data store、Session、User Memory、Usage meter 和 Invoice 词汇继续适用。
- 本规格的 `ready-for-agent` 表示 C 的验证范围和后续 B 接缝已足够明确，不表示目标已经实现，也不授权立即上线。
- 上游 UI 迁移资产仍可按迁移期流程维护；当继续同步不再有价值时，可以停止 subtree pull，而不影响 AgentClient/AgentHost 的终局设计。
