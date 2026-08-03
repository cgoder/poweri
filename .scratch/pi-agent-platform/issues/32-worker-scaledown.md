# 32 — 动态 worker 空闲缩容（scale-down on idle）

- **Type:** task
- **Status:** resolved
- **Blocked by:** —
- **Depends on:** 31（按需开通）
- **验证:** `node scripts/verify-32.mjs alice,carol` — 10/10 通过

## 背景

ticket 31 只做了"开"（新用户按需开通 worker），缺"关"：用户离开后 worker 常驻，
~10k 用户规模下每个空闲用户一个 1CPU/512Mi pod 不可持续。用户 2026-08-02 提出，本次收口。

## 决策

- **范围：仅动态 worker**。静态预置用户（POWERI_K8S_USERS，如 alice/bob）是常驻热备，
  保持 HPA min=1 不参与缩容（预置的意义即免冷启动）。**HPA 下界 0 未做**（ticket 31 遗留
  曾列为方向）：会破坏 verify-30（断言 min=1）与 verify-31（exec 静态 worker 查 PVC），
  并让预置用户也吃冷启动；如需统一缩到 0，另行决策后改 `deploy/k8s/hpa.yaml` minReplicas: 0。
- **缩容方式：scale-to-0，不删 PVC/Service**。数据（会话/workspace 在 PVC）随用户保留，
  下次请求秒级拉起（冷启动 30-90s）。删 PVC = 数据丢失，不做。
- **空闲判定：网关侧 lastSeen**（k8s 请求唯一咽喉 `k8sBridgeAddr` 入口触达 + 长回合
  bridgePodStream 逐事件触达防超长回合误杀），60s 巡检，空闲 > `POWERI_WORKER_IDLE_MINUTES`
  （默认 30min，env 可配，gen-k8s 注入）→ PATCH replicas 0。
- **孤儿回收**：网关重启后（lastSeen 为空、用户不在内存路由表），经 `labelSelector=role=worker`
  枚举动态 worker 一并缩容（RBAC deployments 增加 list）。
- **拉起：路由表摘除**。缩容时从 K8S_USERS 摘除该用户 → 下次请求走 ensureK8sWorker →
  GET 发现 Deployment 存在且 replicas=0 → PATCH 1 等 Ready（不重建 PVC/Service）。

## 实现

**poweri-gateway 仓库**：
- `pods.mjs`：`lastSeen`/`touch`/`scaleWorker`（merge-patch PATCH replicas）/`sweepIdleWorkers`
  （60s 巡检：空闲动态用户 + 孤儿回收），`ensureK8sWorker` 增加"已缩容 → PATCH 1 拉起"分支，
  `k8sBridgeAddr` 入口触达，`bridgePodStream` 逐事件触达；`k8sApi` 支持 PATCH content-type
  （`application/merge-patch+json`，`application/json` 会被 API server 415 拒）。
- `server.mjs`：createServer 全局 try/catch —— 修一个真实崩溃：worker 缩容后
  `/v1/sessions/<id>/messages` 无兜底，fetch ECONNREFUSED → unhandled rejection 崩整个网关进程
  （与 ticket 31 修过的同类问题）。现在任何路由异常返回 502 不崩进程。
- `deploy/k8s/gateway.yaml`：Role deployments verbs 增加 `list`；env 注入
  `POWERI_WORKER_IDLE_MINUTES`（`${IDLE_MINUTES}` 占位符，控制面 gen-k8s 注入，缺省 30）。

**poweri 仓库**：
- `scripts/gen-k8s.mjs`：applyManifest 传入 `IDLE_MINUTES`（env 可覆盖）。
- `scripts/verify-32.mjs`：验证脚本（见上）。

## 验证

`node scripts/verify-32.mjs alice,carol`（IDLE_MINUTES=1）— **10/10 通过**：
carol 首次对话开通 → 空闲 1min worker 缩容 0 + PVC 保留 + alice 常驻不受影响 →
carol 再次对话自动拉起（replicas 0→1）→ 缩容前会话仍在 PVC（数据未丢）。

## 已知局限（ponytail: 可接受）

- lastSeen 在单网关进程内；网关多副本需共享存储（生产：Redis/DB），孤儿扫描仍兜底。
- 空闲期间首个请求付冷启动 30-90s（缩容的固有成本，阈值 30min 默认已权衡）。
- 缩容与请求同刻竞态：请求可能先拿到 502，重试即拉起（不再崩进程）。

## Comments

- 2026-08-03：实现 + 验证 10/10。缩容调试中发现两个连带 bug 一并修掉：拉起路径失效
  （缩容后仍在路由表，永远连 0 副本 worker）与 `/sessions/<id>/messages` 无 try/catch 崩进程。
