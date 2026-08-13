# 02 — Gateway 并入

**What to build:** 网关模块以 `git subtree add`（squash）并入 monorepo 的 `gateway/` 子目录，代码、测试、部署 manifest 全部随迁；网关单测通过、本地可启动（fake provider），证明并入后模块独立可运行。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `gateway/` 目录包含完整网关代码（含镜像构建、部署 manifest、测试）
- [ ] 网关单测全部通过
- [ ] 网关本地可启动（fake provider 模式，零外部依赖）
- [ ] subtree 元数据正确（后续 subtree pull/split 可识别该前缀）
