# pi (pi-coding-agent) 生产级容器部署调研

> 调研对象：`@earendil-works/pi-coding-agent`（终端/CLI 编码助手 agent，官方简称 **pi**）
> 调研方式：全部结论追溯自一手来源（官方文档、README、已安装包源码、官方 Dockerfile 示例）。
> 本地安装路径：`/Users/tianzhao/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/`（下文简称 `$PI`）
> 文档路径：`$PI/docs/*.md`
> 版本：`0.83.0`（见 `$PI/package.json` 的 `version` 字段）

---

## TL;DR（结论速览）

| 问题 | 结论 |
|---|---|
| 运行时依赖是什么？ | **Node.js**。`dist/cli.js` shebang 为 `#!/usr/bin/env node`，官方 Dockerfile 用 `node:24-bookworm-slim`。可选 **Bun 编译的单文件二进制**（`build:binary` 脚本用 `bun build --compile` 产出 `dist/pi`）。Bun 是打包工具，不是必需运行时。 |
| 有官方 Docker 镜像吗？ | **没有**在 Docker Hub / GHCR 发布（本地对三个命名空间请求均 404）。但有**官方 Dockerfile 示例**（`docs/containerization.md` 的 `Dockerfile.pi`），是"社区可复制、官方文档背书"的部署方式。 |
| 支持 headless / server / 非交互吗？ | **支持**，但**没有内建 HTTP server**。headless 靠三种方式：(1) `--mode rpc`（stdin/stdout JSONL 协议）；(2) **SDK**（Node.js 进程内 API）；(3) `-p/--print` 与 `--mode json` 一次性模式。 |
| 配置/密钥怎么注入？ | 环境变量（`ANTHROPIC_API_KEY` 等 30+ provider）优先于 `~/.pi/agent/auth.json`；自定义 provider 用 `~/.pi/agent/models.json`；settings 用 `~/.pi/agent/settings.json`。容器内推荐**环境变量注入**或**挂载 auth.json**。 |
| 有哪些环境变量？ | `PI_CODING_AGENT_DIR`、`PI_CODING_AGENT_SESSION_DIR`、`PI_OFFLINE`、`PI_SKIP_VERSION_CHECK`、`PI_TELEMETRY`、`HTTP_PROXY/HTTPS_PROXY` 等（详见第 5 节）。 |
| 需要挂载的持久化状态？ | `~/.pi/agent/`（含 `sessions/`、`auth.json`、`settings.json`、`models.json`、`trust.json`、`models-store.json`、`extensions/`、`skills/`、`git/`、`npm/`）以及工作区。 |
| 端口/认证/多租户？ | **无默认监听端口**（无 HTTP server）。RPC 走 stdin/stdout，无内建认证。多租户**未内建**，需每容器一实例或自己写 SDK/RPC 网关。 |
| 官方推荐的部署？ | 官方文档明确列出**容器化**为受支持模式，并给出三种模式（Docker / Gondolin / OpenShell）。README 哲学也写"**No permission popups. Run in a container**"。 |

---

## 1. 运行时依赖（Bun？）

### 结论
- **默认运行时是 Node.js**，不是 Bun。
- Bun 仅用于**构建单文件二进制**（可选部署方式），不是运行 pi 的前置依赖。
- 官方 README 推荐的安装方式是 npm 全局安装 + `--ignore-scripts`。

### 来源

**npm 安装方式（README 开头）：**
```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```
> "`--ignore-scripts` disables dependency lifecycle scripts during install. Pi does not require install scripts for normal npm installs."
> — `$PI/README.md`（Quick Start 节）

**CLI 入口是 Node 脚本：**
- `$PI/package.json`：`"bin": { "pi": "dist/cli.js" }`，`"type": "module"`。
- `$PI/dist/cli.js` 首行：`#!/usr/bin/env node`。
- `$PI/dist/rpc-entry.js` 首行：`#!/usr/bin/env node`。

**Bun 作为编译工具（产出独立二进制）：**
`$PI/package.json` 中 `scripts.build:binary`：
> `"build:binary": "npm --prefix ../tui run build && npm --prefix ../ai run build && npm --prefix ../agent run build && npm run build && bun build --compile ./dist/bun/cli.js ... --outfile dist/pi && npm run copy-binary-assets"`

