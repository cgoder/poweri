# Agent Platform Context

## 项目结构（三模块，目标架构）

PowerI 的终局是一个 monorepo，包含三个独立部署单元。以下是架构决策和目标边界，不代表每项能力已经实现：

1. **web**：PowerI-Web 的 UI、传输无关的 AgentClient，以及端侧 pi 三件套 Agent Runtime 的集成边界。web 不是只有 UI 的展示壳。
2. **gateway**：PowerI 业务控制面，负责身份、Task/Session/Workspace/Operation、权限、路由、会话串行、事件和计量。
3. **worker**：云端执行平面，负责 Worker pod、sandbox、CloudAgentHost 和 pi RPC 运行时。

三个单元可以独立构建、发布、伸缩和部署；这不意味着 web 内部的 UI、AgentClient 与 LocalAgentHost 现在就必须是不同进程。先保持逻辑分层和协议分层，只有出现真实 OS 权限、独立升级或后台运行需求时，才评估物理拆分。

### 双模式关系

**AgentClient** 是 UI 唯一依赖的传输无关接缝。它表达 PowerI 的任务、会话、操作、工作区和事件语义，不把本地文件 API、旧 JSONL、pi session 或 Worker 网络协议暴露给 UI。

**AgentHost** 是 AgentClient 另一侧的执行宿主接缝：它承接 PowerI 业务请求，调度具体 Agent Runtime，并返回状态、事件、结果和用量信号。AgentHost 是逻辑/协议边界，不等于必须立即独立进程。

- **LocalAgentClient** 对接 **LocalAgentHost**。初期 LocalAgentHost 可以继续运行在 web/Next 宿主进程内，并访问用户授权的本地工作区。
- **RemoteAgentClient** 对接 Gateway。Gateway 再将请求路由到 Worker pod 中的 **CloudAgentHost/sandbox**；RemoteAgentClient 不直接连接 Worker。
- Gateway 模式下，web 不直读宿主文件，也不直接运行云端业务；它只使用 Gateway 的 PowerI 业务协议。

端侧 pi 三件套（pi-ai、pi-agent-core、pi-coding-agent）属于底层 Agent Runtime。它们为 AgentHost 提供运行能力，但不是 PowerI 的业务控制面。上游 pi-web 只作为 UI/交互资产或迁移来源，不构成终局 Runtime 或业务循环约束。

### 本地 C 数据流

浏览器 → PowerI-Web UI → AgentClient → LocalAgentClient → LocalAgentHost → 端侧 Agent Runtime/本地工作区；状态、事件和结果沿同一 AgentClient 接缝返回 UI。C 是先行的本地闭环，用于验证外部行为；LocalAgentHost 是否同进程不改变该协议边界。

### 云端 B 数据流

浏览器 → PowerI-Web UI → AgentClient → RemoteAgentClient → Gateway → Worker pod → CloudAgentHost/sandbox → pi RPC → 模型；结果、事件和用量信号反向经过 Gateway 返回 UI。Gateway 执行认证、Workspace 权限、Session 串行、路由、事件关联与计量。Worker pod 只承担云端执行，不成为 PowerI 业务模型的权威来源。

## 领域词汇

### Gateway

PowerI 的控制面和业务层。它认证用户，管理 Task、Session、Workspace、Operation，执行权限检查、会话路由与串行化，协调 Worker pod，并维护事件和计量关联。

**避免**：server、backend、router（当含义是 PowerI 控制面时）。

### Worker pod

运行云端 Agent 的容器化执行单元。它由 Gateway 调度，在 sandbox 中运行 CloudAgentHost 和 pi 的 RPC 模式，按授权访问 User data store。Worker pod 可以被替换或销毁，不应保存唯一的 PowerI 业务状态。

**避免**：container（当含义是 pod 时）、sandbox（当含义是 Worker pod 时）、worker（需要强调部署单元时除外）。

### AgentClient

UI 与 AgentHost/Gateway 之间的传输无关协议接缝。它负责表达 PowerI 的请求、状态、事件和结果，并允许 LocalAgentClient 与 RemoteAgentClient 使用不同传输实现。UI 不应依赖某个 Agent Runtime 的内部 API。

最小语义面包括 `createSession`、`sendTurn`、`subscribeEvents`、`getSnapshot`、`cancelOperation`、`getArtifacts` 和 `getCapabilities`。这些能力使用 PowerI 的 TaskId、SessionId、OperationId、WorkspaceId；事件需要单调序号和断线重连语义，状态必须区分运行中、已完成、失败、已取消和未知结果。同一 Session 只能有一个权威 AgentHost，重连或重新订阅不得创建第二个权威宿主。

### AgentHost

