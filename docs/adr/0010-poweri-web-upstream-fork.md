# PowerI-Web 上游跟踪：monorepo + git subtree，部署分列

PowerI 三模块（worker / gateway / web）合并为单一 monorepo：worker 与 gateway 以 `git subtree add` 并入，web 以 `git subtree` 从上游 agegr/pi-web 引入并持续跟踪；各目录独立镜像与部署。

**背景（问题）：** 原 poweri-web 仓库（gitlab.litta.cn/litta-power/poweri-web）是复制式 fork——以 agegr/pi-web v0.8.6 为基底复制代码后独立演进，git 历史与上游无共同祖先。上游 pi-web 每次发布（v0.8.6 → v0.8.8 已缺 lib/ 48 文件、components/ 21 文件、app/ 3 文件）都只能手动移植，同步成本高且持续累积。已存在的网关适配层（`lib/gateway-client.ts`，开关式双模式）设计正确，问题在仓库关系而非代码。

**决策（decided 2026-08-13，含 monorepo 修订）：**

1. **平台代码库 = 单一 monorepo**（gitlab project `litta-power/poweri`，以原 poweri 仓库为基底）：
   - `worker/` ← 原 poweri 仓库的 worker 沙箱部分（git mv 归入子目录）
   - `gateway/` ← 原 poweri-gateway 仓库（`git subtree add`，squash）
   - `web/` ← 上游 agegr/pi-web（`git subtree add --prefix=web <agegr/pi-web> v0.8.8`，squash）
   - 平台文档（CONTEXT.md、docs/adr/）位于 monorepo 根。
2. **web 上游跟踪 = git subtree pull**：每次上游发版 `git subtree pull --prefix=web <agegr/pi-web> main`，冲突收敛到适配层。github 的 cgoder/pi-web fork 不再承担开发基地角色（仅作参考或废弃），上游源 = agegr/pi-web 官方仓库。
3. **适配层收敛**：定制集中在网关适配层（gateway-client 等少数文件，保持开关式双模式），UI/组件层跟随上游，不做本地大改。适配层允许按需重新设计，不受旧实现约束。subtree 冲突面与适配层文件数成正比，收敛是本决策的硬约束。
4. **gitlab 仓库迁移**：原三个 project（poweri / poweri-gateway / poweri-web）合并为一个 monorepo project；旧 project 设为只读归档（历史保留），monorepo 从当前代码状态 squash 起步。github 不做部署。
   - **执行状态（2026-08-13，ticket 08）**：monorepo 承载于 `litta-power/poweri`（原 poweri project，worker git mv + gateway/web subtree 全量并入，dev/main 已推送）；`litta-power/poweri-gateway`、`litta-power/poweri-web` 待 gitlab UI 只读归档；github 仅承担 agegr/pi-web 上游源角色。
5. **部署分列**：部署编排从 poweri 控制面提取，各模块（worker / gateway / web）在 monorepo 内独立镜像构建、独立部署 manifest，各自分列管理。先 local 验证，后续走内网 gitlab CI + harbor 镜像仓库部署。

**权衡：** 备选方案为独立 fork 仓库 + 双 remote 双推（github 开发、gitlab 部署源）——同步成本最低，但代码库分散三处、平台文档无统一入口；用户明确目标为 monorepo。monorepo 下 subtree 是唯一同时满足"单仓库"与"上游 merge 同步"的方式；代价是 subtree 操作纪律（禁止 subtree split 反向推送、subtree pull 冲突解决）高于普通 merge，因此适配层收敛由"建议"升级为"硬约束"。
