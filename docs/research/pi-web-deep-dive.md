# pi-web 深度调研：能否作为 PowerI chat 场景的业务入口

> 调研背景：PowerI 平台（~1 万用户，Web UI → 网关 → Worker 容器 → pi-coding-agent）需要确认 `@agegr/pi-web`（锁定 0.8.6，镜像 poweri-piweb:local）是否适合作为 chat 场景业务入口。当前形态是"每用户一个实例、进程内 SDK 驱动 pi、旁路网关"（ticket 15/17/21 已定）。本报告追到一手源码，回答：pi-web 本身是否符合预期；若不符合，改什么、改造成本多大。
> 调研时间：2026-08-02。版本：pi-web **v0.8.6**（GitHub main == v0.8.6，0 个提交漂移）；pi SDK **0.83.0**（宿主 node_modules 与 pi-web 锁定一致）。
> 一手来源：
> - pi-web 源码 clone 于 `.research-tmp/pi-web`（本仓库内临时目录，调研用，可删）。所有结论标注 `文件路径:函数/路由`。
> - pi SDK 宿主包 `/Users/tianzhao/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/`（简称 `SDK`）。
> - PowerI 网关 `gateway/server.mjs`；原型 `.scratch/pi-agent-platform/issues/20-ux-journey-prototype.md`。
>
> 置信度标注：`[高]` 源码直接确认；`[中]` 源码推断 / 跨版本风险；`[低]` 推测。

---

## 0. 结论速览

**判断：pi-web 0.8.6 是优秀的"每用户交互式工作区 UI"，但不是 10k 用户产品 chat 业务入口的现成答案。**

- **chat 体验面（故事 1-10）**：原生全覆盖 —— 多会话/续接/流式/文件/工具，源码实证。作为"用户浏览器里的 pi 工作台"完全合格。
- **平台面（故事 11-38 中的计量/账单/管理员/弹性/网关路由）**：pi-web **完全没有**，且其架构**必然旁路网关**（进程内 SDK 直驱 pi，`lib/rpc-manager.ts`），网关无法计量它产生的 token/成本 → 故事 16/33/34 直接不成立。
- **形态成本**：10k 用户 = 10k 常驻实例（每实例 ~1Gi 内存限额、1.1GB 镜像、一个 Next.js 服务 + 一个进程内 pi），与 ADR-0004"按请求调度 Worker + 温池"的成本模型是反的。
- **两条已知生产缺口**（ticket 21 实测）：default-cwd 硬编码 `~/pi-cwd-<日期>` 无服务端预设；user-memory 扩展未挂进 pi-web 的进程内 pi（settings.json 无 extensions 配置、镜像无 /poweri/extensions）——**均可小补丁修复**（见 §9 待决策）。

**路线结论（详见 §6、§9）：**

| 路线 | 形态 | 成本 | 推荐度 |
|---|---|---|---|
| **A** 每用户 pi-web 实例直连（现状） | K8s + N 个 pi-web Pod 挂用户 PVC | 低（已落地，ticket 15/21） | **保留**：交互可视化/联调/测试入口 |
| **B** fork pi-web 成网关客户端 | 替换进程内 SDK 为网关 REST/WS | 高（见 §6.2 调用点清单）；ticket 17 已否决 | 不做，除非要全套工作区功能进产品 |
| **C** 轻量 Web UI 直连网关（新建/原型续） | 无状态网关 + 按需 Worker | 中（原型已证 6 旅程要素） | **推荐**：产品 chat 业务入口 |

---

## 1. 项目形态

### 1.1 技术栈与依赖（`package.json`，`[高]`）

- **Next.js 16.2.12**（`next` 精确锁版）+ React ^19.2.4 + Tailwind 4 + TypeScript 5；Node engines `>=22.19.0`。
- **pi 四件套全部精确锁 `0.83.0`**：`@earendil-works/pi-agent-core` / `pi-ai` / `pi-coding-agent` / `pi-tui` —— 与 PowerI 锁定的 pi 版本**完全一致**，版本兼容零风险（ticket 15 已确认）。
- 其余：`proper-lockfile`（auth.json 写锁）、`undici`（HTTP dispatcher，`instrumentation.ts` 在 nodejs runtime 配置）。
- 无 Dockerfile（仓库根目录无）——容器化是 PowerI 自己做的（ticket 15 的 Dockerfile）。
- 注意：pi-web 是**全栈单包**：Next.js server（API）+ 浏览器客户端 + PWA（`app/manifest.ts`、`sw.js`）。

### 1.2 构建与发布（`package.json` files/scripts、`docs/release.md`，`[高]`）

- `files` 明确包含 **`.next` 构建产物**（排除 `.next/cache`、`.next/dev`、map 文件）+ `bin/` + `public/` + `next.config.ts` → **npm 包开箱即用，无需运行时构建**（镜像 1.11GB 即此原因，ticket 15 实测）。
- `bin`: `pi-web` → `bin/pi-web.js`：校验 Node 版本 → `parseLaunchOptions`（`bin/pi-web-options.js`）→ spawn `next start -p <port> -H <hostname>`；非 loopback 且无密码时打安全警告。默认 `127.0.0.1:30141`。
- 发布：`npm run release` = `npm version patch` + `next build --webpack` + `npm publish`；`docs/release.md` 要求 main 干净、出 GitHub Release。

### 1.3 License 与上游活跃度（`LICENSE`、`git log`，`[高]`）

- **MIT**。
- 仓库 440 commits，2026-03-18 起步 → 2026-08-01；**main == v0.8.6（零漂移）**。
- **v0.8.x 近每日发版**：v0.8.0 07-22 → v0.8.6 08-01（7 版/10 天）。上游非常活跃，且持续在做**本报告关心的域**：v0.8.6 新增 Basic Auth 前（07-30）就已有 `feat: add optional password authentication`、`Write model configuration atomically`、插件安装、事件流保持、Windows 盘符选择、iOS PWA 等 —— **upstream 演进快 = fork 合流成本高**。
- 贡献者以 Alex Yang（主维护）为主 + 社区 PR（Winrunner_20、AKAZIK-py、pazhik、Peter.S、陈~、dingxiaobo 等）。

