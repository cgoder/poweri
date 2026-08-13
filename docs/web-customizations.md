# Web 适配层定制清单（web/ 上游跟踪）

> 机制（spec 硬约束）：web/ 以 git subtree 跟踪 agegr/pi-web 上游。**定制优先新增独立文件**（上游不存在的文件 → subtree pull 零冲突）；**必须侵入上游文件的改动**记录于此清单（文件 + 理由 + 预期冲突风险），每次上游升级前对照本清单预期冲突。
> **机器可读唯一源为 [`docs/web-customizations.json`](web-customizations.json)**（校验脚本 scripts/validate-customizations.mjs 读取），本表为人读视图，修改清单请改 JSON。
> 维护：随适配层演进更新（ticket 04 建立，ticket 06 机器化）。

## 独立新增文件（零冲突，subtree pull 自动通过）

| 文件 | 内容 |
|---|---|
| `web/lib/gateway-client.ts` | 网关会话客户端（开关式：`POWERI_GATEWAY_URL`+`POWERI_GATEWAY_TOKEN` 存在即启用）。含：GatewaySessionClient（send/onEvent/isStreaming/streamingMessage，兼容 v0.8.8 AgentEventStreamSession）、每用户认证解析（resolveWebUser：POWERI_WEB_USERS 多用户表优先 + POWERI_WEB_PASSWORD 单用户回退）、平台单一模型 GW_MODEL（poweri-gw/agent）、会话列表/历史/改名/删除 fetch、跨用户会话归属校验（isGatewaySessionOwner）。v0.8.8 重放设计：事件**透传** pi 原生形状（assistantMessageEvent 保留），由上游 agent-event-wire 统一投影 |
| `web/lib/gateway-client.test.mjs` | 适配层单测（fake 网关：SSE 帧解析/事件透传/AgentEventStreamSession 兼容/历史映射/每用户 token） |
| `web/lib/rpc-manager-gateway.test.mjs` | rpc-manager/session-reader 网关分支源码断言单测 |
| `web/lib/gateway-routes-gateway.test.mjs` | 11 个路由网关分支源码断言 + fake-fetch 文件/技能接入单测 |

## 侵入上游文件（升级冲突预期）