这说明用 `bun build --compile` 生成**自包含可执行文件 `dist/pi`**（内含 Bun 运行时）。源码里 `dist/bun/cli.js` 会 `registerBunOAuthFlows()`（Bun 特有的 OAuth 能力）。

**官方 Dockerfile 用的是 Node：**
```dockerfile
FROM node:24-bookworm-slim
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```
> — `$PI/docs/containerization.md`（"Plain Docker" 节）

> 一句话：Node.js 是唯一必需的运行时；Bun 是"编译独立二进制"的可选构建路径。

---

## 2. 官方 Docker 镜像 / Dockerfile

### 结论
- **没有**发布在 Docker Hub / GHCR 的官方镜像。
- **有官方文档给出的 Dockerfile 示例**，属于"官方推荐写法、由用户自行构建"。

### 来源

**Docker Hub / GHCR 探测（本机执行，均 404）：**
```
registry.hub.docker.com/v2/repositories/earendilworks/pi-coding-agent  → 404
registry.hub.docker.com/v2/repositories/earendil-works/pi-coding-agent → 404
ghcr.io/earendil-works/pi-coding-agent                                → 404
```
（无法连接注册表网络时应以"未发现已发布镜像"为准；本文档基于本次 404 结果。）

**官方 Dockerfile 示例（containerization.md "Plain Docker" 节）：**
```dockerfile
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates git ripgrep \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent

WORKDIR /workspace
ENTRYPOINT ["pi"]
```

**运行示例（同节）：**
```bash
docker build -t pi-sandbox -f Dockerfile.pi .
docker run --rm -it \
  -e ANTHROPIC_API_KEY \
  -v "$PWD:/workspace" \
  -v pi-agent-home:/root/.pi/agent \
  pi-sandbox
```

**该节明示的两种隔离哲学（同样适用于容器）**：
> "There are two general options. You can either 1. run the whole `pi` process inside an isolated environment, or 2. run `pi` on the host and route tool execution into an isolated environment."

官方列出的模式表：`Gondolin extension` / `Plain Docker` / `OpenShell`（详见第 9 节）。

---

## 3. headless / server / 非交互式运行能力

### 结论
- **支持 headless/非交互**，但没有内建 HTTP server、没有默认监听端口。
- 程序化驱动有三条官方路径：**RPC 模式**（stdin/stdout JSONL）、**SDK**（Node.js 进程内）、**print/json 一次性模式**。
- 要让容器化后的 pi 作为网络服务，需要**自己包一层 HTTP→stdin/stdout 网关**（用 SDK 或 spawn RPC 子进程）。

### 来源

**README 声明四模式：**
> "Pi runs in four modes: interactive, print or JSON, RPC for process integration, and an SDK for embedding in your own apps."
> — `$PI/README.md`（引言）

**CLI 模式参数（README CLI Reference "Modes" 表）：**
| Flag | 说明 |
|---|---|
| （默认） | Interactive mode |
| `-p`, `--print` | Print response and exit |
| `--mode json` | Output all events as JSON lines |
| `--mode rpc` | RPC mode for process integration |

**编译产物里也只有这三种非交互模式**（无 server 模式目录）：
```
$PI/dist/modes/  → interactive / print-mode / rpc
```
在 `dist/modes` 内 grep `createServer` / `.listen(` 无匹配，确认无内建 HTTP server。

#### 3a. RPC 模式（跨语言/子进程集成，容器化首选）
> "RPC mode enables headless operation of the coding agent via a JSON protocol over stdin/stdout."
> — `$PI/docs/rpc.md`

启动：`pi --mode rpc [options]`
- 常用选项：`--provider`、`--model`、`--name/-n`、`--no-session`、`--session-dir`。
- 协议：**严格 LF 分隔的 JSONL**。命令写 stdin，事件以 JSON 行流到 stdout。
  > "RPC mode uses strict JSONL semantics with LF (`\n`) as the only record delimiter."（`rpc.md` "Framing"）
- 命令集（`rpc.md`）：`prompt`、`steer`、`follow_up`、`abort`、`new_session`、`get_state`、`get_messages`、`set_model`、`cycle_model`、`set_thinking_level`、`compact`、`bash`、`switch_session`、`fork`、`clone`、`export_html`、`get_entries`、`get_tree`、`get_last_assistant_text`、`set_session_name`、`get_commands` 等。
- 事件集（`rpc.md`）：`agent_start/end/settled`、`turn_start/end`、`message_start/update/end`、`bash_execution_update`、`tool_execution_*`、`compaction_*`、`auto_retry_*`、`extension_error` 等。
- **headless 下的 UI 交互降级**：扩展的 `ctx.ui.select/confirm/input/editor` 通过 `extension_ui_request` / `extension_ui_response` 子协议在 stdin/stdout 上进行；TUI 专属能力（`custom()`、`setFooter()` 等）在 RPC 下是 no-op。
  > "Some `ExtensionUIContext` methods are not supported or degraded in RPC mode because they require direct TUI access."（`rpc.md` "Extension UI Protocol"）