### 1.4 remote / headless / multi-user / gateway 相关（README 全文 grep，`[高]`）

- README/AGENTS.md **零** multi-user、gateway、remote 表述；"remote" 仅出现在 Basic Auth 安全警告（"do not expose plain HTTP to the internet"）。
- `AGENTS.md` 架构图（见 §2.1）明确：浏览器 → Next.js Server → **进程内 AgentSession**。

---

## 2. 架构

### 2.1 server/client 边界与 pi 驱动链路（`AGENTS.md` 架构图 + `lib/rpc-manager.ts`，`[高]`）

```
Browser                Next.js Server              AgentSession (进程内)
  │                        │                               │
  ├─ GET /api/sessions ────▶ lib/session-reader.ts ────────▶ 读 ~/.pi/agent/sessions/*.jsonl（SessionManager，只读，不建会话）
  ├─ POST /api/agent/new ──▶ startRpcSession() ────────────▶ createAgentSessionServices() + createAgentSessionFromServices()
  │                        │   session.send(cmd) ──────────▶ AgentSession.prompt()/steer()/...
  ├─ GET /api/agent/[id]/events (SSE) ◀── session.onEvent() ◀ AgentSession.subscribe()
  └─ POST /api/agent/[id] ─▶ 命令分发（fire-and-forget，见 §2.3）
```

**核心事实**：pi-web 在**自身 Node 进程内**以 SDK `AgentSession` 驱动 pi —— 不是子进程、不是 `pi --mode rpc`、不是远程。SDK 文档明确推荐 Node 应用走进程内 API（`SDK/docs/rpc.md` 开篇："If you're building a Node.js application, consider using AgentSession directly … instead of spawning a subprocess"），pi-web 正是此推荐形态。

### 2.2 认证与中间件（`proxy.ts` + `lib/web-auth.ts` + `lib/request-security.ts`，`[高]`）

- `proxy.ts` matcher `["/", "/api/:path*"]` 全站拦截，三层：
  1. **Host 信任**：loopback / IP 字面量 / `PI_WEB_HOSTNAME` 或 `PI_WEB_ALLOWED_HOSTS`（逗号分隔）之一（防 DNS rebinding；`isApiRequestHostAllowed`）。
  2. **Origin 检查**：`sec-fetch-site: cross-site` 拒绝；非浏览器客户端（无 Origin）放行（`isApiRequestOriginAllowed`）。
  3. **Basic Auth**（`isWebPasswordEnabled` 判断 `PI_WEB_PASSWORD` 存在）：username **恒为 `pi`**（`PI_WEB_AUTH_USERNAME`），sha256 后 `timingSafeEqual` 比较（`lib/web-auth.ts`）。
- **单密码、单用户**，无账号体系。SSE 同源请求浏览器自动带 Basic 缓存，工作正常（ticket 15/21 实测）。
- `instrumentation.ts`：nodejs runtime 下 `configureHttpDispatcher()`（undici 全局 dispatcher）。

### 2.3 命令面：AgentSessionWrapper（`lib/rpc-manager.ts:send()`，`[高]`）

`AgentSessionWrapper` 把 SDK AgentSession 包装成"命令 → 响应 + 事件流"，命令清单（**与 pi RPC 模式命令几乎 1:1**，见 §8.2）：

| 命令 | 语义 |
|---|---|
| `prompt` | **fire-and-forget**：立即返回，事件走 SSE；结束时发 `prompt_done`；streaming 中需 `streamingBehavior:"steer"|"followUp"`（客户端 `hooks/useAgentSession.ts:1602`） |
| `steer` / `follow_up` | 流式期间的排队消息 |
| `abort` / `abort_bash` / `abort_compaction` | 中断 |
| `get_state` | 模型/流式/压缩/队列/contextUsage/扩展状态（就绪探针用） |
| `set_model` / `set_thinking_level` / `set_tools` / `set_auto_compaction` / `set_auto_retry` / `set_session_name` | 会话配置 |
| `fork` / `navigate_tree` | 分支/导航（SessionManager.createBranchedSession） |
| `compact` | 手动压缩 |
| `get_tools` / `get_commands` / `get_session_stats` / `get_last_assistant_text` / `clear_queue` | 查询（`get_session_stats` 返回 token/cost —— pi-web 唯一用量来源） |
| `bash` | 直跑 shell 命令（不经 LLM），`persistBashOnlySession` 补写 JSONL |
| `reload` | 重载资源/扩展 |
| `extension_ui_response` / `extension_ui_input` | 扩展 UI 子协议应答 |

配套机制：`startRpcSession`（`lib/rpc-manager.ts`）——建会话锁（`__piStartLocks`）、注册表（`globalThis.__piSessions`）、**空闲 10 分钟自动 shutdown**（`resetIdleTimer`）、运行态 SSE 广播（`subscribeRunningSessions`）、扩展绑定 `bindExtensions(mode:"rpc")`（`lib/rpc-manager.ts:ensureExtensionsBound`）——**扩展在 pi-web 里以 rpc 模式绑定并全功能可用**（含扩展 UI 对话框，见 §5.4）。

### 2.4 每个 API 路由的职责与语义（`app/api/*`，全部源码确认，`[高]`）

