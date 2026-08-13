# 部署 manifests（k8s）

## 三模块部署关系（2026-08 架构对齐）

三模块各自独立编译 / 独立生成镜像 / 独立容器，K8s 部署形态**归各项目仓库自描述**，本仓库（PowerI）是控制面：`gen-k8s.mjs` 聚合一键部署（生成 per-user worker 模板 + Secret/ConfigMap，并**聚合引用** gateway/Web 的 manifest）：

| 模块 | 位置 | 镜像 | K8s manifest 归属 |
|---|---|---|---|
| PowerI（Worker） | 本仓库 `worker/` | `poweri-worker:local`（worker/docker/Dockerfile.poweri） | per-user 模板在 `scripts/gen-k8s.mjs`（参数化：用户/端口/token） |
| poweri-gateway | monorepo `gateway/`（ticket 02 并入） | `poweri-gateway:local`（gateway/Dockerfile.gateway） | `gateway/deploy/k8s/gateway.yaml`（Deployment+PVC+Service 31080，${K8S_USERS} 占位符） |
| PowerI-Web | monorepo `web/`（ticket 03 已引入，v0.8.8 纯净基底）；UI 网关模式适配与 manifest 归位待 ticket 04–06（当前 `--ui` 聚合仍引用旧仓库 /Users/tianzhao/code/leoao/poweri-web） | `poweri-web:local`（Dockerfile） | `deploy/k8s/poweri-web.yaml`（Deployment+Service 30341，${WEB_USERS}/${GW_USERS} 占位符） |

聚合一键部署：`POWERI_AI_API_KEY=<key> node scripts/gen-k8s.mjs alice,bob --ui`（注入占位符 + 生成 Secret + apply）。单仓库独立部署见各仓库 README 的 K8s 章节。

## 本目录文件

- `networkpolicy.yaml` 出站仅放行模型 API 与存储（ticket 07，enforcement 需 Cilium）
- `hpa.yaml` worker 自动伸缩（ticket 30 实跑：负载 1→2 扩容）
- `OPERATIONS.md` 运维操作手册

本地验证环境：macOS + OrbStack（含 K8s 集成），用于最小端到端 PoC（ticket 13）。

## 📘 运维操作手册

部署接线架构（Web UI → 网关 → Worker 的产品路径 vs pi-web 进程内开发路径）、业务 skill 的加载机制 / 播种 / 验证 / 新增，以及部署后业务使用场景的操作，见 **[OPERATIONS.md](./OPERATIONS.md)**（ticket 21）。

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

## pi-web 可视化实例（ticket 21，K8s 生产化形态）

每用户一个 pi-web Pod（ticket 15 方案 A 的 K8s 形态），挂载该用户 PVC 的 `pi-agent` 与 `workspace` 子路径——与 worker 完全同一数据布局，会话/工作区/记忆跨入口一致。

```bash
node scripts/gen-k8s.mjs alice,bob --piweb   # 追加生成 piweb-<user> Deployment + NodePort(30241起)
# 浏览器：http://127.0.0.1:30241（alice）/ 30242（bob），用户 pi，密码 poweri-<user>（Secret 注入）
```

生产化要素：密码进 Secret（`PI_WEB_PASSWORD_<USER>`，不进 ConfigMap）；全站 Basic Auth（无认证连接被重置）→ 探针用 exec probe（node fetch + `$PI_WEB_PASSWORD`）；非 root + 限额 cpu 1/mem 1Gi（进程内驱动 pi，比桥 512MB 宽裕）。pi-web 旁路网关（进程内 SDK 直接驱动 pi），测的是多实例隔离与真实 pi 并发；网关行为由 verify-05/06/09/16 覆盖。

**业务 skill 播种**：pi-web 运行时从 agent 目录扫描 skill（与 UI 的“网络搜索”无关）。把宿主轻量自包含业务技能推进各用户 PVC，供 worker 与 pi-web 双入口加载：

```bash
node worker/scripts/seed-skills.mjs alice,bob        # 15 个默认技能（code-review/tdd/humanizer-zh/ponytail 全家桶…）
node worker/scripts/seed-skills.mjs alice,bob data-analyzer,aliyun-cost   # 自定义技能（重技能另需数据源/凭据）
node scripts/verify-21.mjs alice,bob          # 认证/播种/进程内 pi 加载执行 skill 全链路验证
```

已知限制：初始工作目录非预设（default-cwd 返回 `~/pi-cwd-<日期>` 临时目录，选定值仅存浏览器 localStorage）——首次打开需手动选 `/workspace`，同一浏览器后不再问；生产若需确定性目录可小补丁改 default-cwd。

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

## Gateway 部署（ticket 19，已实现）

`node scripts/gen-k8s.mjs [users]` 现同时部署无状态网关层：

- `gateway` Deployment（镜像 `poweri-gateway:local`，Dockerfile 在 monorepo `gateway/Dockerfile.gateway`，构建：`cd gateway && node scripts/build-gateway.mjs`）
  - 数据挂独立 `gateway-pvc`（meta/计量持久；多副本水平扩展需共享元数据存储，生产换数据库，见 `gateway/store.mjs` 注释）
  - 内部经 Service DNS 路由到 worker：`POWERI_K8S_USERS="alice:worker-alice.poweri.svc.cluster.local:8081"`（k8s provider 支持 host:port 形式，开发机场景仍可 `alice:30081` NodePort + `POWERI_K8S_NODE_HOST`）
- `gateway` Service：NodePort 31080（集群内 `gateway.poweri.svc.cluster.local:8080`）
- **密钥不入 ConfigMap**：Secret `poweri-secrets` 存模型 apiKey + 网关用户 token；pi 配置 apiKey 写 `$POWERI_AI_API_KEY` 环境引用（`gen-pi-config` 的 `POWERI_PI_CONFIG_APIKEY_REF=1`，pi 原生 $ENV 插值），worker/gateway 容器经 `secretKeyRef` 注入

验证：`node scripts/verify-19.mjs`（引用版配置 → 部署 → ConfigMap/Secret 位置断言 → 全链路请求 → PVC 会话落盘）。