**认证注意（无浏览器环境）**：OpenRouter OAuth 在 headless/远程机器上需要手动粘贴回调 URL。
> "On remote/headless machines (e.g. over SSH) the browser cannot reach the loopback callback; paste the final redirect URL (or the authorization code) into the login prompt instead."
> — `$PI/docs/providers.md`（OpenRouter）

#### 3b. SDK（Node.js 进程内嵌入）
> "The SDK provides programmatic access to pi's agent capabilities. Use it to embed pi in other applications, build custom interfaces, or integrate with automated workflows."
> — `$PI/docs/sdk.md`

核心 API：`createAgentSession()`、`AgentSession`、`createAgentSessionRuntime()`/`AgentSessionRuntime`、`ModelRuntime`、`SessionManager`、`SettingsManager`、`DefaultResourceLoader`。
```typescript
const modelRuntime = await ModelRuntime.create();
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  modelRuntime,
});
await session.prompt("What files are in the current directory?");
```
> — `$PI/README.md`（"SDK" 节）与 `$PI/docs/sdk.md`

SDK vs RPC 选择建议（`sdk.md`）：同进程/要类型安全用 SDK；跨语言/要进程隔离用 RPC。
> "RPC mode is preferred when: You're integrating from another language / You want process isolation / You're building a language-agnostic client."

---

## 4. 容器化所需的配置与凭据注入

### 结论
- 凭据注入两路：**环境变量**（推荐容器内用）或 **`~/.pi/agent/auth.json`**（可挂载）。
- 自定义 provider/model：**`~/.pi/agent/models.json`**（支持 Ollama/vLLM/自建代理）。
- 全局行为配置：**`~/.pi/agent/settings.json`**；项目级 `.pi/settings.json`。
- 认证解析顺序（`docs/providers.md` "Resolution Order"）：
  1. CLI `--api-key` 2. `auth.json`（API key 或 OAuth token） 3. 环境变量 4. `models.json` 自定义 key。

### 来源

