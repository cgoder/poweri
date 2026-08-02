# 23 — Gateway 会话列表/历史 API（k8s provider 修正）

Type: task
Status: claimed
Blocked by:
Created: 2026-08-02
Tags: gateway, k8s, session-api, blocker

## 背景

产品路径（Web UI → 网关 → Worker）的会话管理在 k8s provider 下是断的（ticket 20 实测）：
- `GET /v1/sessions/<id>/messages` 走 `sessionFileHost` 读网关本地 DATA_DIR，但 k8s 下会话 JSONL 在 worker PVC（`/home/piuser/.pi/agent/sessions/<gatewayId>.jsonl`）→ 404 "session not found"
- **无会话列表 API**：Web UI 侧边栏需要"该用户有哪些会话"，现在只能 kubectl exec 读 PVC（ticket 20 原型绕过法）

两条路都要（ticket 24 的 RemoteAgentClient 依赖；C 路线轻量 UI 同样需要）。

## 方案

**bridge 加 HTTP 面**（bridge/server.mjs 的 `createServer` 已同时承载 HTTP+WS，加路由即可）：
- `GET /sessions` → 列出 `/home/piuser/.pi/agent/sessions/*.jsonl`（平铺 gateway 会话），返回 `[{id, cwd, created, modified, messageCount, firstMessage}]`（解析 JSONL 头/首条消息）
- `GET /sessions/<id>` → 读该文件返回原始 JSONL 行（网关侧复用现有消息提取逻辑）

**gateway 加代理**（server.mjs）：
- `GET /v1/sessions`（Bearer）→ provider=k8s 时 fetch `http://worker-<u>.poweri.svc.cluster.local:8081/sessions`（docker 本地模式保持现有行为）
- 修 `GET /v1/sessions/<id>/messages`：k8s 时经 bridge HTTP 读，不再读网关本地 DATA_DIR

依赖：改 bridge → 重建 poweri-worker:local 镜像 → 重新 gen-k8s 部署（worker 链）。

## 验证点

1. `GET /v1/sessions`（token-a）返回 alice 的会话列表（含 msb* 平铺会话），字段完整
2. `GET /v1/sessions/<id>/messages` 在 k8s provider 下返回真实消息（不再 404）
3. bob 与会话隔离（token-b 看不到 alice 会话）
4. 无 token → 401

## 测试决策（TDD）

纯逻辑（JSONL → 会话元数据映射）走 `gateway/test/*.test.mjs`（node --test，无框架，符合 test:unit 惯例）；bridge HTTP + 网关代理属薄 IO，走 verify-23.mjs 集成验证。

## 检查清单

- [ ] bridge：GET /sessions + GET /sessions/<id>
- [ ] gateway：GET /v1/sessions + messages 修复（k8s 走 bridge）
- [ ] 单元测试（JSONL 映射）+ verify-23.mjs
- [ ] 重建镜像 + 重新部署
- [ ] code-review（双轴）
- [ ] Answer + resolved

## Comments