| 路由 | 语义 | 读/写对象 |
|---|---|---|
| `POST /api/agent/new` | 建新 pi 会话；`type:"ensure_session"` 只建运行时返回 sessionId；`cwd` 必须存在 | 进程内会话 + 磁盘 JSONL |
| `GET/POST /api/agent/[id]` | GET=状态快照；POST=命令分发（fast path 走注册表，冷启走 `resolveSessionPath` 从 JSONL 恢复） | 进程内会话 |
| `GET /api/agent/[id]/events` | **SSE 事件流**（省略 turn_start/turn_end/tool_execution_update；`message_update` 剥掉 `assistantMessageEvent` 冗余；心跳 30s） | 进程内会话 → 浏览器 |
| `GET /api/agent/running[/events]` | 运行中会话 id 快照 / SSE 推送 | 注册表 |
| `GET /api/sessions` | 会话列表（`SessionManager.listAll()`，30s 缓存，含 projectRoot/父会话/首条消息） | 磁盘 JSONL |
| `GET /api/sessions/[id]` | 会话树 + 上下文（`buildSessionContext`，deferThinking/deferMedia 参数） | 磁盘 JSONL |
| `PATCH /api/sessions/[id]` | 改名（appendSessionInfo） | 磁盘 JSONL |
| `DELETE /api/sessions/[id]` | 删会话 + 子会话重挂父（cascade re-parent） | 磁盘 JSONL |
| `GET /api/sessions/[id]/context` | 指定 leaf 的上下文 | 磁盘 JSONL |
| `GET /api/sessions/[id]/state` | 运行态（`get_state`） | 进程内会话 |
| `POST /api/sessions/[id]/auto-name` | LLM 生成标题（`lib/session-title.ts`，额外一次模型调用） | 进程内会话 |
| `GET /api/sessions/[id]/entries/[entryId]/thinking` | 懒加载 thinking 块 | 磁盘 JSONL |
| `GET /api/sessions/[id]/export` | 导出 HTML（调用 pi 包的 export-html） | 磁盘 JSONL |
| `GET /api/cwd/browse`、`POST /api/cwd/validate` | 目录浏览器 / cwd 校验 | 文件系统 |
| `POST /api/default-cwd` | **硬编码创建 `~/pi-cwd-<YYYYMMDD>`** 并返回（`app/api/default-cwd/route.ts`）—— 无任何 env/配置预设入口 | 文件系统 |
| `GET /api/home` | 返回 `homedir()` | 文件系统 |
| `GET/POST /api/files/[...path]` | 文件列表/读/下载/预览（图片/音频/DOCX，mammoth）/watch SSE/上传（25MB/单、100MB/总）；**允许根 = 会话 cwd + projectRoot + `~/pi-cwd-*` + allowFileRoot 增量**（`lib/file-access.ts`，5s TTL 缓存）；会话引用文件豁免 | 文件系统（沙箱化） |
| `GET /api/file-index` | 模糊搜索文件索引（git ls-files / readdir，上限 5k 响应 / 200k 索引） | 文件系统 |
| `GET /api/models` | 模型列表（`createAgentSessionServices` + `resolveVisibleModels`，60s 缓存，cwd 参数） | models.json + ModelRuntime |
| `GET/PUT /api/models-config` | **原子读写 `agentDir/models.json`**（`lib/atomic-file.ts` 0600 + rename）——界面改模型/thinking 即写回，与 pi 共用同一配置 | models.json |
| `GET /api/models-config/catalog` | models.dev 目录（1h 缓存，用于预设定价） | 外网 |
| `POST /api/models-config/discover` | 拉 provider 上游模型列表（20s 超时） | 外网 |
| `POST /api/models-config/test` | 临时目录写 models.json + `completeSimple` 实测模型（20s 超时） | 外网 |
| `GET /api/skills` | 技能列表（DefaultResourceLoader，含 settings.json 路径/包技能/.agents/skills） | agentDir + cwd |
| `PATCH /api/skills` | 切 `disable-model-invocation` frontmatter | SKILL.md |
| `POST /api/skills/install` | `npx skills add`（`lib/npx.ts`） | agentDir/npm 目录 |
| `GET/POST /api/skills/search` | skills.sh 搜索（`SKILLS_API_URL` 可覆盖） | 外网 |
| `POST /api/skills/check` / `update` | 技能版本检查（GH_TOKEN/GITHUB_TOKEN）/ 更新 | 外网 + agentDir |
| `GET/POST /api/plugins` | **包管理器 UI**：npm/git 包（含 extensions/skills/prompts/themes 资源）的 list/install/remove/update/disable/enable，写 settings.json `packages`（`DefaultPackageManager`） | settings.json |
| `GET/POST/DELETE /api/worktrees` | git worktree 增删列（`lib/worktree.ts`） | git fs |
| `GET /api/git/status` / `git/diff` | 变更状态 / 文件 diff | git fs |
| `POST /api/project-trust` | 项目信任开关（防 .pi/extensions 未信任即执行；`lib/project-trust.ts`） | trust.json |
| `GET /api/auth/providers`、`all-providers` | OAuth / API-key provider 清单 | ModelRuntime |
| `GET/POST/DELETE /api/auth/api-key/[provider]` | API key 存取（写 `agentDir/auth.json`，0600 + proper-lockfile，与 pi 的 AuthStorage 同一文件同一锁） | auth.json |
| `GET/POST /api/auth/login/[provider]` | OAuth/device-code 流程（SSE 桥接浏览器）；手动 code 回传 | auth.json |
| `POST /api/auth/logout/[provider]` | OAuth 登出 | auth.json |

---

## 3. 状态模型

### 3.1 服务端（磁盘 + 进程内，`[高]`）

