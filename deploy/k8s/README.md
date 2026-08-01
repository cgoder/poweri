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
