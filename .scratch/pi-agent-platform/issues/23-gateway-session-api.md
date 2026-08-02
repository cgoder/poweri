# 23 — Gateway 会话列表/历史 API（k8s provider 修正）

Type: task
Status: resolved
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

- [x] bridge：GET /sessions + GET /sessions/<id>
- [x] gateway：GET /v1/sessions + messages 修复（k8s 走 bridge）
- [x] 单元测试（共享 DTO 真 fixture，13/13）+ verify-23.mjs（7/7）
- [x] 重建镜像 + 重新部署
- [x] code-review（双轴）+ Answer + resolved

## Answer

**完成：网关会话列表/历史 API 在 k8s provider 下可用，7/7 集成 + 13/13 单测通过。**

### 实现

- **bridge HTTP 面**（bridge/server.mjs）：`GET /sessions`（列表）+ `GET /sessions/<id>`（原始 JSONL，basename 防穿越）；会话 DTO 抽到共享纯模块 `gateway/session-parse.mjs`（`sessionListEntry`），`messageCount` 由构造与历史端点一致（复用 `messagesFromJsonl`），Dockerfile.pi 一行 COPY 进 worker 镜像。
- **gateway**（server.mjs）：`GET /v1/sessions`（Bearer；k8s 经 bridge HTTP fetch，本地模式扫数据目录）；`GET /v1/sessions/<id>/messages` 修复——k8s 时经 bridge 读 worker PVC，不再读网关本地 DATA_DIR（ticket 20 发现的 bug）。
- **测试**：`gateway/test/session-api.test.mjs` 3 新用例（fixture 取自真实 worker PVC 会话文件 msb55j0s）；`verify-23.mjs` 7 项（401/列表字段完整含 msb*/历史不再 404/双向用户隔离/新建会话出现在列表）。

### 顺带修复的真实生产 bug（verify-23 抓出）

**worker Service selector 过宽**：`selector: {app: poweri, user: <u>}` 会匹配到同 label 的 piweb/piweb2 Pod（ticket 21/22 引入，不监听 8081），kube-proxy 端点里有 3 个地址（1 真 2 假），worker 链路自 ticket 21 起一直靠网关 connectWs 的 20 次重试"侥幸"通过，间歇性 ECONNREFUSED。修复：selector 加 `role: worker`。教训：多形态 Deployment 共享 app/user label 时 Service selector 必须带 role。

### code-review 结论（双轴，固定点 0dcd53d）

- 标准轴：无硬违例；主要发现 = DTO 双实现语义分裂（bridge 计 user-only / 本地计全部、created 恒空）→ 已抽共享 `sessionListEntry` 消灭；常量重复（SESSIONS_DIR vs SESSION_FILE_CONTAINER）→ 共享 `SESSIONS_CONTAINER_DIR`；遗留：`POD_PROVIDER==="k8s"` 两处 if（2 个站点不值得 dispatch map，接受）。
- 规格轴：TDD 决策未覆盖新映射 → 已补真 fixture 单测；VP1/VP3 断言弱 → 已加强（msb* 存在、created/messageCount/firstMessage 非空、双向隔离非空洞）；scope-creep（piId/本地列表）→ piId 重构中移除，本地列表保留并记录（同端点对本地 dev 有用）。

### 未做/债务

- bridge 列表每次请求全量读+解析所有会话文件（`ponytail:` 已标注）——会话量增大时需缓存/分页。
- 会话列表未分页、无创建时间排序键以外的排序参数（够用）。

## Comments
