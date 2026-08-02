# 24 — pi-web (agegr) 壳提炼：RemoteAgentClient 对接网关（scoped route B 试点）

Type: task
Status: resolved
Blocked by: 23
Created: 2026-08-02
Tags: pi-web-agegr, gateway, adapter, pilot

> 命名规范（CONTEXT.md 词汇表）：本票全程指 **pi-web (agegr)**（npm `@agegr/pi-web` v0.8.6，进程内 pi 0.83.0 = PowerI 同版本），严禁与 **pi-web (jmfederico)**（v1.202607.3，sessiond 分裂，pi 0.82.1）混淆。

## 背景

用户目标：把 pi-web (agegr) 的优秀壳提炼出来对接 PowerI worker（Web UI → 网关 → Worker）。
DeepWiki Q&A（/Users/tianzhao/Downloads/DeepWiki Q&A with Code Context for Repository agegrpi-web.md）+ 研究 docs/research/pi-web-deep-dive.md §6.2 两份独立分析收敛于同一张缝线图：

1. `lib/rpc-manager.ts` — `AgentSessionWrapper.send()` 命令分发 + `startRpcSession` 直接 `createAgentSession`（进程内）→ **核心剥离点**
2. `lib/session-reader.ts` — `SessionManager.listAll()/open()` 直读磁盘 → 换网关会话列表/历史 API
3. `app/api/models`、`app/api/auth/*` — 本地 ModelRegistry/AuthStorage → 本票不接（chat 范围外，stub/保留）
4. `lib/pi-types.ts` — `AgentSessionLike` 接口**已是现成抽象层**（作者本意解耦），RemoteAgentClient 实现它即可

DeepWiki 卡在的前提 5（pi-coding-agent 需 daemon 模式）已被 PowerI 栈满足：`pi --mode rpc`（ADR-0002）+ bridge + gateway `/v1/chat`（SSE）`/v1/ws` 已把协议网络化（ticket 20/21 实测）。

## 目标（scoped：chat 壳）

fork pi-web (agegr) v0.8.6，新增 `RemoteAgentClient`（实现 `AgentSessionLike`），`startRpcSession` 的 `createAgentSession` 换成它，会话列表/历史走 ticket 23 的网关 API（k8s 下 `GET /v1/sessions` + `/v1/sessions/<id>/messages`）。保留前端 chat 全部体验：会话树/流式（thinking+text）/续接/多会话。文件/终端/git/模型/技能/认证路由**不接**（stub 或保留原样，pilot 不测）。

## 验证点

1. **壳会话树**：打开 fork 页面，会话列表来自网关 API（worker PVC 上的 msb* 会话可见）
2. **新会话 + 流式**：prompt 经 gateway `/v1/chat` → worker → 真实 pi（0.83.0），SSE 流式渲染 thinking+text
3. **续接**：重开既有会话，历史来自 `/v1/sessions/<id>/messages`，继续对话
4. **多会话并行**：两个会话同时跑互不阻塞（网关串行锁语义）
5. **记忆累积**：user-memory 扩展在 worker 侧照常工作
6. **不回归**：网关计量（admin usage）正常记录本次对话

## 测试决策（TDD）

纯映射逻辑走单元测试：RPC 事件帧 → `AgentSessionLike` 事件、`AgentSessionLike` 命令 → 网关 payload 的映射函数（node --test，符合 test:unit 惯例）；全链路走 verify-24.mjs（真实网关/worker）。fork 本体（Next.js 路由）不做单测，靠 verify-24 E2E。

## 产出

- 独立仓库 `/Users/tianzhao/code/leoao/poweri-web`（PowerI-Web，初始提交 ce87383，git init 全新历史）
- verify-24.mjs + 运行证据
- Answer：scoped route B 可行性结论 + 对 A′/B/C 决策的影响

## 检查清单

- [x] clone agegr/pi-web v0.8.6 + npm install（本机跑，无需新镜像）
- [x] RemoteAgentClient（GatewaySessionClient，走网关 API）
- [x] startRpcSession 换驱动 + session-reader 换网关
- [x] 单元测试（映射函数 5/5）+ verify-24.mjs（14 项）
- [x] 6 项验证点全过（会话树/流式/续接/并行/记忆/计量）
- [x] code-review（双轴）+ Answer + resolved

## Answer

**结论：scoped route B（pi-web (agegr) 壳提炼 → 网关 → worker）可行且已验证。** fork 以网关模式跑在宿主机（30161），前端 chat 全能力驱动 worker 链真实 pi（0.83.0），verify-24 14 项全过 + 单测 5/5。DeepWiki Q4 的剥离方案成立，前提缺口由 PowerI 栈补齐。

### 实现（改动全部在独立仓库 /Users/tianzhao/code/leoao/poweri-web，旧补丁 docs/research/piweb-gateway-adapter.patch 已被该仓库取代并删除）

