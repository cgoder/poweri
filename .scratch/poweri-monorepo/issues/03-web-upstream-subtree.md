# 03 — Web 上游引入

**What to build:** 上游 agegr/pi-web v0.8.8 以 `git subtree add --prefix=web`（squash）引入 monorepo 的 `web/` 子目录；引入的是**纯净上游代码，零定制**，上游测试全绿、`npm run dev` 可启动（进程内默认模式），为适配层重放提供干净的 v0.8.8 基底。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `web/` 目录为 pi-web v0.8.8 纯净代码（diff 上游无本地改动）
- [ ] 上游测试集通过
- [ ] `npm run dev` 可启动（进程内默认模式）
- [ ] subtree 元数据正确（后续 subtree pull 可识别该前缀）
