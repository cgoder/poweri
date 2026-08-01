# 16 — K8s 真实环境验证（OrbStack K8s）

**What to build:** 把 docker 层 PoC 平移到真实 K8s（OrbStack K8s v1.34.8）：每用户 PVC + worker Deployment（挂 PVC 跑桥）+ NodePort Service，网关 `k8s` provider 按用户路由，验证多用户隔离、PVC 持久化、跨 Pod 续接。

**Blocked by:** 04 — 会话续接 + 每用户 PVC 挂载；07 — 容器级隔离加固

**Status:** done

**实现:**
- `bridge/server.mjs`：支持 WS 握手 `?session=<path>`（K8s 常驻 Pod 按连接指定会话，覆盖启动 env）
- `gateway/pods.mjs`：新增 `k8s` provider（`POWERI_K8S_USERS="alice:30081;bob:30082"` + `POWERI_K8S_NODE_HOST`，会话经 WS query 传给桥）
- `scripts/gen-k8s.mjs`：生成并应用 ConfigMap（宿主播种配置）+ 每用户 PVC/Deployment/NodePort Service；initContainer chown 1000:1000 解决 piuser 写权限
- `scripts/verify-k8s.mjs`：A 多用户路由+隔离 / C 会话 JSONL 落 PVC / B 删 Pod 重建后 mango 记忆保留（PVC 持久化 + 跨 Pod 续接）——全过

**关键踩坑（记录）:**
- initContainer 以 root 建目录 → piuser 无写权限（`sessions/--workspace--` EACCES）→ 必须 chown 1000
- 改桥后需重建镜像再滚动重启（K8s 用镜像内旧代码导致 query 解析不生效）
- OrbStack NodePort 在 Pod 删除/重建瞬间有转发窗口 → 验证加等待+重试
- 生产形态仍以 deploy/k8s/README 的 HPA + NetworkPolicy 草案为准（本 PoC 每用户常驻 Pod）