| 对象 | 位置 | 说明 |
|---|---|---|
| 会话 | `<agentDir>/sessions/--<cwd编码>--/<时间戳>_<sessionId>.jsonl` | `SDK/dist/core/session-manager.js:242 getDefaultSessionDirPath`（cwd 的 `/`、`:` 转 `-`，`--` 包裹）；`agentDir` 默认 `~/.pi/agent`，`PI_CODING_AGENT_DIR` 可覆盖；会话目录 `PI_CODING_AGENT_SESSION_DIR`/`--session-dir` 可覆盖。**注意：PowerI 网关链用 `--session <path>` 写顶层 `sessions/<网关id>.jsonl`，pi-web 写 `sessions/--cwd--/`，两套子布局共存不冲突（ticket 15 实证）** |
| 模型配置 | `<agentDir>/models.json` | 原子写 0600（`lib/atomic-file.ts`），与 pi CLI 同一份 |
| 全局设置 | `<agentDir>/settings.json` | SDK SettingsManager 读写：model 默认、`packages`/`extensions`/`skills` 路径、enabledModels 等（`SDK/docs/settings.md`） |
| 项目设置 | `<cwd>/.pi/settings.json` | 项目级（受 project-trust 门控） |
| 凭据 | `<agentDir>/auth.json` | provider 凭据，0600 + proper-lockfile（与 pi AuthStorage 同文件同锁） |
| 信任 | `<agentDir>/trust.json` | 项目信任决策 |
| worktree | git fs | 由 lib/worktree.ts 管理 |
| **进程内运行时** | `globalThis.__piSessions` 等注册表 | 会话注册表/启动锁/运行态监听（`lib/rpc-manager.ts` 底部）——**崩溃即失，只缓存运行时，不缓存业务数据** |

### 3.2 客户端（浏览器，`[高]`）

React 状态（`components/AppShell.tsx` 的 `newSessionCwd`、`components/SessionSidebar.tsx` 的 `selectedCwd`）**不是**持久化的；localStorage 只有 5 个 key（grep 全库确认，无 sessionStorage/indexedDB/cookie）：

| key | 内容 |
|---|---|
| `pi-theme` | 主题 |
| `pi-sound-enabled` | 提示音开关 |
| `pi-locale` | 语言（en/zh-CN） |
| `pi-web:unread-session-ids` | 侧栏未读标记 |
| useResizablePanel 的 `storageKey` | 面板宽度 |

**关键澄清（修正 ticket 21 表述）**：cwd 并不是"只存浏览器 localStorage"——刷新后 cwd 由服务端**从会话列表反推**（`SessionSidebar.tsx:getRecentProjects`：取最近修改的 projectRoot）。但 ticket 21 的核心结论仍成立：**无服务端/环境变量预设 cwd**；`POST /api/default-cwd` 硬编码 `~/pi-cwd-<日期>`（`app/api/default-cwd/route.ts`），生产环境需要用户每浏览器手动选 `/workspace`，或小补丁。

### 3.3 远程 / RPC / headless 支持排查（`[高]`，见 §8.2）

- pi SDK **RPC 模式是纯 stdin/stdout**（`SDK/docs/rpc.md`：strict JSONL），**无任何网络 server**：grep `SDK/dist/modes/rpc/*.js` 无 createServer/WebSocket/net 导入；`rpc-entry.js` = `main(["--mode","rpc"])`。
- SDK 提供的 `rpc-client.ts` 也是**子进程 stdio 客户端**。
- pi-web **不能指向远程 pi**：唯一驱动路径是进程内 `createAgentSessionFromServices`。**"把 pi-web 接到远程 Worker"没有现成开关，只能改代码（路线 B）**。

---

## 4. 多租户能力（`[高]`）

- **单实例能力**：单密码 Basic Auth（username 恒 `pi`），无用户/角色/配额体系（`lib/web-auth.ts`）。所有 API 面等同整个本地用户文件系统（受 allowed-roots 沙箱约束，但沙箱根 = 该实例 agentDir 的会话 cwd + home 下 pi-cwd-*）。
- **无多用户共享实例能力**：无账号、无 per-user 数据分区逻辑、无审计日志。进程内注册表/缓存全部 `globalThis` 单例。
- **我们的部署（每用户一实例）的隔离面** = 容器 + 进程 + 独立 `PI_CODING_AGENT_DIR`/PVC：
  - 隔离 ✓：会话/文件/记忆/配置/凭据（各自 agentDir、各自 home、各自 cwd 集合）。
  - 隔离风险 ✓：`GET /api/home` 返回各自容器 home；`/api/cwd/browse` 可浏览容器内任意可读目录（受容器本身权限约束）——攻击面 = 容器逃逸/凭据泄漏，而非应用层。
  - 多用户"并发"在模式 A 里 = 多实例并发，各自进程独立，互不感知——**平台语义（串行/排队/计量）全部缺位**。

---

## 5. 扩展点

### 5.1 环境变量全集（grep 全库，`[高]`）

pi-web 自有：`PI_WEB_PASSWORD`、`PI_WEB_HOSTNAME`、`PI_WEB_ALLOWED_HOSTS`（逗号分隔）、`PI_WEB_NO_OPEN`、`PORT`、`SKILLS_API_URL`（技能搜索/更新检查）、`GH_TOKEN`/`GITHUB_TOKEN`（技能更新检查）、`NEXT_PUBLIC_APP_VERSION`/`NEXT_PUBLIC_PI_VERSION`（构建期，next.config.ts 注入）、`XDG_STATE_HOME`（skill-lock）。

继承 pi SDK（`SDK/docs/environment-variables.md`）：`PI_CODING_AGENT_DIR`（**配置目录，PowerI 已用**）、`PI_CODING_AGENT_SESSION_DIR`、`PI_OFFLINE`（关自更新/外呼，**PowerI 已用**）、`PI_PACKAGE_DIR`、`PI_SKIP_VERSION_CHECK`、`PI_TELEMETRY`、`PI_CACHE_RETENTION`、`PI_SHARE_VIEWER_URL`，及 provider 凭据 env（`ANTHROPIC_API_KEY` 等，也走 `auth.json`）。

### 5.2 settings.json 支持（SDK `docs/settings.md`，`[高]`）

