# 部署 manifests（k8s）

计划按 spec/ticket 逐步补齐：

- `gateway/` 无状态网关层 Deployment + Service + LB
- `worker/` Worker Pod Deployment（含温池 + 自动伸缩，ticket 10）
- `networkpolicy.yaml` 出站仅放行模型 API 与存储（ticket 07）
- `pvc/` per-user PVC 供给与 StorageClass（ticket 04）

本地验证环境：macOS + OrbStack（含 K8s 集成），用于最小端到端 PoC（ticket 13）。

## Worker Pod 资源限额（ticket 07，与 docker 层 PoC 一致）

```yaml
resources:
  requests: { cpu: 250m, memory: 256Mi }
  limits:   { cpu: 1, memory: 512Mi }        # 镜像默认（gateway POWERI_POD_CPUS/MEM_MB/PIDS）
securityContext:
  runAsNonRoot: true
  runAsUser: 1000                            # 镜像内 piuser
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities: { drop: ["ALL"] }
```
磁盘限额由 per-user PVC 的 capacity 管辖（ADR-0001）。

## Worker 温池 + 自动伸缩（ticket 10，K8s 生产形态）

PoC 已实测（docker 层，scripts/verify-10.mjs）：冷启动均值 ~194ms（OrbStack）、请求中途 Pod 故障后自动重建容器且会话不丢（数据在 per-user PVC）、`--rm` 无残留。

```yaml
# 请求级调度：每个请求调度一个挂载该用户 PVC 的 Pod（K8s 卷创建时固定，不可跨用户热复用）
# 温池 = HPA 维持的"已预热副本"（镜像已拉取、节点上镜像缓存命中 → 启动即秒级）
# 自动伸缩：HPA 按 CPU/内存/请求并发（或自定义指标：排队长度）伸缩
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: poweri-worker
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: poweri-worker }
  minReplicas: 2
  maxReplicas: 100
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: 70 } }
    - type: Resource
      resource: { name: memory, target: { type: Utilization, averageUtilization: 80 } }
```
Pod 无粘性（无 StatefulSet 固定身份）：任何副本可服务任何用户，会话状态在 per-user PVC + 元数据存储（ADR-0001/0003）。

## K8s 真实环境验证（ticket 16，已实测通过）

OrbStack K8s v1.34.8 + local-path StorageClass（动态 PVC）。**poweri-worker:local 镜像 OrbStack K8s 直接可拉**（共享镜像存储）。

```bash
# 1. 启用 OrbStack K8s（首次）
orb config set k8s.enable true && orb stop && orb start

# 2. 部署：ConfigMap 播种配置 + 每用户 PVC/Deployment/NodePort
node scripts/gen-k8s.mjs alice,bob     # nodePort 30081/30082 起

# 3. 网关接入 k8s provider 验证
node scripts/verify-k8s.mjs            # 多用户隔离 / 会话落 PVC / Pod 重建续接
```

- 会话路径经 WS query 传给桥（常驻 Pod 按连接指定，覆盖启动 env）
- initContainer chown 1000:1000 保证 piuser 写 PVC（root 建目录会 EACCES）
- 每用户常驻 Pod 为 PoC 形态；生产 = 温池 + HPA（见上）+ NetworkPolicy（networkpolicy.yaml）