| 文件 | 改动 | 理由 | 冲突风险 |
|---|---|---|---|
| `web/lib/rpc-manager.ts` | `startRpcSession` 开头加网关分支（返回 GatewaySessionClient，registry 注册 + session_created 补注册）；`getRpcSessionInfos` 网关模式返回 [] | 网关模式不建进程内 AgentSession，会话由网关管理 | 高（startRpcSession 上游频繁演进；分支块短，冲突易解） |
| `web/lib/session-reader.ts` | `listAllSessions` 开头加网关分支（会话列表来自网关 /v1/sessions + cacheSessionPath） | 网关模式不扫本地磁盘 | 中 |
| `web/app/api/agent/new/route.ts` | 网关分支：cwd 缺省 gatewayConfig.workspace、跳过 existsSync 校验、ensure_session 后 invalidateGatewaySessions | 真实工作区在 worker PVC（/workspace），宿主无目录 | 低 |
| `web/app/api/agent/[id]/route.ts` | POST fast path 加跨用户隔离校验（isGatewaySessionOwner 不匹配 → 404） | 单实例 web 共享 registry，防止跨用户访问会话 | 低 |
| `web/app/api/agent/[id]/events/route.ts` | GET fast path 加跨用户隔离校验 | 同上（事件流订阅） | 低 |
| `web/app/api/sessions/[id]/route.ts` | GET 网关分支：历史来自 /v1/sessions/<id>/messages（gatewayMessageToUi 渲染，上下文含 GW_MODEL） | 历史 JSONL 在 worker PVC，宿主不可读 | 中 |
| `web/app/api/models/route.ts` | GET 网关分支：返回平台单一模型 poweri-gw/agent | 模型由 worker PVC models.json 决定，宿主不初始化 SDK | 低 |
| `web/app/api/models-config/route.ts` | GET 只读展示 worker 模型配置；PUT 网关模式 403 | worker 的 models.json 由部署链管理，禁止宿主编辑 | 低 |
| `web/app/api/default-cwd/route.ts` | POST 网关分支：返回 gatewayConfig.workspace（/workspace） | 真实工作区在 worker PVC | 低 |
| `web/proxy.ts` | 网关模式认证分支：POWERI_WEB_USERS/POWERI_WEB_PASSWORD 启用时 resolveWebUser 校验（多用户），上游 PI_WEB_PASSWORD 逻辑保留为回退 | 每用户认证（用户名→网关 token 请求级解析的前提） | 低 |
| `web/app/api/sessions/[id]/route.ts` | PATCH/DELETE 网关分支（改名/删除经网关 → worker PVC；删除时 registry shutdown + 列表缓存失效） | 会话文件在 worker PVC，宿主不可读写 | 中 |
| `web/app/api/sessions/[id]/context/route.ts` | GET 网关分支（历史经 gatewayHistoryContext） | v0.8.8 新增路由；网关模式无本地 entries | 低 |
| `web/app/api/sessions/[id]/auto-name/route.ts` | POST 网关分支（首条用户消息派生标题，不走模型） | worker 无会话命名 API | 低 |
| `web/app/api/sessions/[id]/export/route.ts` | GET 网关分支（JSONL 经网关落临时文件再导出，事后清理） | 会话 JSONL 在 worker PVC | 低 |
| `web/app/api/file-index/route.ts` | GET 网关分支（经网关递归列出 + q 过滤） | 文件在 worker PVC | 低 |
| `web/app/api/files/[...path]/route.ts` | GET 网关分支（read/meta/list；download/preview/watch 明确拒绝） | 同上；二进制/流式能力未接 | 低 |
| `web/app/api/plugins/route.ts` | GET 空列表 + POST 拒绝 | worker 无插件包体系 | 低 |
| `web/app/api/skills/route.ts` | GET 经网关扫描；PATCH 拒绝（SKILL.md 在 worker PVC） | 技能播种走 seed-skills | 低 |
| `web/app/api/cwd/browse/route.ts` | 网关模式拒绝（400） | 工作区固定 /workspace；防宿主目录枚举（上游 browse 无授权检查） | 低 |
| `web/app/api/cwd/validate/route.ts` | 网关模式拒绝（400） | 工作区固定 /workspace | 低 |
| `web/package.json` | dependencies 增加 `eventsource-parser@^3.1.1` | SSE 增量解析（业界标准，Vercel AI SDK 同款） | 低（上游加同依赖时冲突易解） |

## gateway/ 内改动（源仓库已冻结归档，无 pull 冲突面；仅记录）

| 文件 | 改动 | 理由 |
|---|---|---|
| `gateway/pods.mjs` | fake provider 的 message_update 事件补 `assistantMessageEvent`（对齐真实 pi 事件形状） | v0.8.8 web 端 toClientAgentEvent 依赖该字段（本地 fake 验证链路） |
| `gateway/server.mjs` | fake 模式 `/v1/chat` 落盘会话 JSONL（sessionFileHost，首行 session header）；修复 localSessions 缺 import `sessionListEntry` 的隐藏 bug；localFiles/localFile 路径语义对齐 bridge（/workspace 前缀映射，未初始化目录返回空）；递归列表输出对齐 bridge 形状（/workspace/... 相对路径） | fake 是主测试缝：会话列表/历史/导出可验证（ticket 04/05）；真实 worker 写文件格式含 session header，导出等 SDK 消费路径需要 |

## 后续路线（ticket 05+）

- 会话改名/删除（PATCH/DELETE /api/sessions/[id] 网关分支，fetchGatewaySessionRename/Delete 已就绪）→ **ticket 05 已完成**
- 文件浏览器/技能菜单（/v1/files、/v1/skills 网关代理）→ **ticket 05 已完成**
- 会话导出（/v1/sessions/<id>/jsonl）→ **ticket 05 已完成**
- sessions/[id]/context、auto-name、cwd/browse+validate 网关分支 → **ticket 05 已完成**
- 插件管理（worker 无插件包体系，GET 空/POST 拒绝）→ **ticket 05 已完成**
- 真实 pi 全链路冒烟（bridge/docker provider + 浏览器交互）→ ticket 07（local-e2e-smoke）
- 定制清单校验脚本（结构校验 + 清单校验 + dry-run 冲突预期）→ **ticket 06 已完成**（scripts/validate-customizations.mjs，流程见 docs/upstream-upgrade-process.md）
