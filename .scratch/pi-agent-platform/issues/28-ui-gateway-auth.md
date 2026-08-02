# 28 — UI↔网关认证打通（用户账号 → 网关 token 映射）

- **Type:** task
- **Status:** ready
- **Blocked by:** 26
- **Depends on:**

## 背景

spec 用户故事 40/44 + 差距清单第 3 项：PowerI-Web 目前单密码 Basic Auth + 单一网关 token（一个实例=一个用户）。产品要按用户路由，需要 UI 用户账号 → 网关 Bearer token 的映射。

## 定义 / 范围

1. **网关侧**：保持 `POWERI_GATEWAY_USERS`（`alice:token-a;bob:token-b`）为唯一用户表；可选新增管理员可查的用户列表 API（`GET /v1/admin/users`）供 UI 登录校验用
2. **PowerI-Web 侧**（`/Users/tianzhao/code/leoao/poweri-web`）：
   - 登录页或每用户 Basic Auth：用户输入账号 → UI 校验（本地账号表或向网关查询）→ 取得该用户的网关 token 用于全部 API 调用
   - `gatewayConfig` 从单一 env token 改为登录态持有 token；会话/文件/技能请求按当前登录用户走
   - 实现取舍（ponytail）：先用**每用户 Basic Auth 账号表**（`POWERI_WEB_USERS="alice:pass-a;bob:pass-b"`，与网关 USERS 对齐）作为最小可用方案；登录页/OAuth 留作后续
3. **隔离验证**：alice 登录只见 alice 会话/文件；bob 只见 bob 的（网关 token 已保证，UI 层确认不串）

## 验证

- 两个账号各自登录：会话树/文件/技能互不可见，聊天各自落各自 worker PVC
- 错误密码拒绝、无凭据拒绝
- verify-28.mjs：双账号隔离 + 认证边界

## 测试决策

UI 认证映射纯逻辑（token 选择/账号表）走单测；端到端走 `verify-28.mjs`。
