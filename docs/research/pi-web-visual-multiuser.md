# pi-web 可视化多用户验证调研（ticket 15）

> 需求：为"真实环境多用户/多租户并发实践"提供一个可视化交互界面——多人在测试环境各自操作、观察并发行为。候选承载项目：`@agegr/pi-web`（github.com/agegr/pi-web）。
> 调研时间：2026-08-01。版本 pi-web 0.8.6（MIT，无 Dockerfile）。

## pi-web 是什么

pi 的本地 Web UI（Next.js 16）：会话浏览/续接/分叉、实时聊天（SSE）、模型与 thinking 配置、技能管理、项目文件浏览与预览、git worktrees、PWA、i18n。

**关键架构事实（源码确认）：**
- 通过 `lib/rpc-manager.ts` 的 `createAgentSessionFromServices` / `startRpcSession` 在**自身 Node 进程内**驱动 pi（进程内 SDK），事件经 `/api/agent/[id]/events` 以 SSE 暴露给浏览器——**不是子进程、不是远程 RPC**。
- 数据：读取本地 `~/.pi/agent/sessions/`（`PI_CODING_AGENT_DIR` 可覆盖）；模型配置读写 `models.json`（与 pi 同一套配置）。
- 认证：`PI_WEB_PASSWORD` 单密码 Basic Auth（username 恒为 pi）——**无多用户账号体系**，是单用户本地工具。
- 依赖 pi 系列 **0.83.0 = 与 PowerI 锁定版本完全一致**（版本兼容零风险）。
- 运行：`npx @agegr/pi-web`，默认 127.0.0.1:30141，`--hostname 0.0.0.0` 可对外。

## 与 PowerI 架构的映射

| pi-web 概念 | PowerI 对应 | 兼容性 |
|---|---|---|
| `~/.pi/agent/sessions/`（PI_CODING_AGENT_DIR） | per-user PVC 的 `.pi/agent/`（seedUser 已播种 models.json/settings.json） | **布局一致，直接复用** |
| 进程内 SDK 驱动 pi | 我们 ADR-0002 用 stdio↔WS 桥（**明确拒绝** in-process SDK：失去进程隔离） | pi-web 即被拒形态——作为"每用户实例"可接受，作为网关后端不可接受 |
| Basic Auth 单密码 | 网关 per-user token 认证 | 不兼容多用户——多实例各配各的密码 |
| models.json 模型配置 | 每用户 PVC 已播种 | 一致 |

## 部署方案

### 方案 A：每用户一个 pi-web 容器（直连，无改造）——**推荐先落地**

- Dockerfile（新）：node:24-bookworm-slim（与 pi-sandbox 同一基底，单 Node 运行时）+ `npm i -g @agegr/pi-web@0.8.6` + 非 root + `PI_CODING_AGENT_DIR=/home/piuser/.pi/agent` + 暴露 30141。
- 每测试用户一个实例：`-v <user>/.pi/agent:/home/piuser/.pi/agent -v <user>/workspace:/workspace`（复用 gateway docker provider 的用户目录布局）。
- 用户 A/B/C 各访问自己的实例（不同端口/域名），各自看到自己的会话/文件/记忆 → **可视化的多租户隔离 + 真实 pi 并发实践**。
- 局限：pi-web 直接驱动 pi（每实例一个独立 pi 进程），**绕过网关**——测的是"多个真实 pi 实例并发 + PVC 隔离"（底层），不测网关路由/串行/计量（那些由 verify 脚本 + fake 主缝覆盖）。

### 方案 B：改造 pi-web 为网关客户端（fork，后续）

- 把 `api/agent/*` + `rpc-manager` 的进程内会话换成调用 PowerI 网关（SSE `/v1/chat` + WS `/v1/ws` + Bearer token + 会话历史接口）。
- 收益：完整链路可视化（认证/路由/串行/计量/记忆全走平台）；成本：fork 上游、持续跟随升级、Session/文件/模型配置等本地概念需逐层适配。
- 建议：**不做为主路径**。网关行为已由 05/06/09 的 verify 脚本严格验证；可视化的核心诉求（多用户并发看真实行为）由方案 A 满足。

### 推荐：A 先行，B 记入后续

方案 A 是"容器化 + 多用户访问 + 直接调 PowerI 集群（每实例即一个 worker 形态）"的最短路径，恰好落在用户原话的"直接调用 Power I 容器集群"选项上；B 对应"调用网关"选项，改造量大，留作后续调研决策。

## 风险与注意

- **进程隔离**：pi-web 进程内跑 pi——若 pi 崩溃会拖垮整个 UI 进程；容器级别兜底（每实例独立容器）。
- **Basic Auth 明文**：README 明示需 HTTPS 反代/VPN；测试环境可接受。
- **端口规划**：多实例需端口矩阵或域名路由（compose/脚本）。
- **配置共享**：每用户 PVC 的 models.json 来自宿主播种（gen-pi-config），pi-web 的模型配置 UI 会读写同一文件——恰好可验证"用户在界面改配置"的隔离。

## 待办（ticket 15）

见 `.scratch/pi-agent-platform/issues/15-pi-web-visual-multiuser.md`。
