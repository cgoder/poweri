# User Memory 扩展（ticket 08）

pi 扩展：在工作区（该用户 PVC）维护 User Memory 文件，随 agent 执行循环动态读写/注入，使平台越来越懂用户。

- 持久化在 per-user PVC，物理隔离、跨会话累积（ADR-0008）
- 存量 Legacy user data 上线时一次性、分批、幂等初始化
- 打包进每个 Worker Pod 镜像

> 本目录先留结构，机制细节见 spec 与 ticket 08，实现时再填充。
