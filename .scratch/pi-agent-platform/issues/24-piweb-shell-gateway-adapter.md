# 24 — pi-web (agegr) 壳提炼：RemoteAgentClient 对接网关（scoped route B 试点）

Type: task
Status: ready
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

- `.research-tmp/agegr-pi-web/`（fork 基底，v0.8.6 tag，gitignored）+ 修改 diff 记录
- verify-24.mjs + 运行证据
- Answer：scoped route B 可行性结论 + 对 A′/B/C 决策的影响

## 检查清单

- [ ] clone agegr/pi-web v0.8.6 + npm install（本机跑，无需新镜像）
- [ ] RemoteAgentClient（AgentSessionLike 实现，走网关 API）
- [ ] startRpcSession 换驱动 + session-reader 换网关
- [ ] 单元测试（映射函数）+ verify-24.mjs
- [ ] 6 项验证点全过
- [ ] code-review（双轴）+ Answer + resolved

## Comments
