# 31 — 新用户按需开通 worker（on-demand provisioning）

- **Type:** task
- **Status:** resolved
- **Blocked by:** —
- **Depends on:** 28（网关认证表）

## 背景

多租户平台（~10k 用户）原架构纯静态预置：gen-k8s 一次性建好 alice、bob 的 worker，网关两张表
（token→user、user→pod 地址）硬编码。新用户既不开 worker，连网关都进不来（401 / `k8s 无该用户映射`），
无法验证"新用户从 PowerI-Web 接入 → 自动开新 worker → 数据不混淆 → 跑在另一个 worker"这条产品路径。

## 实现

**poweri-gateway 仓库**（`pods.mjs` + `deploy/k8s/gateway.yaml`，commit 0fc4a02）：
- k8s provider 遇不在 `POWERI_K8S_USERS` 的新用户 → 经 in-cluster SA token 调 K8s API
  （Node 内置 fetch 零依赖，未装 kubectl）自动创建 `worker-<user>` Deployment + `<user>-pvc` +
  ClusterIP Service，等 Ready（≤90s）后路由；模板与 gen-k8s 同构（subPath 挂载 / initContainer
  播种 / Secret 注入），并发去重（provisioning Map）、幂等可重入
- 新增 ServiceAccount `poweri-gateway` + Role/RoleBinding（仅本命名空间 deployments/pvc/services 权限）
- 修复两个真实 bug：`k8sBridgeAddr` 改 async 后调用点未 await → unhandled rejection 崩整个网关进程；
  缺 `readFileSync` 导入 → SA token 读取必失败（`不可读: undefined`）

**poweri 仓库**（`scripts/verify-31.mjs`，commit e81173b）：验证场景——仅预置 alice，carol 在认证表
但无 worker；carol 首次 Web 接入触发自动开通。

## 验证

`node scripts/verify-31.mjs alice,carol` — **10/10 通过**：
carol 首次对话成功（真实模型回复）→ worker-carol + carol-pvc 自动创建 → 会话落 carol 的 PVC
（与 alice 零重叠）→ 与 alice 运行在不同 Pod。

## 遗留（已由 ticket 32 收口）

- ~~**缩容缺失**：新用户离开后 worker 不缩容。~~ → 见 `32-worker-scaledown.md`（空闲超时 scale-to-0，PVC 保留，10/10 验证通过）。

## Comments

- 2026-08-02（用户）：新用户自动开通/扩容没问题，但用户离开后没有缩容。记下，明天继续。