**API key 环境变量（provider 表，见 `docs/providers.md`）**：`ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`DEEPSEEK_API_KEY`、`GEMINI_API_KEY`、`OPENROUTER_API_KEY`、`GROQ_API_KEY`、`MISTRAL_API_KEY`、`XAI_API_KEY`、`AZURE_OPENAI_API_KEY`、`HF_TOKEN`、`AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY` 等 30+ 项。

**auth.json（`~/.pi/agent/auth.json`）**，权限 0600，优先级高于环境变量：
> "The file is created with `0600` permissions (user read/write only). Auth file credentials take priority over environment variables."
> — `$PI/docs/providers.md`（"Auth File" 节）

**自定义 provider via models.json（`~/.pi/agent/models.json`）**：
> "Add custom providers and models (Ollama, vLLM, LM Studio, proxies) via `~/.pi/agent/models.json`."
> — `$PI/docs/models.md`

示例（Ollama）：
```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [ { "id": "llama3.1:8b" } ]
    }
  }
}
```
> — `$PI/docs/models.md`（"Minimal Example"）

**值解析语法**（`apiKey`/`headers` 支持命令执行、环境变量插值、字面量）：
> "The `apiKey` and `headers` fields support command execution, environment interpolation, and literals: `!command` executes … `$ENV_VAR` or `${ENV_VAR}` interpolates … literal value used directly."
> — `$PI/docs/models.md`（"Value Resolution"）

**SDK 中自定义目录/内存凭据**（容器/测试场景很有用）：
```typescript
const customRuntime = await ModelRuntime.create({
  authPath: "/my/app/auth.json",
  modelsPath: "/my/app/models.json",
});
```
> — `$PI/docs/sdk.md`（"API Keys and OAuth"）

**settings.json 位置与作用域（`docs/settings.md`）：**
| 位置 | 作用域 |
|---|---|
| `~/.pi/agent/settings.json` | 全局（所有项目） |
| `.pi/settings.json` | 项目（覆盖全局） |

关键全局设置项（`docs/settings.md`）：`defaultProvider`、`defaultModel`、`defaultThinkingLevel`、`defaultProjectTrust`、`enableInstallTelemetry`、`compaction.*`、`retry.*`、`transport`（`sse`/`websocket`/`auto`）、`httpProxy`、`sessionDir`、`npmCommand`。

---

## 5. 相关环境变量

### 来源：`$PI/docs/environment-variables.md` 与 `$PI/README.md`（"Environment Variables" 节）

**Pi 进程配置变量：**
| 变量 | 作用 |
|---|---|
| `PI_CODING_AGENT` | 设为 `true`，子进程可检测自己运行在 pi 内（进程标记） |
| `PI_CODING_AGENT_DIR` | 覆盖配置目录（默认 `~/.pi/agent`） |
| `PI_CODING_AGENT_SESSION_DIR` | 覆盖 session 存储目录（`--session-dir` 优先） |
| `PI_PACKAGE_DIR` | 覆盖 package 目录（用于 Nix/Guix 存储路径） |
| `PI_OFFLINE` | 禁用启动网络操作（更新检查、package 更新、telemetry） |
| `PI_SKIP_VERSION_CHECK` | 跳过 `pi.dev` 版本检查 |
| `PI_TELEMETRY` | 覆盖 install/update telemetry（`0/1/true/false`） |
| `PI_CACHE_RETENTION` | 设 `long` 启用扩展 prompt 缓存（Anthropic 1h / OpenAI 24h） |
| `PI_SHARE_VIEWER_URL` | 覆盖 `/share` 的 base URL |
| `PI_HARDWARE_CURSOR` | `1` 显示硬件光标 |
| `VISUAL`, `EDITOR` | 外部编辑器回退 |
| `HTTP_PROXY`, `HTTPS_PROXY` | 出站 HTTP 代理 |

> "Pi uses environment variables in three ways: Variables such as `PI_OFFLINE` configure the Pi process; Pi sets `PI_CODING_AGENT` so child processes can detect that they run inside Pi; Commands run by the LLM-callable bash tool receive `PI_*` variables describing the current session."
> — `$PI/docs/environment-variables.md`

**bash 工具会话变量**（在容器化 CI/自动化里非常有用）：
`PI_SESSION_ID`、`PI_SESSION_FILE`（session JSONL 绝对路径）、`PI_PROVIDER`、`PI_MODEL`、`PI_REASONING_LEVEL`。
> "The values are resolved when each command starts."（`environment-variables.md` "Bash Tool Session Environment"）

**容器部署建议的环境变量组合：**
```bash
PI_OFFLINE=1            # 禁用版本检查/telemetry，避免启动时外呼 pi.dev
PI_SKIP_VERSION_CHECK=1 # 只关版本检查
PI_TELEMETRY=0          # 关 telemetry
PI_CODING_AGENT_SESSION_DIR=/data/sessions   # 可写卷
HTTP_PROXY=... HTTPS_PROXY=...               # 若需企业代理
ANTHROPIC_API_KEY=...                        # 模型凭据
```

---

## 6. 需要挂载的持久化状态（卷）

### 结论
- 核心可写状态在 `~/.pi/agent/`，用**命名卷挂载到 `/root/.pi/agent`**（官方 Dockerfile 运行示例正是如此）。
- 只读/共享对象可用只读卷或复制进镜像。
- 工作区 `$PWD:/workspace` 按需读写/只读挂载。

### 来源

**官方运行示例明确挂载：**
```bash
-v "$PWD:/workspace" \
-v pi-agent-home:/root/.pi/agent \
```
> "Use a named volume for `/root/.pi/agent` if you want container-local settings and sessions. Mounting your host `~/.pi/agent` exposes host auth and session files to the container."
> — `$PI/docs/containerization.md`（"Plain Docker"）

**`~/.pi/agent/` 下需要持久化的内容**（汇总自 README + 各 doc）：
| 路径 | 内容 | 可持久化 |
|---|---|---|
| `sessions/` | 会话 JSONL（按工作目录组织） | ✅ 卷 |
| `auth.json` | API key / OAuth token（0600） | ✅ 卷（敏感） |
| `settings.json` | 全局设置 | ✅ 卷 |
| `models.json` | 自定义 provider/model | ✅ 卷或镜像 |
| `trust.json` | 项目信任决策 | ✅ 卷 |
| `models-store.json` | provider catalog 缓存（离线可用） | ✅ 卷 |
| `extensions/`, `skills/`, `prompts/`, `themes/` | 用户级资源 | ✅ 卷 |
| `git/`, `npm/` | 安装的 pi 包 | ✅ 卷 |

> "Sessions auto-save to `~/.pi/agent/sessions/` organized by working directory."（README "Sessions"）
> "configured providers may refresh newer catalogs and cache them in `~/.pi/agent/models-store.json` for offline use."（`docs/providers.md`）
> "Packages install to `~/.pi/agent/git/` (git) or `~/.pi/agent/npm/` (npm)."（README "Pi Packages"）

**工作区安全提示：**
> "If you bind-mount a host workspace read/write, writes from inside the container or VM can still modify host files. Use read-only mounts or copy files into and out of the sandbox when you need stronger protection from unintended writes."
> — `$PI/docs/security.md`（"Running Untrusted or Unmonitored Work"）

---

## 7. 网络端口、认证、多租户/多用户隔离

### 结论
- **无默认监听端口、无内建 HTTP server、无内建认证**。pi 是本地进程。
- "服务化"需自建网关：要么写 SDK 嵌在 Node 服务里，要么把 RPC stdin/stdout 暴露成 HTTP/WebSocket。
- **多租户/多用户未内建**。推荐每租户一容器实例（各自独立 `~/.pi/agent` 卷 + 各自凭据），或上层网关负责鉴权与会话路由。
- 出站：pi 需访问模型 API（HTTPS，默认 443），可用 `HTTP_PROXY/HTTPS_PROXY`；`PI_OFFLINE` 可关掉对 `pi.dev` 的外呼。

### 来源

**无内建 server**：`dist/modes` 仅 `interactive/print-mode/rpc`，无 `createServer/.listen`（本次源码 grep 验证）。

**RPC 走 stdin/stdout（非网络）**：`docs/rpc.md` 全程基于 JSONL over stdio；SDK 为进程内 API。README 模式描述："RPC for process integration" / "SDK for embedding in your own apps"。

**出站域名**：
> "Update check: fetches `https://pi.dev/api/latest-version` … telemetry: sends an anonymous version ping to `https://pi.dev/api/report-install`."
> — `$PI/README.md`（"Telemetry and update checks"）
> "Use `--offline` or `PI_OFFLINE=1` to disable all startup network operations described here, including update checks, package update checks, and install/update telemetry."