- 全局 `<agentDir>/settings.json` + 项目 `.pi/settings.json`（需信任）。
- 关键键：`model`/`defaultProvider`/`defaultModel`、`enabledModels`（glob/模糊，`:level` 后缀钉 thinking）、`packages`（npm/git 包）、`extensions`（**本地扩展文件路径或目录**）、skills 路径等。
- **这正是 user-memory 扩展进 pi-web 的入口**：向用户 PVC 的 settings.json 写入 `extensions: ["/poweri/extensions/…"]`，pi-web 的进程内 pi 就会加载（`bindExtensions` 走 SDK resource loader）。ticket 21 的缺口本质是"镜像没内置扩展目录 + settings.json 没配"——**非结构性障碍**。

### 5.3 plugins 路由（`app/api/plugins/route.ts`，`[高]`）

包管理器 UI：`DefaultPackageManager` 安装/移除/更新/启停 npm/git 包（包的 extensions/skills/prompts/themes 资源），写 settings.json `packages`。**业务 skill 可用 npm 包形式经此 UI 分发到用户 agentDir**（与 PowerI"skill 播种"互为补充，机制已在 `skills-service.ts`/`DefaultResourceLoader` 统一发现路径下）。

### 5.4 skills 机制（`app/api/skills/*`，`[高]`）

- 列表 = SDK `DefaultResourceLoader`（settings 路径 + 包技能 + `.agents/skills`）——**与 UI 无关，运行时扫描**（ticket 21 实测一致）；重技能（data-analyzer 2925 文件）同法播种可发现。
- 安装 = `npx skills add`（`lib/npx.ts`）；搜索 = skills.sh（`SKILLS_API_URL`）；update check 走 GH Token。
- 禁用入口只有 `disable-model-invocation` frontmatter 切换；无 UI 侧技能执行链路改动需求。

### 5.5 扩展运行时与扩展 UI 子协议（`lib/rpc-manager.ts:createExtensionUiContext`，`[高]`）

- pi-web 以 `bindExtensions(mode:"rpc")` 绑定扩展 → 扩展的 `ctx.ui.select/confirm/input/editor` 对话框经 SSE 呈现给浏览器（`extension_ui_request/response` 子协议），`notify/setStatus/setWidget/setTitle` 等 fire-and-forget 直发；`custom()` 用 headless TUI 组件仿真（`lib/custom-ui-terminal.ts`，无终端也能跑）。
- **这与 pi RPC 模式的扩展 UI 子协议同构**（`SDK/docs/rpc.md` Extension UI Protocol）→ 若走路线 B 接网关 Worker，该子协议可透传，映射成本低（见 §6.2）。

### 5.6 models.json 读写（`app/api/models-config/route.ts` + `models/route.ts`，`[高]`）

- `GET/PUT /api/models-config` 原子读写 agentDir/models.json（0600）；`GET /api/models` 经 ModelRuntime 解析出可见模型 + 默认模型 + thinking 支持矩阵。
- 模型凭据可存 `auth.json`（OAuth/API key 全流程 UI）。**与 PowerI"每用户 PVC 播种 models.json + secret 注入 env"兼容**：界面改动即写回该用户 PVC（ticket 15 Part E 已验证隔离）。

---

## 6. 改造面评估（核心）

### 6.1 路线 A：每用户实例直连（现状）

- **已落地**（ticket 15 docker、ticket 21 K8s：gen-k8s `--piweb`、Secret 密码、exec 探针、双路径 skill 播种验证）。
- 与产品架构（Web UI → 网关 → Worker）的差距（源码级）：
  1. **计量/账单断裂**：`get_session_stats` 的 token/cost 只在 pi-web 进程内（`lib/rpc-manager.ts:send`），网关完全不可见 → 故事 16/33/34 无法由平台承载；ticket 21 亦确认"旁路网关不使用 Worker"。
  2. **形态成本**：每实例常驻一个 Next.js server + 进程内 pi（内存限额 1Gi、镜像 1.11GB，ticket 21）。10k 用户 ≈ 10k 常驻 Pod + 10k × 1.1GB 镜像拉取/存储，与 ADR-0004 按需调度 Worker + 温池的弹性/成本模型相反（活跃用户少时浪费、峰值时无法共享池）。
  3. **无会话串行/并发控制**：进程内靠 SDK 内部队列 + `streamingBehavior`（`hooks/useAgentSession.ts:1602`），同一会话多标签并发的排队语义由 pi 自己兜，非平台可控（故事 18 的平台侧串行不在 pi-web 上）。
  4. **进程隔离**：pi 崩溃拖垮整个 UI 进程（容器级兜底，ticket 15 风险项）。
  5. **管理面全缺**：无 /v1/admin/usage、无账单、无配额（ticket 21 用 exec 探针即因无健康端点）。
- **两个小补丁即可补齐的生产缺口**：default-cwd 改默认目录或加 env（`app/api/default-cwd/route.ts` 一处）；user-memory 扩展经 settings.json `extensions` 加载（或镜像内置 /poweri/extensions）。
- **判定**：作为"交互可视化/联调/测试入口"完全胜任且已投产；作为 10k 用户产品 chat 入口，缺平台语义且成本模型不符。

### 6.2 路线 B：fork pi-web 为网关客户端（调用点清单）

**换驱动层（核心替换面）——把进程内 AgentSession 换成网关调用：**

