# 09 — 计量 + 账单生成

**What to build:** 聚合每用户 Usage meter（pi RPC 事件的 token/成本 + 平台侧资源/数据指标 CPU/存储/带宽/出站）入计量存储，按定价规则由用量生成每用户 Invoice。支付网关不在范围。

**Blocked by:** 03 — 网关骨架：认证 + 路由

**Status:** ready-for-agent

- [ ] RPC 事件与平台指标正确聚合到 per-user 计量
- [ ] 定价规则正确产出每用户账单
- [ ] 计量/账单数据可审计、按用户查询
- [ ] 出账过程幂等（重复运行不重复计费）
