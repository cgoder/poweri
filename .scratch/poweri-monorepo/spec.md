Status: ready-for-agent

> **范围校准**：本规格只描述 monorepo 归并、web/gateway/worker 部署分列，以及迁移期的 web subtree/upstream 来源；它不再定义 PowerI 的终局 Agent 架构、AgentClient/AgentHost 边界或业务控制面。终局架构以 ADR-0011 为准。

# Spec: PowerI-Web 上游跟踪迁移（monorepo + subtree）

## Problem Statement

PowerI-Web 当前是**复制式 fork**：以 agegr/pi-web v0.8.6 为基底复制代码后独立演进，git 历史与上游无共同祖先。上游 pi-web 每次发布都只能手动移植——v0.8.6 → v0.8.8 已缺 lib/ 48 文件、components/ 21 文件、app/ 3 文件，同步成本持续累积且随上游迭代加速。

同时平台三模块（worker / gateway / web）分散在三个 gitlab 仓库，平台文档（CONTEXT.md、ADR）与部署编排耦合在 poweri 控制面仓库，无统一代码与文档入口；web 的网关模式改造（网关客户端、每用户认证、路由网关分支）散落多处，与上游文件的边界不清晰。

目标：把三模块合并为单一 monorepo，web 以 git subtree 跟踪 pi-web 上游，使上游升级从"手动移植"变为"一行 subtree pull + 收敛的冲突处理"，并让各模块部署分列、互不阻塞。

## Solution

- **单一 monorepo**（gitlab project：litta-power/poweri，以原 poweri 仓库为基底）：
  - `worker/`：原 poweri 仓库的 worker 沙箱部分（bridge、memory-extension、worker 初始化脚本）经 git mv 归位
  - `gateway/`：原 poweri-gateway 仓库经 `git subtree add`（squash）引入
  - `web/`：以目标 monorepo 的网关适配为基底，受控归并 `github/cgoder/poweri` 的 PowerI web/UI 迭代；保留 PowerI 产品层与端侧 pi Runtime 集成
  - 根：平台文档（CONTEXT.md、docs/adr/）、部署编排/验证脚本、env 样例
- **web 上游跟踪 = 迁移期能力**：迁移期可使用 `git subtree pull --prefix=web <agegr/pi-web> main` 获取 UI/交互资产并收敛适配层冲突；达到 PowerI 自有业务循环与 Agent Surface 目标后可停止。
- **适配层收敛 = 硬约束**：定制优先新增独立文件（上游不存在的文件零冲突）；必须侵入上游文件的改动最小化并记入**定制清单**；每次上游升级前跑校验脚本（结构校验 + 清单校验 + dry-run 冲突预期）。
- **网关模式能力重放**：在 v0.8.8 基底上按需重新设计适配层（不受旧 v0.8.6 实现约束），重放当前 poweri-web 的网关模式能力：开关式双模式（网关配置存在即启用）、每用户 token 认证、网关 API 对接（SSE 短连接 /v1/chat、WS 长连接 /v1/ws、会话历史 /v1/sessions）、模型标识收敛为平台单一模型。
- **部署分列**：各模块目录独立镜像构建与独立部署 manifest（自描述）；先 local 全链路验证，后续内网 gitlab CI + harbor 镜像仓库部署。
- **仓库合并与双远端**：原三个 GitLab project（poweri / poweri-gateway / poweri-web）及当前 web 迭代内容合并到 monorepo；内网 GitLab 作为主开发/CI 远端，外网 `github/cgoder/poweri` 作为同树镜像。两端按同名分支双推，GitHub 不独立开发。

## User Stories

1. 作为平台开发者，我想三模块代码共居单一 monorepo，以便统一管理代码与权限，平台文档有总入口。
2. 作为平台开发者，我想本地 checkout monorepo 后能分别启动 worker / gateway / web 三个模块，以便开发调试。
3. 作为 web 维护者，我想 web 目录以 git subtree 跟踪 pi-web 上游（v0.8.8 基底），以便上游发版时一行命令同步，而不是手动移植。
4. 作为 web 维护者，我想上游升级的冲突收敛到适配层（定制文件集合），以便每次升级的冲突面可预期、可控制。
5. 作为 web 维护者，我想新增定制优先走上游不存在的独立文件，以便 subtree pull 永远自动通过、零冲突。
6. 作为 web 维护者，我想必须侵入上游文件的改动记录在定制清单中（含理由），以便升级时对照清单预期冲突、快速定位。
7. 作为 web 维护者，我想每次上游升级前运行校验脚本（subtree 结构校验 + 定制清单校验 + dry-run），以便低风险执行升级。
8. 作为 web 维护者，我想网关模式保持开关式双模式（网关配置存在即启用），以便 local 验证与生产用同一份代码。
9. 作为 web 维护者，我想每用户认证（用户名 → 网关 token，请求级解析）在新基底上可用，以便多用户场景不回归。
10. 作为 web 维护者，我想网关模式下的会话能力（新建/续接/列表/改名/删除）在新基底上可用，以便与当前功能等价。
11. 作为 web 维护者，我想模型标识在网关模式下收敛为平台单一模型，以便前端状态、历史上下文与网关一致。
12. 作为 web 维护者，我想适配层单测（网关客户端，fake 网关）随重放保留并通过，以便适配层行为有回归保障。
13. 作为部署者，我想各模块目录独立镜像构建、独立 manifest，以便三个模块互不阻塞地发布。
14. 作为部署者，我想先走 local 全链路冒烟验证（浏览器 → web 网关模式 → gateway → worker → 模型），以便确认迁移后链路可用再推进 CI。
15. 作为部署者，我想 monorepo 的部署文件自描述（不依赖 poweri 控制面聚合注入），以便各模块独立部署。
16. 作为部署者，我想后续部署走内网 gitlab CI + harbor 镜像仓库，以便生产发布可追溯。
17. 作为维护者，我想 gitlab 旧三个 project 只读归档，以便历史可追溯、链接不失效。
18. 作为新成员，我想从根 README / 平台文档理解 monorepo 结构与各模块职责，以便快速上手。
19. 作为终端用户，我想迁移后继续使用相同的 Web 交互（聊天、流式输出、会话管理），以便无感知切换。
20. 作为终端用户，我想会话历史经网关续接不丢失，以便断线重连后上下文完整。
21. 作为维护者，我想 monorepo 的同一分支能同步推送到内网 GitLab 与外网 GitHub，以便两个远端不发生代码漂移。