| 文件 | 耦合点 | 替换成本 |
|---|---|---|
| `lib/rpc-manager.ts` | `AgentSessionWrapper`（§2.3 全部命令）+ `startRpcSession` + 注册表 + 空闲回收 + 扩展绑定 | **主体工程**。好消息：命令面与 pi RPC 模式 1:1（§8.2），而 PowerI 桥/网关已暴露同一协议（`SDK/docs/rpc.md` = ADR-0002 协议），`send()` 的命令分发表可映射到网关 `POST /v1/chat` / `WS /v1/ws` + `extension_ui_request` 透传；坏消息：`fork`/`navigate_tree`/`compact`/`bash`/`get_session_stats` 等**网关未必透传**（网关只实现 prompt/steer/abort 级操作，`gateway/server.mjs` 路由仅 /v1/chat、/v1/ws、sessions/messages、admin），缺的要么网关补、要么 UI 砍 |
| `app/api/agent/new`、`[id]`、`events`、`running` | HTTP↔进程内会话桥 | 换成网关 HTTP/WS 客户端（中等，纯 IO 重写） |
| `app/api/sessions/*` + `lib/session-reader.ts` | 直读磁盘 JSONL（SessionManager） | **网关无会话列表 API**；`GET /v1/sessions/<id>/messages` 在 k8s provider 下是坏的（`sessionFileHost` 读网关本地 DATA_DIR，JSONL 在 worker PVC —— ticket 20 实测）。**必须先给网关补"会话列表/历史"API**（或让 pi-web 直读 PVC，但那又绕回旁路） |
| `app/api/files/*`、`cwd/*`、`home`、`default-cwd`、`git/*`、`worktrees`、`file-index`、`project-trust` | 进程内文件系统沙箱 | **网关无任何文件/工作区 API** —— 要么网关新增（文件浏览/上传/git 状态/diff/worktree，工程量≈重写一个文件服务），要么 UI 砍掉工作区功能 |
| `app/api/models*`、`models-config/*`、`auth/*` | 进程内 ModelRuntime/SettingsManager/auth.json | 网关无对应 API；模型配置/凭据在 worker PVC 的 models.json/auth.json，需网关代理或放弃配置 UI |
| `app/api/skills/*`、`plugins/*` | 进程内 resource loader / package manager | 网关无对应 API；业务 skill 已在 Worker 内（ticket 21 双路径验证），UI 层技能面板需网关透传"worker 已发现哪些 skill" |

**结论**：B = 换驱动层（可映射，协议同构）+ **网关补齐 6 族 API（会话列表/文件/配置/技能/插件/认证）** + fork 持续合上游（近每日发版）。ticket 17 已正式否决此路线（维护成本 + 与 ADR-0002 冲突）。**除非产品 chat 入口必须携带 pi-web 的全套工作区 UI 能力，否则不值得。**

### 6.3 路线 C：不用 pi-web，轻量 Web UI 直连网关

- **已有雏形**：`.scratch/pi-agent-platform/issues/20-ux-journey-prototype.md`（分支 `prototype/ux-journey`，throwaway）——原型反代 → 网关 `/v1/chat` SSE → worker pod → 真实模型，**6 个旅程要素全部实测通过**（新建会话/流式/多标签并行/续接/记忆累积/多用户隔离）。
- **网关 API 面现状**（`gateway/server.mjs`）：`POST /v1/chat`（Bearer token，SSE）、`WS /v1/ws?token=`、`GET /v1/sessions/<id>/messages`（k8s 下坏）、`GET /v1/admin/usage`、`GET/POST /v1/admin/invoice`。认证/路由/串行/计量/账单全在网关——**产品 chat 语义天然具备**。
- **缺口**：无会话列表 API（原型用 `kubectl exec` 读 PVC 绕过）、无文件 API（chat 场景暂不需要，工作区操作为二期）。C 的新建成本集中在"轻量 chat UI + 网关补 1-2 个 API（会话列表/历史）"。

### 6.4 三路线对比表

| 维度 | A 每用户实例直连（现状） | B fork 为网关客户端 | C 轻量 UI 直连网关 |
|---|---|---|---|
| chat/流式/多会话/续接 | 原生 ✓ | 换驱动层后 ✓ | 新建（原型已证） |
| 文件浏览/上传/git/worktree | 原生 ✓ | 网关无 API → 需新增或砍 | 需新增或砍 |
| 会话列表 | 原生 ✓ | 网关无 → 需新增 | 需新增（原型 kubectl 绕过） |
| 模型/技能/插件配置 UI | 原生 ✓ | 网关无 → 需新增 | 不做（配置走播种/管理员） |
| 计量/账单/配额 | ✗（旁路网关） | ✓（走网关） | ✓（走网关） |
| 会话串行/排队 | SDK 内部兜底 | ✓ 网关 | ✓ 网关 |
| 多用户账号 | 单密码/实例 | 网关 token | 网关 token |
| 管理员/审计 | ✗ | 部分（admin API 已有 usage/invoice） | 部分 |
| 弹性/成本 | 10k 常驻实例（1Gi + 1.1GB 镜像/用户） | 同 A 形态（常驻） | 无状态网关 + 按需 Worker（ADR-0004） |
| 进程隔离 | 容器级 | 容器级 | Worker 子进程（桥） |
| 上游跟进 | 锁 0.8.6 无 fork | fork 近每日合流 | 无 |
| 改动量 | 0（+2 小补丁） | 大（驱动层 + 网关 6 族 API + 持续合流） | 中（UI + 网关 1-2 API） |
| 现状 | **已投产**（ticket 15/21） | 已否决（ticket 17） | 原型验证通过（ticket 20） |

---

## 7. 规格覆盖度（spec 用户故事逐条对照）

> 说明：spec 实为 **38 条**故事（1-38，含 37 本地 PoC、38 多用户可视化；任务描述写"34 条"系笔误）。按 pi-web 0.8.6 现状（每用户实例形态）对照。标注：✓ 原生覆盖 / ◐ 可扩展覆盖（配置或小补丁）/ ✗ 需要新做 / — 平台侧能力（非 pi-web 职责）。