**代理**：`HTTP_PROXY` / `HTTPS_PROXY`（`docs/environment-variables.md`），及 `settings.json` 的 `httpProxy`（全局）。

---

## 8. 官方推荐的部署方式（local vs container）与业界实践

### 结论
- 官方**不强制某一种**，明确把"容器化/沙箱"列为受支持且受推荐的安全模式。
- README 哲学直接写"**No permission popups. Run in a container**"。
- **未发现** pi 官方维护的现成 Docker 镜像，业界"pi + Docker"多数是**官方 `containerization.md` 模板的直接使用/复刻**（本文档即以此为蓝本）。
- 官方共给出三种隔离模式：Plain Docker、Gondolin（host pi + 微 VM 路由工具）、OpenShell（策略化沙箱网关）。

### 来源

**README 哲学（容器是官方背书的安全边界）：**
> "**No permission popups.** Run in a container, or build your own confirmation flow with [extensions](#extensions) inline with your environment and security requirements."
> — `$PI/README.md`（"Philosophy"）

**security.md 明确建议无人值守/不可信工作跑在容器里：**
> "For untrusted repositories, generated code you do not intend to monitor closely, or unattended automation, run pi in a contained environment. Use a container, VM, micro-VM, remote sandbox, or policy-controlled sandbox with only the files and credentials required for the task."
> — `$PI/docs/security.md`（"Running Untrusted or Unmonitored Work"）

**containerization.md 三种模式表：**
| 模式 | 隔离什么 | 适用 | 备注 |
|---|---|---|---|
| Gondolin extension | 内建工具 + `!` 命令 | 本地微 VM 隔离，宿主保留认证 | `examples/extensions/gondolin/` |
| Plain Docker | 整个 pi 进程在本地容器 | 简单本地隔离 | 模型 API key 进入容器 |
| OpenShell | 整个 pi 进程在策略化沙箱 | 本地或远程受管沙箱 | 需 OpenShell 网关 |

