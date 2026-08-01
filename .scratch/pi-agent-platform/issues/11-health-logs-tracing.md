# 11 — 健康检查 + 结构化日志 + 追踪

**What to build:** 为桥/网关提供健康与就绪检查（桥以 get_state 校验存活，就绪校验模型可用）；结构化 JSONL 日志接管道；跨网关+Pod 的追踪，支撑排障与审计。

**Blocked by:** 03 — 网关骨架：认证 + 路由

**Status:** done（commit 见下）

**Done:** gateway/log.mjs JSONL 日志（SSE/WS 两通道均记录 requestId/sessionId/usage）；/readyz 探针（docker 引擎探测）；requestId 贯穿桥 prompt id（trace）；verify-11 A/B/C 全过。

- [x] 桥/网关暴露存活与就绪探针（网关 /healthz + /readyz（docker 引擎探测）；桥就绪 = get_state 校验（verify-11 C））
- [x] 请求以结构化 JSONL 落日志管道（gateway/log.mjs，data/logs/<date>.jsonl：requestId/sessionId/userId/usage/duration/ok/channel）
- [x] 同一请求跨网关+Pod 可用 trace 关联（requestId 即 traceId：网关生成 → 桥 prompt id → pi response id 回传，日志同 id 关联）
- [x] 健康/就绪在滚动发布中正确驱动（/healthz + /readyz 即滚动发布就绪门槛，与 ticket 12 联动）
