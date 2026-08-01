# 19 — 生产化收口（gateway 部署形态 + 密钥 Secret 化 + K8s 全链路）

- **Status:** done（gateway 容器化 + K8s 部署 + 密钥 Secret 化 + verify-19 全链路验证全过）
- **Depends on:** 全部 PoC ticket（01-18）done
- **Scope:** PoC（gateway 本机 + worker K8s）→ 可部署形态（gateway 也进 K8s、密钥不进 ConfigMap）

## 背景

当前生产缺口（PoC 完成后的收口）：
1. gateway 无容器镜像、无 K8s 部署——只在开发机 `node gateway/server.mjs` 跑
2. gen-k8s 把 models.json（含 apiKey 明文）整文件进 ConfigMap
3. 无 CI/CD、无镜像仓库（需用户决策基础设施，单列）

## Checklist

- [x] **gateway 容器镜像**：`deploy/docker/Dockerfile.gateway`（node:24-bookworm-slim 多阶段，仅 ws 依赖，非 root，数据目录预建授权）；`scripts/build-gateway.mjs` → `poweri-gateway:local`
- [x] **K8s 部署 gateway**：Deployment + PVC + NodePort Service（31080）；k8s provider 支持 Service DNS 形式（`alice:worker-alice.poweri.svc.cluster.local:8081`），保留 NodePort 兼容
- [x] **密钥 Secret 化**：gen-pi-config 支持 `POWERI_PI_CONFIG_APIKEY_REF=1` 生成 `$POWERI_AI_API_KEY` 环境引用；Secret `poweri-secrets` 存 apiKey + 网关 token；worker/gateway 经 secretKeyRef 注入；ConfigMap 无明文
- [x] **全链路验证**：`scripts/verify-19.mjs` 全过——引用版配置部署、ConfigMap/Secret 位置断言、gateway pod→worker pod→pi→真实模型流式回复、会话落 worker PVC
- [x] 文档：deploy/k8s/README 补齐 gateway 部署说明；README ticket 状态

## 不做（需决策后另开 ticket）

- CI/CD 流水线（repo 在 GitLab，待定 .gitlab-ci.yml 与触发方式）
- 镜像仓库推送（待定 registry 地址与凭证）
- 温池自动伸缩的 K8s 真机验证（docker 层已实测，ticket 10）

## 验证方式

verify-19：OrbStack K8s 全链路（gateway pod + worker pod + PVC），断言：
- /v1/chat 返回真实回复（gateway→worker→pi→模型）
- `kubectl get configmap -o yaml` 不含 apiKey；Secret 含
- 会话数据落 per-user PVC，跨请求续接
