# 29 — 会话管理 API 补齐（改名/删除）+ 计量用户侧展示

- **Type:** task
- **Status:** ready
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
