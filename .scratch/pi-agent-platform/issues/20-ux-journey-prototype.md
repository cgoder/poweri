# 20 — 用户体验级旅程原型验证（真实 K8s 栈驱动）

- **Type:** prototype
- **Status:** claimed（API 级验证已过；UX 手感待用户在浏览器判定）
- **Depends on:** 19 done（gateway + worker 全 K8s 部署形态）
- **问题（原型要回答的）：** 作为终端用户，平台的完整旅程用起来对不对？——新建会话 / 流式输出 / 多标签并行 / 会话续接 / 记忆累积生效 / 多用户隔离，这些在真实栈（gateway→worker pod→pi→真实模型）上是否成立，体验上哪里别扭。
- **明确不做：** 不做 UI 形态多方案对比（那是另一题）；不调 macOS 本机 pi（用户明确要求用 K8s 里的 poweri-worker）。

## 驱动方式

- 真实链路：浏览器 → 原型反代 → **gateway**（NodePort 31080，`/v1/chat` SSE）→ **worker pod**（`pi --mode rpc` + User Memory 扩展）→ 真实模型（poweri-gw/agent）。
- 会话列表 / 历史 / 记忆：原型服务端经 `kubectl exec` 读 **worker PVC**（每用户 source of truth，网关无会话列表 API）。
- 用户：alice（token-a）/ bob（token-b），gen-k8s 默认布局，PVC 物理隔离。

## 验证点（旅程要素 → 真实证据）

- [x] 新建会话：`session:"new"` → ready 返回新 id，worker PVC sessions/ 出现新 jsonl
- [x] 流式输出：`message_update`/`text_delta` 增量渲染（thinking/text 分栏）
- [x] 多标签并行：alice 同时开 ≥2 会话并发请求，互不阻塞（会话级串行、跨会话并行）
- [x] 会话续接：显式 sessionId → 历史可见 + 上下文延续
- [x] 记忆累积：alice 会话里让 pi 记偏好 → memory.md 落一行；新会话注入生效
- [x] 多用户隔离：bob 看不到 alice 的任何会话/记忆

## 运行

```bash
node scripts/gen-k8s.mjs alice,bob   # 栈已起则跳过
npm run prototype:ux                 # 原型服务 → http://127.0.0.1:8787
```

## Answer

**验证结论（2026-08-01，真实 K8s 栈，全部通过）：** 六个旅程要素在真实链路（gateway→worker pod→pi→真实模型 deepseek-v4-flash）上全部成立：

| 旅程要素 | 证据 |
|---|---|
| 新建会话 | `session:"new"` → 新 id（isNew:true），worker PVC sessions/ 出现新 jsonl（msb18k7j-ddf4fcbf） |
| 流式输出 | 单回合 70 条 message_update 增量（thinking 163 + text 26 events），text_start/delta/end 完整 |
| 多标签并行 | alice 两会话同时请求，各 ~2s 并发完成互不阻塞（会话级串行、跨会话并行成立） |
| 会话续接 | 显式 id → isNew:false，历史上下文保留，模型能回答"我刚才问了什么" |
| 记忆累积 | 模型真实调用 remember 工具 → memory.md 偏好节落 2 条（浅色主题/回复简短）；新会话注入生效（扩展 active） |
| 多用户隔离 | bob PVC 零会话；alice 的会话/记忆对 bob 不可见 |

**UX 待用户判定**（UI 在浏览器驱动）：手感问题留给用户体验后给结论。

**协议发现（写回代码的候选）：** `/v1/chat` 请求体字段是 `session` 不是 `sessionId`（头注释已写明）；网关 `/v1/sessions/<id>/messages` 历史端点对 k8s provider 是坏的——`sessionFileHost` 读网关本地 DATA_DIR，而 k8s provider 下 JSONL 在 worker PVC（原型用 kubectl 读 PVC 绕过；生产候选：改读 worker 或提供会话列表 API）。

**原型主源码：** 分支 `prototype/ux-journey`（commit d90be6b，throwaway 不入 main）。
**运行：** `npm run prototype:ux` → http://127.0.0.1:8787?user=alice