- **lib/gateway-client.ts（新，核心）**：`GatewaySessionClient` 实现路由/hooks 实际使用的会话表面（send/onEvent/isAlive/sessionId/waitUntilReady）；`send()` 命令分发表——prompt → 网关 `/v1/chat` SSE（fire-and-forget，ready 事件后 resolve 返回真实 sessionId）、abort → WS `/v1/ws`、get_state/get_session_stats/get_last_assistant_text 本地推导；chat 外命令（fork/compact/bash/模型切换等）安全默认 null（`ponytail:` 标注）。纯函数：`parseSseFrame`（eventsource-parser 适配器，单测契约）/`translateGatewayEvent`（剥 ready/prompt ack/assistantMessageEvent 增量包装）/`gatewayMessageToUi`。SSE 解析用 `eventsource-parser` v3.1.0（ADR-0009 成熟开源优先，Vercel AI SDK 同款），不手撸切帧。
- **lib/rpc-manager.ts**：startRpcSession 网关分支（enabled 时返回 GatewaySessionClient，session_created 事件补注册真实 msb* id）。
- **lib/session-reader.ts**：网关模式 listAllSessions（/v1/sessions）+ resolveSessionPath（合成路径 + 缓存）。
- **路由补丁**：sessions/[id] 历史经网关（context.messages 直构）、agent/new sessionId 动态化 + cwd 短路（工作区在 worker PVC，宿主无 /workspace）、models 快路径（不初始化宿主 SDK）、default-cwd → /workspace（免首开选目录，ticket 21 发现的生产缺口顺手补）。
- **测试**：lib/gateway-client.test.mjs 5 用例（真实网关帧 fixture）；scripts/verify-24.mjs 14 项。

### 关键发现

1. **前端事件面与网关 SSE 天然同构**（都是 pi RPC 事件族）——message_update 需剥 `assistantMessageEvent` 增量包装只留累积 `message`（与 pi-web 期望形状一致，实测帧确认）。
2. **写盘滞后**：prompt_done（流结束）后，worker 的 JSONL 落盘滞后数秒——历史查询需轮询（verify 用 historyCount）。
3. **cwd 分离**：壳的 cwd 校验必须短路（工作区在 worker PVC）；default-cwd 预设 /workspace。
4. **计量完整保留**：本次对话在网关 admin usage 有增量记录——这是 A/A′（旁路网关）做不到的，scoped B 的核心价值。
5. **模型单一**：poweri-gw/agent（worker PVC models.json），模型切换 stub（send 默认 null）。

### 对 A′/B/C 决策的影响

- **壳提炼 = 可工程化**：缝线（AgentSessionLike/wrapper 表面）验证干净，改动量≈本 pilot（1 个 client + 4 个路由 + 测试），chat 全能力 + 计量 + 按需 worker（ADR-0004）兼得。
- **全套工作区**（文件/终端/git/分支/模型切换）仍需网关补 API 族（研究 §6.2）——产品 chat 入口可用 scoped B/C，工作区功能二期。
- **A′（jmfederico sessiond）**仍是「免改造壳」路线（worker 上跑 sessiond 即可），但计量/版本错位不变——B 是唯一兼顾计量与壳体验的路径。

### 崩溃修复（2026-08-02，用户实测后）

用户浏览器实测「聊天页中途崩溃 This page couldn't load」，headless Chrome 复现（65s 生成完成瞬间必崩）。根因：`GatewaySessionClient.getState()` 返回 `extensionStatuses/extensionWidgets: {}`（对象），前端 ChatWindow 按数组 `extensionWidgets.filter(...)` → TypeError → React 渲染崩溃 → 错误页。修复：改回 `[]`（与 in-process get_state 数组形状一致）。同轮修复：会话列表 30s 缓存导致新会话刷新后短暂「数据没了」→ `invalidateGatewaySessions()` 在新会话/每轮 prompt 后失效；`[id]/route.ts` 漏 import（ReferenceError 500）。验证：dev 复现脚本 75s 无 pageerror，verify-24 13/13，生产 30161 已重建。

### 已知债务（ponytail）

- 模型切换/auto-name/分支树为 stub（send 安全默认 + inner no-op；intra-session tree:[]）——chat 范围外。
- fork 注释中英混用（本 repo 中文标准 vs fork 英文约定）——pilot 接受，正式 fork 前定调。
- 事件订阅间 300ms drain 防串流（verify 内）；生产版需要订阅引用计数。

### 运行方式

```bash
cd /Users/tianzhao/code/leoao/poweri-web
export POWERI_GATEWAY_URL=http://127.0.0.1:31080 POWERI_GATEWAY_TOKEN=token-a POWERI_GATEWAY_CWD=/workspace PI_WEB_PASSWORD=poweri-alice
npx next start -H 127.0.0.1 -p 30161
# 浏览器 http://127.0.0.1:30161（pi / poweri-alice）
```

## Comments