| # | 故事 | pi-web 现状 | 判定 |
|---|---|---|---|
| 1 | 发起聊天 | chat 输入框 → `prompt`（fire-and-forget + SSE） | ✓ |
| 2 | 会话续接 | 会话列表 + `startRpcSession` 从 JSONL 恢复 | ✓ |
| 3 | 并行多会话 | 注册表多 AgentSession，跨会话并行、会话内 SDK 队列 | ✓ |
| 4 | 流式输出 | SSE `message_update`/`tool_execution_*` 增量 | ✓ |
| 5 | 专属工作区文件 | cwd 选择 + `/api/files` 浏览/编辑预览 | ✓ |
| 6 | 工具命令 | bash 工具 + `bash` 命令 + git 面板 | ✓ |
| 7 | 历史跨设备/任意 Pod 一致 | 同一 PVC + 同一 agentDir 则一致（每实例视角） | ◐（依赖部署形态） |
| 8 | 不与其他用户混淆 | 每实例独立进程/agentDir/PVC | ✓（实例级） |
| 9 | 重启/Pod 崩溃数据不丢 | 会话/文件在 PVC；进程内状态丢失但可冷启恢复 | ◐ |
| 10 | 旧对话续接 | 会话列表 + JSONL 恢复 | ✓ |
| 11 | 每用户独立存储卷 | —（K8s PVC，部署层） | — |
| 12 | 按需伸缩 Worker | ✗ 常驻实例，无伸缩 | —（pi-web 无此职责，A 形态反着来） |
| 13 | 任一 Pod 接任一用户 | ✗ 实例与用户绑定 | — |
| 14 | 非 root/限额 | 镜像层由 PowerI 控制（ticket 21：USER piuser + 限额） | ◐ |
| 15 | 网络限制 | NetworkPolicy 部署层；pi-web 需外呼模型 API（models.dev/skills.sh） | ◐ |
| 16 | 跟踪 token/成本 | **单会话展示**（`get_session_stats`，顶栏 + 消息级）**无聚合/配额**；且旁路网关，平台收不到 | ✗（平台语义缺失） |
| 17 | 结构化日志/追踪 | 无结构化日志；会话 JSONL 天然可审计 | ◐ |
| 18 | 会话内串行 | SDK 内部队列 + streamingBehavior | ◐（非平台可控） |
| 19 | 不可变镜像升级 | 镜像层 | — |
| 20 | 健康/就绪 | 无 /healthz；ticket 21 用 exec 探针（node fetch + `get_state`） | ◐ |
| 21 | 网关认证路由 | pi-web 自持 Basic Auth，非网关 | — |
| 22 | 流式转发 | pi-web 原生 SSE | ✓（自身） |
| 23 | 网关串行排队 | — | — |
| 24 | 续接时挂载正确 PVC | 部署层（每实例固定挂自己 PVC） | — |
| 25 | 元数据存储/无状态网关 | — | — |
| 26 | Worker stdio↔WS 桥 | —（pi-web 进程内，不用桥） | — |
| 27 | 启动挂载 PVC 续接 | ticket 15/21 部署形态即此 | ◐ |
| 28 | 请求结束释放 Pod | 会话空闲 10 分钟自动 shutdown（`rpc-manager.ts:resetIdleTimer`），但**进程/实例常驻** | ◐ |
| 29 | User Memory | **无记忆机制本身**；扩展可加载（settings.json `extensions`）但未配置（ticket 21 缺口） | ✗（需接线） |
| 30 | 记忆跨会话访问 | 扩展写入 PVC 后跨会话可见（每实例内） | ◐（接线后） |
| 31 | 记忆隔离 | 每实例/PVC | ✓（实例级） |
| 32 | 每用户独立记忆存储 | PVC | ✓（实例级） |
| 33 | 聚合用量/统计 | ✗ 无聚合 | ✗ |
| 34 | 账单生成 | ✗ | ✗ |
| 35 | 用户维度报表 | ✗ | ✗ |
| 36 | 存量画像初始化 | —（scripts/init-memory.mjs 平台侧） | — |
| 37 | 本地 K8s PoC | 已由 tickets 15/21 完成（pi-web 即 PoC UI） | ✓ |
| 38 | 多用户可视化界面 | ticket 15/21 落地形态（每用户一实例挂 PVC） | ✓ |

**总结**：chat 体验层（1-10）原生达标；记忆（29-32）接线后可达标；**平台语义层（16/18/21/23/25/33/34/35）pi-web 架构性缺位**——这正是"A 只能当测试入口、产品入口需走网关"的证据链。

---

## 8. pi SDK 侧事实（一手）

### 8.1 AgentSession 创建/驱动 API（`SDK/dist/core/sdk.d.ts`，`[高]`）

- `createAgentSession(options)` 返回 `{ session: AgentSession, extensionsResult, modelFallbackMessage }`；`createAgentSessionFromServices`（pi-web `rpc-manager.ts` 用）。
- `CreateAgentSessionOptions`：`cwd`、`agentDir`、`modelRuntime`、`model`、`thinkingLevel`、`scopedModels`、`noTools`、`tools`、`excludeTools`、`customTools`、`resourceLoader`、`sessionManager`、`settingsManager`、`sessionStartEvent`。
- 驱动：`prompt/steer/followUp/abort/compact/setModel/setThinkingLevel/navigateTree/executeBash/subscribe/dispose/…`（pi-web `AgentSessionWrapper` 全覆盖）。
- 会话文件：`SessionManager.create(cwd, sessionDir)/open(path)`；`getDefaultSessionDirPath` → `sessions/--<cwd编码>--/`（§3.1）。

### 8.2 远程 RPC 支持与事件协议（`SDK/docs/rpc.md` + `dist` grep，`[高]`）