> "Extensions run wherever the `pi` process runs. If you run host `pi` with a tool-routing extension, other custom extension tools still run on the host unless they also delegate their operations."
> — `$PI/docs/containerization.md`

---

## 9. 生产级部署方案雏形

> 声明：以下为**基于一手来源的推断式落地方案**，并非 pi 官方发布的"生产部署指南"。官方只给了"Plain Docker"最小模板（第 2 节）。健康检查、日志采集、更新策略、多租户网关属于通用工程实践，非 pi 内建能力。

### 9.1 镜像构建（多阶段）

基于官方模板扩展为多阶段，用 **Node LTS** 打基础镜像（与官方一致），把依赖锁进镜像、应用层用 `ENTRYPOINT` 指向 `pi`。

```dockerfile
# 阶段 1：构建（可选，仅当要打自包含二进制时）
# 若用官方 npm 方式，直接全局安装即可；如需 Bun 独立二进制可在此阶段 bun build --compile。
FROM node:24-bookworm-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates git ripgrep \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.83.0

# 阶段 2：运行时
FROM node:24-bookworm-slim
# bash/git/ripgrep 是 pi 内建工具 (bash, read, edit, write, grep, find, ls) 的运行时依赖
RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates git ripgrep \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.83.0 \
  && mkdir -p /workspace /data/agent

# 只读配置（自定义 provider/模型/全局设置，随镜像走）
COPY pi/models.json /etc/pi/models.json
COPY pi/settings.json /etc/pi/settings.json

# 非 root 运行（pi 以普通用户权限运行，见 security.md）
RUN useradd --create-home --shell /bin/bash piuser \
  && mkdir -p /home/piuser/.pi/agent /workspace \
  && chown -R piuser:piuser /home/piuser /data /workspace
USER piuser
ENV HOME=/home/piuser

WORKDIR /workspace
# 默认 headless：rpc 或 print。交互由调用方通过 -it 覆盖。
ENTRYPOINT ["pi"]
```

说明：
- `bash ca-certificates git ripgrep` 来自官方 Dockerfile 模板（`containerization.md`）。
- 锁版本号 `@...@0.83.0`：npm 全局安装默认取最新，锁版本保证可复现（官方并未锁，此为企业实践）。
- **非 root 用户**：`security.md` 强调 pi 以启动它的用户权限运行，非 root 可缩小被注入工具的影响面。

### 9.2 运行时（两种形态）

**A. 一次性/CI（print 模式）**
```bash
docker run --rm \
  -e ANTHROPIC_API_KEY=... \
  -e PI_OFFLINE=1 \
  -v repo:/workspace:ro \
  -v pi-data:/home/piuser/.pi/agent \
  pi:0.83.0 -p --model sonnet:high "Summarize this codebase"
```

**B. 长驻 headless 服务（RPC 模式 + 网关）**
- pi 本身无 HTTP server，需包一层网关把 HTTP/WebSocket 映射到 RPC stdin/stdout，或用 SDK 在 Node 服务内 `createAgentSession()`。
- 每次请求启动一个 `pi --mode rpc --no-session` 子进程（进程隔离、天然隔离会话/租户），或复用长驻子进程。

```bash
docker run --rm -i \
  -e ANTHROPIC_API_KEY=... \
  -e PI_OFFLINE=1 \
  -v workspace-vol:/workspace \
  -v pi-data:/home/piuser/.pi/agent \
  pi:0.83.0 --mode rpc --no-session
```

### 9.3 配置与凭据注入
- **凭据**：`-e ANTHROPIC_API_KEY` / `-e OPENAI_API_KEY` 等，或注入 `auth.json`（优先级高于环境变量）。生产用 **secret 管理**（K8s Secret / Vault / docker secrets）注入环境变量，不要写进镜像。
- **自定义 provider**：`models.json` 走只读卷或 COPY 进镜像，`apiKey` 用 `$ENV_VAR` 占位，运行时由 secret 填充（`docs/models.md` "Value Resolution"）。
- **全局设置**：`settings.json` 只读注入；项目覆盖 `.pi/settings.json` 走工作区卷。

