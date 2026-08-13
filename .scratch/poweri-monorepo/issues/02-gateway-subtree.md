# 02 — Gateway 并入

**What to build:** 网关模块以 `git subtree add`（squash）并入 monorepo 的 `gateway/` 子目录，代码、测试、部署 manifest 全部随迁；网关单测通过、本地可启动（fake provider），证明并入后模块独立可运行。

**Blocked by:** 01

**Status:** resolved

- [x] `gateway/` 目录包含完整网关代码（含镜像构建、部署 manifest、测试）
- [x] 网关单测全部通过
- [x] 网关本地可启动（fake provider 模式，零外部依赖）
- [x] subtree 元数据正确（后续 subtree pull/split 可识别该前缀）

## Comments

- 2026-08-13：`git subtree add --prefix=gateway <本地 poweri-gateway 仓库> dev --squash` 并入（源 commit f3a9406，与 gitlab origin/dev 同步）。
  验证：gateway 单测 14/14（`cd gateway && node --test "test/*.test.mjs"`，ws 依赖 gateway/ 内 npm install）；本地启动 `node server.mjs`（fake provider 默认零依赖）→ /healthz ok、POST /v1/chat 返回 SSE 流（ready/agent_start/…）、未认证 401；`git subtree pull --prefix=gateway <源> dev` 识别前缀（Already at commit f3a9406，无合并）。
  并入后适配（一次性收口，源仓库将归档、无后续 pull 冲突面）：`scripts/gen-k8s.mjs` 的 POWERI_GATEWAY_DIR 默认改为 monorepo `gateway/`（env 可覆盖，POWERI_WEB_DIR 待 ticket 03）；gateway/README.md、worker/docker/README.md、deploy/k8s/README.md、worker/bridge/session-parse.mjs（契约所有者路径）更新为 monorepo 内路径。
  未跑：gen-k8s 实际部署（本机无 kubectl/K8s，路径解析已用 node 验证）。
