# Agent Platform Context

## 项目结构（三模块，2026-08）

1. **Monorepo（平台代码库）**：三模块共居一仓（ADR-0010）：
   - `worker/`：Worker 沙箱（bridge + pi + 扩展 + skills），原 poweri 仓库的 worker 部分
   - `gateway/`：无状态网关（认证/路由/计量/续接/会话管理 API），原 poweri-gateway 仓库
   - `web/`：用户交互 UI（网关模式壳），git subtree 自上游 agegr/pi-web 引入
   - 控制面（gen-k8s 部署编排、K8s manifests、验证脚本）与平台文档（CONTEXT.md、docs/adr/）位于 monorepo 根，部署责任分列到各模块目录

数据流：浏览器 → PowerI-Web → poweri-gateway → Worker（bridge → pi）→ 模型。


A multi-tenant platform (~10k users) that serves each user's requests (chat, tools, other agent work) through a routing gateway into containerized worker pods that run pi (pi-coding-agent). Hard requirement: per-user data must never be lost and never mixed between users.

## Language

**Gateway**:
The control plane and business layer. It authenticates users, routes each request to a worker pod, and holds user↔session/bookkeeping. Stateless.
_Avoid_: server, backend, router

**Worker pod**:
A containerized runtime that executes a user's request by driving pi in headless mode. Ephemeral and stateless: it mounts the user's PVC at request time and can be discarded.
_Avoid_: container (when meaning the pod), sandbox, worker

**User data store**:
The per-user PVC holding that user's workspace files, pi session history (chat records), and execution records. Physically isolated per user.
_Avoid_: storage, volume

**Session**:
A user's pi conversation, persisted as JSONL (chat + tool executions) under `~/.pi/agent/sessions/`. Resumable across requests.
_Avoid_: chat thread, history (when meaning a specific session)

**User Memory**:
A per-user, cumulative record of preferences, history, and evolving understanding of the user, persisted as files in the user's workspace (on the per-user PVC) and consulted across sessions so the platform increasingly understands the user.
_Avoid_: profile, context, history (when meaning cumulative memory vs a single session)

**Usage meter**:
A per-user aggregation of resource, data, and model consumption (tokens, cost, storage, egress) tallied from pi RPC events and platform metrics.
_Avoid_: stats, analytics (when meaning the metering record)

**Invoice**:
A per-user charge derived from usage meters by applying pricing rules. Payment collection is out of scope.
_Avoid_: bill (ambiguous)

**Legacy user data**:
Pre-existing user profile, persona, and historical usage records held before the platform launched, to be onboarded into a user's User Memory (at launch or on first run).
_Avoid_: archive, history

> **同名双项目命名规范**：有两个同名项目 `pi-web`（上游与社区 fork），所有书面/口头引用必须带所有者前缀，严禁裸用 "pi-web" 指代两者之一。

**PowerI-Web** (曾用名 **pi-web (agegr)**):
monorepo 的 `web/` 子目录（ADR-0010）：以 `git subtree` 自上游 agegr/pi-web 引入（升级 = `git subtree pull`），网关模式 Web 壳（Web UI → 网关 → worker），代码内一律小写 `poweri-web`，展示文案保留品牌名 `PowerI-Web`。旧复制式 fork 历史（v0.8.6 基底）由 gitlab 旧 project 归档保留。上游 npm `@agegr/pi-web`（v0.8.6）仍用于 `poweri-piweb` 镜像 / `piweb-<user>` pods（NodePort 30241+，进程内 pi 0.83.0）。
_Avoid_: pi-web (bare), the original pi-web, 独立仓库（指开发基地）

**pi-web (jmfederico)**:
The community rewrite of pi-web: Fastify/Lit, npm `@jmfederico/pi-web` (v1.202607.3), split sessiond+web processes, drives pi-coding-agent **0.82.1** in-process (peer range `<0.83`, 与 PowerI 版本错位). Deployed per-user as `poweri-piweb2` image / `piweb2-<user>` pods (NodePort 30251+). A′ pilot baseline (ticket 22).
_Avoid_: pi-web (bare), the fork, piweb2 (without mapping)
