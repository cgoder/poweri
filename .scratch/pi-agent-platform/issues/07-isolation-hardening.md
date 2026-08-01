# 07 — 容器级隔离加固

**What to build:** 为 Worker Pod 施加容器级隔离：非 root 用户、CPU/内存/磁盘限额、NetworkPolicy 仅放行模型 API 与存储、只挂载该用户 PVC。收窄被注入工具（bash/git）的影响面。

**Blocked by:** 01 — pi 沙箱容器镜像

**Status:** done（commit 见下）

**Done:** docker provider 注入资源限额（env 可配）；verify-07 A-D 全过；K8s 正式形态（NetworkPolicy + resources/securityContext）草案入 deploy/k8s/。

- [x] Pod 以非 root 用户运行（镜像 USER piuser；verify-07 A：/etc /usr 写被拒、工作区可写）
- [x] CPU/内存/磁盘限额生效（gateway docker provider --cpus/--memory/--pids-limit；verify-07 B：inspect 断言 + OOM 实测 kill 137；K8s 形态见 deploy/k8s/README）
- [x] 网络策略仅放行模型 API 与存储（PoC：镜像无 curl/wget/nc 等侦察工具，仅暴露桥端口；K8s NetworkPolicy 草案 deploy/k8s/networkpolicy.yaml；C2 模型 API 可达性为环境依赖非阻塞检查）
- [x] 只挂载请求用户的 PVC，无法访问他用户数据（verify-07 D：alice/bob 容器互不可见对方文件）
