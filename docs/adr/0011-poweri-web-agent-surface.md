# ADR-0011：PowerI-Web 的 Agent Surface 与端云双模式

- **状态**：Accepted
- **决策范围**：PowerI 单 monorepo 中的 web、gateway、worker 三个独立部署单元，以及 web 与 Agent Runtime 的边界
- **取代关系**：部分取代 ADR-0010

## 背景

PowerI 的终局是一个单 monorepo，包含 web、gateway、worker 三个独立部署单元。web 不只是展示层：它还承载端侧 pi 三件套智能框架及其本地执行入口。与此同时，云端多租户执行需要由 Gateway 统一承接业务控制，再由 Worker pod 承载隔离的执行环境。

此前把 web 描述为上游 pi-web 的网关模式壳，并把 subtree 持续跟随上游当作长期约束，混淆了三个问题：UI 如何显示交互、客户端如何请求 Agent、以及 Agent Runtime 在哪里运行。还把旧 JSONL 和 pi session 的存储形态放在了 PowerI 业务模型之前，容易导致 Task、Session、权限、路由和计量被运行时文件反向定义。

本 ADR 将 web 的产品边界、Agent 访问接缝和本地/云端执行位置分开定义。它描述目标架构与迁移顺序，不表示这些目标已经全部实现。

## 决策

### 1. 单 monorepo 与三部署单元保持不变

PowerI 最终保持一个 monorepo，web、gateway、worker 是三个可独立构建、发布和部署的单元：

- **web**：UI、传输无关的 AgentClient，以及端侧 pi 三件套 Agent Runtime 的集成边界。
- **gateway**：PowerI 业务控制面。
- **worker**：云端执行平面，运行 Worker pod、sandbox 和 pi 的 RPC 运行时。

“独立部署”描述交付与伸缩边界，不要求 web 内部的 UI、AgentClient 和 LocalAgentHost 立即成为不同进程。

### 2. web 与 Agent Runtime 先逻辑分层、协议分层

web 的 UI 只依赖一个传输无关的 **AgentClient seam**。UI 不直接依赖本地文件、pi session 文件、Worker 网络协议或某个具体 Agent Runtime 类别。

AgentClient 的另一侧连接 **AgentHost seam**。AgentHost 负责承接任务、会话、操作和事件，并把 PowerI 的业务请求映射到具体的 Agent Runtime。当前阶段只要求逻辑边界和协议边界清楚；LocalAgentHost 可以继续运行在 web 的宿主进程内，不提前引入 native-agent 独立进程或完整的新框架。

AgentClient 的最小语义面覆盖：`createSession`、`sendTurn`、`subscribeEvents`、`getSnapshot`、`cancelOperation`、`getArtifacts` 和 `getCapabilities`。这些名称表达 PowerI 能力，不暴露 pi 对象、JSONL 字段或 Worker RPC 细节。请求和结果必须携带 PowerI 的 TaskId、SessionId、OperationId、WorkspaceId（适用时）；事件具有单调序号并支持断线重连后的补偿或重新获取快照；同一 Session 在任一时刻只能有一个权威 AgentHost，重连不能创建第二个权威宿主。

### 3. 两种 AgentClient adapter

- **LocalAgentClient**：对接本地 AgentHost。初期 LocalAgentHost 可以与 web 宿主进程同进程运行，并使用本机工作区和本地运行时资源；这只是部署选择，不是 UI 与 Runtime 的永久耦合。
- **RemoteAgentClient**：对接 Gateway。RemoteAgentClient 不直接连接 Worker，也不承担 PowerI 的权限、路由、会话串行或计量；这些职责属于 Gateway。

在 Gateway 模式下，web 不直读宿主文件，也不直接运行云端业务。它只通过 RemoteAgentClient 使用 Gateway 暴露的 PowerI 业务协议。

### 4. Gateway 是业务控制面，Worker 是执行平面

**Gateway** 负责：

- Task、Session、Workspace、Operation 的创建、授权、状态和生命周期；
- 用户身份、Workspace 权限和请求级访问控制；
- 会话路由、同一 Session 内串行化及恢复协调；
- Agent 事件的业务化、转发、审计和关联；
- Usage meter、Invoice 所需的用量采集与业务计量；
- 将一个 RemoteAgentClient 请求路由到合适的 Worker pod，并维护云端执行的业务关联。

**Worker pod** 是云端执行平面。它运行 pi 的 RPC 模式、sandbox 和 **CloudAgentHost**，访问被授权的 User data store，产生运行时事件并将其返回给 Gateway。Worker 是可替换的执行单元，不是 PowerI 业务模型的权威来源。

### 5. PowerI ID 先于 Runtime 存储

PowerI 自有并管理以下业务标识：

- **TaskId**：一个用户可理解的任务及其目标执行范围的业务标识；
- **SessionId**：PowerI 视角下可续接、可授权、可计量的会话标识；
- **OperationId**：一次可观察、可取消或可对账的操作标识；
- **WorkspaceId**：权限和数据归属边界的工作区标识。

旧 JSONL 文件、旧 pi session 以及其它 runtime 记录只能通过 adapter 作为兼容存储、恢复来源或事件映射来源。它们不是 PowerI Task、Session、Operation、Workspace 的业务模型源头，也不能自行决定业务权限、路由、计量或 ID 语义。adapter 必须保留可追溯的 PowerI ID 关联。

