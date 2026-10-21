# poweri-web 独立启动器

> 上游 `bin/pi-web.js` 负责一切本地启动逻辑；PowerI 的独立启动器是 `poweri/bin/poweri-web.js`，
> 它**委托**上游启动器，只覆盖两个默认值。两者互不改写（见 [`replacements.json`](./replacements.json)）。

## 1. 与上游启动器的差异（仅两处）

| 项 | 上游 `pi-web` | PowerI `poweri-web` |
|---|---|---|
| 默认端口 | 30141 | **9989** |
| 浏览器打开路径 | `/`（上游 UI） | **`/poweri`**（产品入口） |

其余全部委托：Node 版本门槛、`PI_WEB_*` 环境变量、`next start` 子进程。

## 2. 为什么不改上游 `bin/`

上游的 opener 只会拼根 URL；要让浏览器落在 `/poweri` 而不改上游文件，唯一位置是启动器本身。
根路径重定向会迫使修改 `proxy.ts` / `next.config.ts`（PowerI 的上游侵入红线）。

## 3. 决策函数与单测

`poweri/bin/poweri-web-options.js` 是纯函数（`resolveLaunch` / `poweriEntryUrl` / `getPoweriHelpText`），
优先级与上游完全一致：**flag > env > fork 默认值**。测试：`poweri/bin/poweri-web-options.test.mjs`。

## 4. 端口交接方式

默认端口通过 `PORT` 环境变量交给上游启动器（上游文档化的 fallback 槽位）；
显式 `-p` / `PORT` 时保持调用方给的值，`launch.portIsDefault` 决定是否注入。

## 5. 浏览器打开方式

需要自己打开时，先设置 `PI_WEB_NO_OPEN=1` 抑制上游 opener（否则会落到 `/`），
start 就绪后再打开 `/poweri`（`READY_TIMEOUT_MS = 60s`，300ms 轮询）。

## 6. 现状注意

`bin/pi-web.js` 与 `bin/pi-web-options.js`（**上游文件**）当前也被改动（`--help`/`-h`、`--hostname`、端口校验），
登记在清单 `poweri-product` 类。这与"不改上游 bin/"的约定冲突，属待决策项：
要么把这段能力移进 `poweri/bin/`，要么承认上游 bin 已纳入可控侵入面。
