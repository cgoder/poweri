# 04 — 网关模式最小链路

**What to build:** 在 v0.8.8 基底上重放网关模式核心，使"新建会话 → 发消息 → 流式事件 → 会话历史读取"这一条最小链路完整走网关：网关客户端（开关式，网关配置存在即启用）、每用户认证（用户名 → token 请求级解析，无则回退单用户）、核心 RPC 分支、聊天链路相关路由、平台单一模型标识。适配层按需重新设计，不受旧 v0.8.6 实现约束。

**Blocked by:** 03

**Status:** resolved

- [x] 设置网关配置后，新建会话/发消息/流式事件/历史读取全链路走网关（连原 gateway 仓库 local 实例验证）
- [x] 未设置网关配置时行为与上游一致（回退，可保底）
- [x] 每用户 token 认证解析正确（多用户映射 + 回退单用户）
- [x] 适配层单测通过（网关客户端以 fake 网关覆盖，纯逻辑可测）
- [x] 侵入上游文件的改动已逐一记录（定制清单机制启用前先手工记录）

## Comments

- 2026-08-13：v0.8.8 基底适配层重放完成（按需重新设计，不受旧 v0.8.6 实现约束）。
  **新增独立文件**（零冲突）：`lib/gateway-client.ts`（网关客户端 + 每用户认证 resolveWebUser + 平台单一模型 + 跨用户会话归属校验）、`lib/gateway-client.test.mjs`。
  **v0.8.8 关键差异处理**：① 事件透传 pi 原生形状（assistantMessageEvent 保留），由上游 agent-event-wire 的 toClientAgentEvent 统一投影（旧版剥包装的形状不兼容 v0.8.8 前端）；② GatewaySessionClient 实现 v0.8.8 AgentEventStreamSession 接口（isStreaming/streamingMessage），events 路由零改动复用 createAgentEventStream；③ 上游 proxy.ts 已有单用户认证（PI_WEB_PASSWORD），扩展多用户分支（POWERI_WEB_USERS）；④ 上游无 resolveWebUser（每用户解析自包含进 gateway-client）。
  **侵入上游**（11 文件 + package.json 依赖，全部记录于 `docs/web-customizations.md`）：rpc-manager（startRpcSession/getRpcSessionInfos 分支）、session-reader（listAllSessions 分支）、agent/new、agent/[id]、agent/[id]/events、sessions/[id] GET、models、models-config、default-cwd、proxy.ts。
  **gateway/ 配套**（fake 测试缝，源已冻结）：fake 的 message_update 补 assistantMessageEvent（对齐真实形状）；/v1/chat fake 落盘会话 JSONL（列表/历史可验证）；修复 localSessions 缺 import sessionListEntry 的隐藏 bug。
  **验证**（本机 local 实例，fake provider）：单测 8/8；上游测试集 557/557 无回归；gateway 14/14；worker 10/10。全链路：新建会话 → prompt → 流式事件（connected/session_created/agent_start/message_start/message_update/message_end/agent_end/prompt_done）→ 列表 → 历史读取（GW_MODEL）✅；每用户：alice 会话可见、bob 隔离为空、错密码/无认证 401、bob 跨用户访问 alice 会话 404 ✅；回退：无网关配置时 models 返回 SDK 多模型、default-cwd 宿主日期目录、无认证 ✅。
  **环境注记**：本机 shell 有 NODE_ENV=production 残留（dev 需覆盖）；外部 pi-web 守护进程占用 30141（本验证用 30142 规避）；web 依赖安装需 `npm install --include=dev`（全局 omit=dev）。
  **遗留**：会话改名/删除、文件/技能、导出等路由网关分支 → ticket 05；真实 pi 全链路（bridge/docker provider）→ ticket 07。
