# 04 — 会话续接 + 每用户 PVC 挂载

**What to build:** 路由请求时，为请求用户挂载其 per-user PVC 并续接/新建会话：新对话 `--no-session`，追问从 PVC 上 JSONL 用 `--session` 恢复。元数据存储维护 user→session 映射，支撑无状态网关路由。不同用户数据物理隔离。

**Blocked by:** 03 — 网关骨架：认证 + 路由

**Status:** done（83448ae：per-user token 认证 + 元数据存储 + docker provider 按请求挂载用户数据目录 + --session 续接；pod 重建后数据仍在 + 用户隔离验证通过）

- [ ] 同一用户连续两个请求续接同一会话（历史保留）
- [ ] 不同用户的会话/工作区互相隔离
- [ ] Pod 启动时正确挂载请求用户的 PVC
- [ ] user→session 映射写入元数据存储且网关无状态读取
- [ ] 用户数据不因 Pod 重建而丢失
