# 10 — 温池 + 自动伸缩供给

**What to build:** 维护温池缓冲空闲 Pod（镜像预热、低冷启动），按请求调度一个挂载该用户 PVC 的 Pod，处理完归还/销毁；按负载自动伸缩。注意 K8s 卷创建时固定，故不可跨用户热复用，按请求调度。

**Blocked by:** 04 — 会话续接 + 每用户 PVC 挂载；07 — 容器级隔离加固

**Status:** done（commit 见下）

**Done:** verify-10 A/B/C 全过（冷启动基准 194ms / 中途故障接续 / --rm 释放）；K8s 生产形态（HPA + 温池 + 无粘性）草案入 deploy/k8s/README。

- [x] 请求到来时能从温池快速获得一个挂载正确 PVC 的 Pod（K8s：镜像预热副本 + 请求级调度；PoC 实测冷启动均值 ~194ms，见 deploy/k8s/README）
- [x] 温池随负载自动伸缩（K8s HPA 草案：CPU/内存目标利用率 + min/max，见 deploy/k8s/README；docker 层 PoC 无等价物——挂载固定不可热换，诚实标注）
- [x] 请求结束后 Pod 归还/释放，不残留状态（--rm 退出即删实测；同会话热复用；无状态在 PVC）
- [x] Pod 故障时可由其他 Pod 接续（无粘性）（verify-10 B：请求中途 kill 容器，下一请求自动重建且 banana 记忆保留）
