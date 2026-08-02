# 29 — 会话管理 API 补齐（改名/删除）+ 计量用户侧展示

- **Type:** task
- **Status:** resolved
- **Blocked by:**
- **Depends on:**

## 背景

spec 用户故事 41/42 + 差距清单第 4 项子集：网关已有会话列表/历史/JSONL 导出（ticket 23），但缺改名/删除；计量只有 admin 端点（`/v1/admin/usage`），用户侧无展示。这两块是 UI 会话管理与透明计费的基础。

## 定义 / 范围

1. **会话改名**：`PATCH /v1/sessions/<id>`（body `{name}`）— k8s provider 经 bridge 写会话 JSONL（pi 会话 header 或独立 name 记录）；local provider 走 `SessionManager.appendSessionInfo` 等价实现
2. **会话删除**：`DELETE /v1/sessions/<id>` — k8s provider 经 bridge 删除 worker PVC 上会话 JSONL（仅网关会话文件，不动用户 workspace）；local provider 删本地文件
3. **计量用户侧展示**：`GET /v1/users/me/usage`（Bearer token 鉴权，返回该用户计量记录，`/v1/admin/usage` 的用户子集）供 UI 用量面板
4. **PowerI-Web 接入**：会话树改名/删除入口（fork 已 stub，见 ticket 24 的 `setSessionName` no-op 与 DELETE 崩溃点），用量面板（可选，验证场景可后置）

## 验证

- verify-29.mjs：改名后列表/历史反映新名；删除后列表消失且文件确实删除；删除不存在的 404；用户 token 访问 `/v1/users/me/usage` 只见自己、admin token 全量
- 会话改名/删除后继续对话正常（JSONL 完整性）

## 测试决策

改名/删除的纯逻辑（会话名写入/文件删除判定）走 gateway/test 单测；端到端走 `verify-29.mjs`。

## Answer

会话管理 API 与 UI 接入完成，verify-29 15/15 + 回归全绿：
- **改名**（pi 生态约定）：bridge `PATCH /sessions/<id>` 追加 `session_info` 行（{type,id,parentId,timestamp,name}，新行→空格+trim；parentId=末行 id）；网关 `PATCH /v1/sessions/<id>`（k8s 经 bridge / local 本地文件）；`sessionListEntry` DTO 反向解析最新 session_info → `name` 字段（单测补 2 条）
- **删除**：bridge `DELETE /sessions/<id>`（unlink worker PVC 会话 JSONL，不动 workspace）；网关 `DELETE /v1/sessions/<id>`；404/401 边界齐全
- **用户侧计量**：网关 `GET /v1/users/me/usage`（Bearer 用户 token → 该用户计量记录，与 /v1/admin/usage 同数据源，验证数量一致）
- **PowerI-Web 接入**：PATCH/DELETE 网关分支（修复 ticket 24 遗留的 DELETE shutdown 崩溃点）+ 会话列表 name 透传；UI 实测改名「UI改名测试」→ 列表反映 → 删除 → 404
- **验证**：verify-29 15/15（改名 200/列表反映/历史+JSONL 完整；删除 200/列表消失/PVC 文件删/重复删 404；计量用户 token 可见/与 admin 一致/401）；verify-27 10/10、verify-28 13/13 回归
- 测试决策：session-parse 单测 +14；verify-29 集成；worker 需 rollout restart 才加载新 bridge（同 tag 镜像，gen-k8s apply 不触发滚动——已加注释）
