# 27 — UI 部署形态：单一 UI Deployment → 网关 + 退役旧形态

- **Type:** task
- **Status:** ready
- **Blocked by:** 26
- **Depends on:**

## 背景

spec 用户故事 43 + 差距清单第 2 项：产品 UI = PowerI-Web 容器，以单一（或按租户）Deployment 形态指向网关 Service。现存 `piweb-<user>`（30241+，上游 npm 进程内形态旁路网关）与 `piweb2`（jmfederico 试点，30251+）与产品路径不符，待退役。

## 定义 / 范围

1. **gen-k8s.mjs 新增 UI 部署**：`--ui` 标志部署 PowerI-Web Deployment（镜像 `poweri-web:local`，来自 ticket 26）+ Service（NodePort，建议 30341）：
   - 环境变量：`POWERI_GATEWAY_URL=http://gateway.poweri.svc.cluster.local:8080`（集群内 DNS）、`POWERI_GATEWAY_CWD=/workspace`、`POWERI_WEB_PASSWORD`（Secret）
   - 探针沿用 exec probe 模式（Basic Auth 站）；资源限额 cpu 1/mem 1Gi
   - 初始为**单实例指向单一用户 token**（认证打通前，对应 ticket 28 的前置形态），多个 UI 副本时各自带用户 token（每租户 token 经 Secret 注入）
2. **退役旧形态**：gen-k8s.mjs 的 `--piweb` / `--piweb2` 标志标注 deprecated（保留可回滚，默认不再生成）；OPERATIONS.md 更新接线架构，产品路径唯一化
3. **部署验证**：K8s 内 UI pod Ready → 经 NodePort 浏览器/curl 走 UI → 网关（集群内）→ worker → 真实 pi 全链路

## 验证

- `POWERI_AI_API_KEY=<key> node scripts/gen-k8s.mjs alice,bob --ui` 部署成功，UI pod Ready
- UI 经集群内网关 Service 全链路对话（会话落 worker PVC、文件浏览器读到 worker 数据）
- verify-24 回归仍 13/13（宿主壳不受影响）

## 测试决策

集成验证走 `verify-27.mjs`（新 UI 部署 + 全链路 + 回归）。