### 9.4 卷
| 卷 | 挂载点 | 用途 |
|---|---|---|
| `pi-data`（命名卷） | `$HOME/.pi/agent`（非 root 下 `/home/piuser/.pi/agent`） | sessions/auth/settings/trust/models-store/packages 持久化 |
| `workspace-vol` | `/workspace` | 项目代码（读写或只读，见安全提示） |
| `/etc/pi/*.json`（只读 configmap/volume） | 镜像内 `models.json`/`settings.json` 源 | 配置注入 |

- 若 `PI_CODING_AGENT_SESSION_DIR` 与 `sessionDir` 想分开，会话可单独卷（`docs/settings.md` 优先级：`--session-dir` > `PI_CODING_AGENT_SESSION_DIR` > settings `sessionDir`）。

### 9.5 健康检查
- **pi 无内建 /health 端点**（无 HTTP server）。可选方案：
  - 包装进程暴露一个 `GET /healthz`：进程存活 + 读 `get_state` RPC 命令返回 `success:true`（`docs/rpc.md`）。
  - 或对 `--mode rpc` 子进程做 TCP/stdin 写测试（`{"type":"get_state"}` 有响应即健康）。
  - readiness 需校验模型可用：SDK 里 `ModelRuntime.getAvailable()`（`docs/sdk.md`）。

### 9.6 日志
- RPC/print 的 stdout 即事件/文本流，直接交给容器日志驱动（stdout 采集）。
- 结构化：RPC 模式下 `--mode rpc` 事件已是 JSONL（`message_update`、`tool_execution_*`、`extension_error` 等），可直接进日志管道（`docs/rpc.md` "Events"）。
- 可用 `get_session_stats`（token/成本/context 使用）做用量上报（`docs/rpc.md`）。

### 9.7 更新策略
- **不可变镜像 + 锁版本**：升级 = 改 tag（`@...@0.83.0` → `@...@0.84.0`）重建镜像滚动替换。
- **会话兼容**：sessions 是 JSONL（`docs/session-format.md`），挂载在同一数据卷上即可在升级后 `--session <path|id>` / `-c` 续接（README "Sessions"）。
- **内建自更新建议关闭**：生产里用 `PI_OFFLINE=1`（禁用 `pi update` 相关与 pi.dev 外呼），版本完全由镜像 tag 控制。官方自更新入口是 `pi update`（CLI 包命令），容器内一般不用。

### 9.8 多租户/多用户隔离
- **官方无多租户能力**。推荐"每租户一容器/一数据卷/一凭据集"（`~/.pi/agent` 卷隔离 + 各自 API key），天然隔离。
- 上层网关负责：鉴权（OAuth/企业 SSO）、把请求路由到对应租户的 RPC 子进程、配额/成本核算（`get_session_stats`）。
- 工具执行隔离：跑在容器内，非 root 用户，只挂载该租户所需工作区，必要时 `-v workspace:ro`（`security.md`）。

---

## 10. 来源清单

| 主题 | 来源（路径） |
|---|---|
| 安装/模式/环境变量/哲学/CLI | `$PI/README.md`（Quick Start、Programmatic Usage、CLI Reference、Environment Variables、Philosophy） |
| 容器化/官方 Dockerfile | `$PI/docs/containerization.md` |
| 安全/无内建沙箱/容器建议 | `$PI/docs/security.md` |
| 环境变量语义 | `$PI/docs/environment-variables.md` |
| Provider/凭据解析顺序/auth.json | `$PI/docs/providers.md` |
| 自定义 provider（扩展） | `$PI/docs/custom-provider.md` |
| 自定义模型 models.json | `$PI/docs/models.md` |
| 设置项/全局设置 | `$PI/docs/settings.md` |
| 会话/存储目录 | `$PI/docs/sessions.md`、`$PI/docs/session-format.md` |
| RPC 协议（headless 服务化） | `$PI/docs/rpc.md` |
| SDK（Node 嵌入） | `$PI/docs/sdk.md` |
| 包管理 | `$PI/docs/packages.md` |
| 扩展 | `$PI/docs/extensions.md` |
| 运行时/构建（Node vs Bun） | `$PI/package.json`、`$PI/dist/cli.js`、`$PI/dist/bun/cli.js` |
| 无内建 HTTP server | `$PI/dist/modes/` 目录 + grep 验证 |
| Docker Hub / GHCR 镜像探测 | `registry.hub.docker.com` / `ghcr.io`（本次 HTTP 404） |

> 路径前缀 `$PI` = `/Users/tianzhao/.bun/install/global/node_modules/@earendil-works/pi-coding-agent`