### 6. 先完成本地 C，再接入云端 B

迁移顺序固定为：

1. **本地 C 闭环**：UI 通过 AgentClient 使用 LocalAgentClient，对接 LocalAgentHost；先验证任务提交、事件、会话续接、操作状态和本地工作区等外部行为。
2. **云端 B 接入**：在 C 的契约稳定后，实现 UI 通过 RemoteAgentClient 进入 Gateway，再由 Gateway 路由到 Worker pod 中的 CloudAgentHost/sandbox。验证权限、路由、会话串行、隔离、事件和计量。
3. **收敛双模式**：复用 UI 侧 AgentClient 协议和 PowerI 业务 ID，不以复制两套 UI 业务逻辑换取迁移速度。

这一路径不要求先把 LocalAgentHost 物理拆出，也不把 B 的云端链路伪装成本地 C 已经完成。

### 7. 只有真实需求出现时才物理拆分 LocalAgentHost

在以下需求实际出现并且无法由现有宿主进程可靠满足时，才允许把 LocalAgentHost 拆成独立 native-agent 进程：

- 必须获得与 web 宿主进程不同的 OS 权限边界；
- 需要独立升级、回滚或版本生命周期；
- 需要脱离 UI 进程后台运行，支持关闭窗口后继续工作；
- 需要独立资源治理、崩溃隔离、启动策略或系统服务集成；
- 测量证明同进程模型已成为明确的可靠性、性能或安全瓶颈。

物理拆分后仍必须实现同一个 AgentHost 协议；拆分不是改变 PowerI 业务 ID、Session 语义或 UI 接缝的理由。

## 主要数据流

### 本地 C

用户在 UI 发起操作后，UI 调用 AgentClient；LocalAgentClient 将请求交给本地 AgentHost。LocalAgentHost 调度端侧 pi Runtime，访问本地授权工作区，按 PowerI 的 TaskId、SessionId、OperationId 和 WorkspaceId 产出事件与状态，再经同一 AgentClient seam 返回 UI。初期 AgentHost 可以和 web 宿主进程同进程，但协议上不得让 UI 直接绕过 AgentHost 访问 Runtime。

### 云端 B

用户在 UI 发起操作后，UI 调用 RemoteAgentClient。RemoteAgentClient 将带有 PowerI 身份和业务 ID 的请求交给 Gateway；Gateway 执行认证、Workspace 权限检查、Session 串行和路由，并选择 Worker pod。Worker pod 内的 CloudAgentHost 在 sandbox 中驱动 pi 的 RPC 运行时，访问对应 User data store，向 Gateway 回传事件、结果和用量信号。Gateway 负责将这些信号关联到 PowerI 业务对象并返回给 RemoteAgentClient，最后由 UI 展示。

## 后果

### 正面后果

- UI 可以在本地 C 和云端 B 之间更换传输与宿主，而不把传输协议泄漏到界面层。
- Gateway 的权限、Session 串行、路由、事件和计量具有明确的业务归属，不会被 Worker 或 pi session 的偶然实现取代。
- 旧 JSONL/pi session 可继续被渐进式兼容，不要求一次性迁移所有历史数据，也不会把兼容格式升格为新业务模型。
- 本地 C 可先用较小闭环获得反馈，B 的多租户隔离与云端执行可以在契约稳定后单独验证。
- 未来需要后台能力或 OS 隔离时，可以沿 AgentHost seam 拆分，而无需先重写 UI。

### 代价与风险

- 需要维护 PowerI 业务对象与 Runtime 对象之间的映射，并处理事件、取消、恢复和未知结果的状态语义。
- LocalAgentHost 和 CloudAgentHost 可能有不同能力；差异必须被协议和权限明确表达，不能通过静默回退掩盖。
- Gateway 需要承担比简单反向代理更多的持久化、串行、审计和计量责任。
- 在 LocalAgentHost 尚未物理拆分时，web 进程仍可能承受 Runtime 的资源和故障影响；这是已知阶段性代价，不应通过过早拆进程制造更大复杂度。

## 明确不做

- 不把 web 限定为只有 UI 的薄壳。
- 不把 web、Agent Runtime 立即拆成两个独立进程或引入 native-agent 完整框架。
- 不让 Gateway 模式的 web 直接读取宿主文件或直接运行云端业务。
- 不让 pi-ai、pi-agent-core、pi-coding-agent 充当 PowerI 业务控制面；它们属于底层 Runtime。
- 不让旧 JSONL 或旧 pi session 成为 PowerI 业务模型、权限、路由或计量的权威来源。
- 不把上游 pi-web 作为终局业务循环或 Agent Runtime 的持续跟随约束。
- 不在本 ADR 中承诺 LocalAgentHost 立即独立部署、会话自动迁移、Local/Cloud 透明双写或 B 已经完成。

## 与 ADR-0010 的关系

ADR-0010 仍然有效的部分是：PowerI 采用单 monorepo，web、gateway、worker 作为三个独立部署单元，且部署责任分列。

ADR-0010 中关于 web 通过 subtree 持续跟随上游、把上游 UI 关系作为长期开发约束，以及由此推导出的 web 运行时边界，被本 ADR 取代。subtree 和上游 pi-web 只保留为迁移期的 UI/交互资产来源或迁移参考；终局的 AgentClient、AgentHost、PowerI 业务循环和 Agent Runtime 归属以本 ADR 为准。