- **RPC 模式（`pi --mode rpc`）= 严格 LF JSONL over stdin/stdout**，命令/事件/扩展 UI 子协议见 `docs/rpc.md`。**全 SDK 无任何网络 server/客户端**（grep `dist/modes/rpc/*.js` 无 http/ws/net 导入；`rpc-entry.js` = `main(["--mode","rpc"])`）。`rpc-client.ts` 为子进程 stdio 客户端。
- **结论：SDK 不支持连接远程 pi；"进程内 SDK"是 Node 宿主唯一官方路径**（docs/rpc.md 明确建议）。pi-web 与 PowerI 桥各自独立实现了同一协议的两端：
  - pi-web：进程内 AgentSession 直接调用（不经过 JSONL 线协议，语义等价）。
  - PowerI 桥：`pi --mode rpc` 子进程 + stdio↔WS 桥（ADR-0002），把 RPC JSONL 帧暴露为网络端点。
  - 两者的**命令/事件/扩展 UI 语义同构**（对比 `docs/rpc.md` 命令表与 `lib/rpc-manager.ts:send()` 命令表）→ 这是路线 B"换驱动层"可行性的核心依据，也是路线 C"轻量 UI 直连网关"可完全复用 RPC 事件模型的原因。
- 事件协议（`docs/rpc.md` Events）：`message_update`（含 `assistantMessageEvent` delta 序列）、`tool_execution_start/update/end`、`agent_start/end/settled`、`compaction_*`、`queue_update`、`extension_error`、`bash_execution_update` 等——pi-web SSE 与网关 SSE 事件模型一致（pi-web 只是省略了 turn_*/tool_execution_update）。

---

## 9. 结论、推荐与待决策

### 9.1 判断（证据链）

1. **pi-web 本身是"单用户本地 pi 工作台"，不是平台组件**：单密码 Basic Auth（`lib/web-auth.ts`）、进程内 SDK（`lib/rpc-manager.ts`）、无账号/计量/账单/管理员（§4、§7）——它把"整个本地用户"当成一个用户。
2. **它无法"符合项目预期"（Web UI→网关→Worker）**：驱动链在架构上旁路网关，网关计量不到它的用量；`get_session_stats` 的 token/cost 只存在于 pi-web 进程内（§6.1-1）。ticket 17 已把"fork 成网关客户端"否决，本报告从源码侧确认了该否决成立（B 的调用点清单见 §6.2）。
3. **但它恰好是 ticket 15/21 想要的形态**：每用户实例 + 挂用户 PVC + 进程内 pi = 一个"真实 pi + 可视化 + 多用户隔离"的联调/测试/演示入口，已在 K8s 上验证（skill 双路径、会话落盘、隔离断言全过）。
4. **chat 业务入口的正确答案是网关侧**：网关已具备认证/路由/串行/计量/账单（`gateway/server.mjs`），原型已验证全链路 chat 体验（ticket 20）；缺的只是产品级轻量 UI + 会话列表 API。

### 9.2 推荐

- **保留路线 A**：pi-web 每用户实例继续作为交互可视化/联调/演示入口（现状，改造成本≈0）。
- **产品 chat 业务入口走路线 C**：新建/续建轻量 Web UI 直连网关（复用 `prototype/ux-journey` 的 6 旅程要素实现），网关补"会话列表/历史"API（k8s provider 下修复或新增，ticket 20 已发现坏点）。文件/配置/技能类功能按产品阶段决策，不进一期 chat。
- **路线 B 冻结**（维持 ticket 17 决策）：除非产品明确要求 pi-web 全套工作区 UI 作为产品界面，否则不 fork。
- **顺手补 A 的两个小补丁**（不构成 fork，ticket 17 允许）：default-cwd 支持 env/默认 `/workspace`；user-memory 扩展经 settings.json `extensions` 挂进 pi-web 的进程内 pi（或镜像内置 /poweri/extensions），保持双入口记忆一致。

### 9.3 待决策问题

1. **产品一期 chat 入口的范围**：只要 chat（会话/流式/续接/文件操作），还是要 pi-web 级的工作区（git/worktree/模型配置/技能面板）？→ 决定 C 是"轻量 UI"还是"网关补 6 族 API"。
2. **网关会话列表/历史 API**：k8s provider 下 `GET /v1/sessions/<id>/messages` 坏的修复方案（改读 worker PVC / 网关元数据存储落会话索引 / 提供列表端点）——C、B 都依赖。
3. **10k 用户的常驻成本 vs 按需 Worker**：A 形态（10k × 1Gi + 1.1GB 镜像）只适合活跃用户少的阶段；何时切 C？（可给阈值：同时在线 >N 时切换）。
4. **user-memory 双入口一致性**：settings.json `extensions` 挂载（pi-web 与 Worker 共享 PVC 的 settings.json）vs 仅 Worker 侧 `-e`（ticket 21 缺口），选哪个为最终机制。
5. **default-cwd 预设**：小补丁默认 `/workspace` 或新增 env（如 `PI_WEB_DEFAULT_CWD`）？谁负责？（一次性决策，改动 1 处。）
6. **pi-web 版本治理**：锁定 0.8.6 还是跟随上游（近每日发版，含认证/安全改进）？→ 影响镜像更新节奏与 A 的维护成本。

---

## 附：调研方法声明

- pi-web 源码：`git clone https://github.com/agegr/pi-web`（本仓库 `.research-tmp/pi-web`，可删除），以 tag `v0.8.6` 为准；已确认 **main == v0.8.6，零漂移**（`git rev-list --count v0.8.6..origin/main` = 0）。
- 全部 API 路由逐个阅读源码；env 变量与 localStorage 键为全库 grep 结果。
- pi SDK：读宿主 `node_modules/@earendil-works/pi-coding-agent`（0.83.0）的 `docs/rpc.md`、`docs/settings.md`、`dist/core/sdk.d.ts`、`dist/core/session-manager.js`、`dist/modes/rpc/*`、`dist/rpc-entry.js`。
- 未运行 pi-web 本体（只读调研）；运行态事实引用 ticket 15/20/21 的既有实测。
