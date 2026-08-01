# 07 — 容器级隔离加固

**What to build:** 为 Worker Pod 施加容器级隔离：非 root 用户、CPU/内存/磁盘限额、NetworkPolicy 仅放行模型 API 与存储、只挂载该用户 PVC。收窄被注入工具（bash/git）的影响面。

**Blocked by:** 01 — pi 沙箱容器镜像

**Status:** ready-for-agent

- [ ] Pod 以非 root 用户运行
- [ ] CPU/内存/磁盘限额生效
- [ ] 网络策略仅放行模型 API 与存储，阻止任意出站
- [ ] 只挂载请求用户的 PVC，无法访问他用户数据
