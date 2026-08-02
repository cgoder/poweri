# 28 — UI↔网关认证打通（用户账号 → 网关 token 映射）

- **Type:** task
- **Status:** resolved
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

## Answer

UI↔网关认证已打通并验证 13/13（verify-28.mjs）：
- **每用户账号**（poweri-web 仓库）：`POWERI_WEB_USERS="alice:pass-a;bob:pass-b"` 账号表（parseWebUsers/resolveWebUser，多用户优先、缺省回退单用户 pi+密码）；proxy.ts 认证改走 resolveWebUser
- **请求级 token**：`gatewayTokenForUser`（POWERI_GATEWAY_USERS 用户名→token）+ `gatewayTokenForRequest`（next/headers() 取请求认证用户 → 该用户 token）；GatewaySessionClient 构造注入 token（send/abort 用它）；会话列表 30s 缓存按 token 分键（防 alice/bob 串）
- **gen-k8s --ui**：UI pod 注入 `POWERI_WEB_USERS`（默认 poweri-<user>）+ `POWERI_GATEWAY_USERS`；exec 探针改用首用户凭据
- **验证**：认证边界（无凭据/未知用户/密码错 401，alice/bob 正确 200）→ 会话隔离（alice 62 / bob 4，id 交集 0）→ 各自对话各自落各自 worker PVC（msbnt77j→alice、msbntb42→bob）；verify-27 10/10 + verify-24 13/13 回归全过
- 单测：web-auth +9（账号表/回退/越权拒绝）、gateway-client +1（token 映射），共 208/208；gateway-client.test.mjs 改 jiti 加载（仓库既有约定，Node 原生 ESM 不解析无扩展名相对导入）
- 遗留（ponytail）：登录页/OAuth 未做（每用户 Basic Auth 是最小可用）；UI 持网关用户表（同一信任域，生产若需可改 UI 无 token、登录后由后端换取）
