# 01 — Monorepo 骨架（worker 归位）

**What to build:** 以原 poweri 仓库为基底建立 monorepo 骨架：worker 沙箱（bridge、memory-extension、worker 初始化脚本）归位到 `worker/` 子目录，平台文档（CONTEXT.md、docs/adr/）、部署编排与验证脚本留在根目录；根 README 更新为 monorepo 结构说明，供新成员快速理解三模块职责。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] worker 沙箱代码位于 `worker/` 子目录，git 历史可追溯（git log --follow）
- [ ] 根级验证脚本/常用命令迁移后仍可运行
- [ ] 根 README 描述 monorepo 结构（worker/、gateway/、web/ 及根职责），标注 web 待 subtree 引入
- [ ] 边界不确定文件的归类（运行时属 worker 沙箱 vs 平台控制面）判定后记入根文档