承接 AgentClient 请求并驱动 Agent Runtime 的执行宿主接缝。它将 PowerI 的 Task、Session、Operation、Workspace 语义映射到具体运行时，并负责将运行时事件映射回 PowerI 事件。AgentHost 不拥有 Gateway 的跨用户权限和业务控制面职责。

### LocalAgentHost

本地执行宿主。它服务于本地 C，访问用户授权的本地工作区并驱动端侧 Agent Runtime。初期允许与 web/Next 同进程；只有 OS 权限、独立升级、后台运行、资源/崩溃隔离等真实需求出现时，才物理拆为 native-agent。

### CloudAgentHost

Worker pod 内的云端执行宿主。它在 sandbox 中驱动 pi RPC 运行时，使用 Gateway 已授权的 Workspace 和 User data store，不直接向终端用户提供 PowerI 业务 API，也不决定用户权限、Session 路由或 Invoice。

### PowerI ID

PowerI 自有的业务标识优先于 Runtime 存储形态：

- **TaskId**：任务及其目标执行范围的业务标识。
- **SessionId**：可续接、可授权、可计量的 PowerI 会话标识。
- **OperationId**：一次可观察、可取消或可对账的操作标识。
- **WorkspaceId**：权限与数据归属边界的工作区标识。

旧 JSONL、旧 pi session 和其它 Runtime 记录只是 adapter 的兼容存储、恢复来源或事件映射来源，不是 PowerI 业务模型的源头。所有 adapter 都应保留 PowerI ID 与 Runtime 记录之间的可追溯关联。

### User data store

每个用户的 User data store 是该用户的持久数据边界，通常包含工作区文件、pi session 兼容记录和执行记录。物理隔离必须按用户维持；Worker pod 只能访问被 Gateway 授权的用户数据。

**避免**：storage、volume（当特指用户数据边界时）。

### Session

PowerI 视角下可续接、可授权、可计量的用户会话。它可以由旧 JSONL/pi session 记录恢复或适配，但不等同于某个 JSONL 文件，也不由 Runtime 文件格式定义。一个 Session 内的相关操作需要按 Gateway 规则串行化；不同 Session 可以并行，但共享工作区时仍需考虑文件级竞争。

**避免**：chat thread、history（当特指一个 Session 时）。

### User Memory

每个用户跨 Session 累积的偏好、事实和对用户的逐步理解。它属于用户的数据边界，持久化在该用户的 User data store/工作区并跨 Session 使用。它不是单次 Session 的聊天历史，也不改变 Gateway 对权限和计量的控制。

**避免**：profile、context、history（当含义是跨 Session 的累积记忆时）。

### Usage meter

按用户聚合资源、数据和模型消耗的计量记录，包括 token、cost、存储和出站等指标。计量可结合 Gateway 业务事件、Worker/Runtime 事件和平台指标，但归属必须以 PowerI 的用户、Workspace、Task、Session 和 Operation 为准。

**避免**：stats、analytics（当含义是计量记录时）。

### Invoice

根据 Usage meter 和定价规则生成的用户账单。支付收款不在该定义范围内。

**避免**：bill（含义不明确时）。

### Legacy user data

平台上线前已有的用户档案、画像和历史使用记录。它们需要在上线或首次运行时按用户导入 User Memory，而不是被误当作新的 Session 或 PowerI 业务事件。

**避免**：archive、history（当含义是存量用户数据时）。

## 命名规范与迁移说明

存在多个同名项目 `pi-web`（上游与社区 fork），所有书面/口头引用必须带所有者前缀，严禁裸用“pi-web”指代两者之一。

**PowerI-Web**（曾用名 **pi-web (agegr)**）：PowerI monorepo 的 web 部署单元，终局定义为“UI + AgentClient + 端侧 Agent Runtime 集成边界”的双模式 Web 产品。迁移期可以从上游 agegr/pi-web 取得 UI/交互资产，并使用 subtree 作为过渡同步机制；subtree/upstream 跟踪不是终局业务循环或 Agent Runtime 的约束。展示文案保留品牌名 `PowerI-Web`，代码命名沿用项目既有约定。

**pi-web (jmfederico)**：The community rewrite of pi-web，曾用于独立试点和对比。它不是 PowerI 终局架构的控制面或 AgentHost 规范来源；如需引用，必须保留所有者前缀。

## 历史与适用边界

ADR-0010 保留 monorepo、web/gateway/worker 三模块及独立部署的决策。关于 web subtree 持续跟随上游、上游运行时关系和终局 Agent 边界的解释，以 ADR-0011 为准。当前文档描述目标架构与约束，不把已有目录、适配层或测试状态表述为终局已完成。