## Implementation Decisions

- **monorepo 结构**：以原 poweri 仓库为基底（保留 git 历史），worker 相关目录 git mv 入 `worker/`；gateway、web 经目录级受控归并进入对应模块。目录边界：worker 沙箱运行物（bridge、memory-extension、worker 初始化脚本）进 `worker/`；部署编排、验证脚本、平台文档留根；Tauri 桌面壳不在本次 web 三模块归并范围内。
- **web 迁移来源**：`github/cgoder/poweri` 当前 web/PowerI 产品层作为一次性迁移输入；目标 `web/` 的 Gateway 适配、容器与部署配置为事实基底。agegr/pi-web 仍是迁移期 UI/交互上游，达到目标后可停止 subtree 跟踪。
- **适配层重放范围**：对照现 poweri-web 的网关模式改造（网关客户端、web 认证、RPC 分支、各 API 路由网关分支、容器化配置如 PI_OFFLINE、平台单一模型标识），在 v0.8.8 基底上重放并**按需重新设计**——不要求与旧实现逐文件一致，只要求能力等价且更收敛。重放时对齐 v0.8.8 的 API 变化（新增文件与接口不在重放范围内，随上游保留）。
- **定制清单机制**：一份机器可读清单记录"侵入上游文件的改动集合"（文件路径 + 改动理由 + 预期冲突风险）；校验脚本在 subtree pull 前验证：当前侵入集合 ⊆ 清单、清单无过期条目；pull 后可 dry-run 对比预期冲突。清单随适配层演进维护。
- **网关模式配置**：沿用开关式环境变量（网关 URL / token / workspace），每用户认证沿用用户名 → token 映射 + 请求级解析；无配置时行为与上游一致（保底可回退）。
- **部署分列**：worker / gateway / web 各目录自描述 manifest（镜像构建脚本 + K8s 配置），部署编排脚本从控制面迁移为"各目录自管 + 根级聚合脚本仅做引用"。本次交付 local 验证路径；gitlab CI + harbor 为后续迭代（结构上预留，不阻塞）。
- **双远端同步**：GitLab 是主开发/CI 远端，GitHub 是同树镜像；`origin` fetch 指向 GitLab，并配置两个 push URL，使 `git push origin <ref>` 双推。旧 web 历史通过合并父提交保留；禁止 GitHub 独立开发或 force push。

## Testing Decisions

- **主缝（端到端，迁移成功的权威标准）**：local 全链路冒烟——monorepo 下启动 gateway（fake provider）→ worker（bridge）→ web（网关模式），浏览器完成：登录/认证 → 新建会话 → 发消息收流式回复 → 会话续接（重开页面历史仍在）。全部通过即迁移成功。
- **辅缝 1（web 适配层单测）**：网关客户端以 fake 网关单测覆盖（先例：现 poweri-web 的 gateway-client 测试）；RPC 分支、认证解析的纯逻辑部分同样单测。
- **辅缝 2（基础设施校验脚本）**：subtree 结构校验（web/、gateway/ 存在且 subtree 元数据正确）、定制清单校验（侵入集合 ⊆ 清单）、subtree pull dry-run 冲突预期输出。每次上游升级前必须通过。
- **回归保障**：上游测试集（pi-web 自带 tests）在重放后全量通过；新增适配逻辑不破坏上游测试。

## Out of Scope

- 场景定制化（UI 品牌、功能裁剪等）——后续逐步立项，本次仅保证"定制机制"（新增文件优先 + 清单）就位。
- jmfederico/pi-web（piweb2）线——不在本次范围。
- gitlab CI 流水线与 harbor 部署落地——本次交付 local 验证路径与自描述 manifest，CI/harbor 为后续迭代。
- 平台功能（计量、账单、User Memory 等）——由既有 ADR 与 feature 覆盖，本次只保证 web 网关模式能力等价。
- 上游 pi-web 的功能增减——随 subtree pull 自然跟随，不做筛选。

## Further Notes

- ADR-0010 记录本决策（含仓库合并、GitLab 主开发与 GitHub 镜像）；ADR-0011 定义 web 的 AgentClient/AgentHost 终局边界；双远端操作见 `docs/dual-remote-sync.md`；CONTEXT.md 已更新 monorepo 结构与 PowerI-Web 词汇。
- 适配层收敛是硬约束而非建议：subtree 冲突面与"侵入上游文件的改动数"成正比，每个 ticket 的验收标准都包含定制清单检查。
- 上游升级节奏建议：跟随 pi-web 发版即升，避免跨版本累积（v0.8.6 → v0.8.8 的教训）。
