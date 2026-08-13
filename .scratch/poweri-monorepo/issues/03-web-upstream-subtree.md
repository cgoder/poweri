# 03 — Web 上游引入

**What to build:** 上游 agegr/pi-web v0.8.8 以 `git subtree add --prefix=web`（squash）引入 monorepo 的 `web/` 子目录；引入的是**纯净上游代码，零定制**，上游测试全绿、`npm run dev` 可启动（进程内默认模式），为适配层重放提供干净的 v0.8.8 基底。

**Blocked by:** 01

**Status:** resolved

- [x] `web/` 目录为 pi-web v0.8.8 纯净代码（diff 上游无本地改动）
- [x] 上游测试集通过
- [x] `npm run dev` 可启动（进程内默认模式）
- [x] subtree 元数据正确（后续 subtree pull 可识别该前缀）

## Comments

- 2026-08-13：`git subtree add --prefix=web /tmp/pi-web-agegr v0.8.8 --squash` 引入（源 commit 0877bff，github agegr/pi-web 官方仓库，cgoder fork 已弃用）。
  验证：跟踪文件清单与上游 v0.8.8 零差异（diff -rq 仅剩 .next/next-env.d.ts 生成物，均被上游 .gitignore 忽略）；上游测试集 549/549 通过（`npm test`，node --experimental-strip-types）；`npm run dev` 启动 HTTP 200（title "Pi Web"，进程内默认模式）；`git subtree pull --prefix=web <源> v0.8.8` 识别前缀。
  环境注记：本机 npm 全局 omit=dev，装依赖需 `npm install --include=dev`；npm install / next dev 会改写 web/package-lock.json（peer 标记）与 tsconfig.json（.next/dev/dev include），系工具自动行为，已恢复不入库——web/ 保持纯净，后续适配走独立文件（spec 硬约束）。
  未跑：真实浏览器交互（验证以 HTTP/测试集为准）。
