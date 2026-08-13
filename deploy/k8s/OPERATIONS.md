# PowerI 运维操作手册（K8s）

> 本手册覆盖：部署接线架构、业务 skill 的加载机制/播种/验证/新增，以及部署后业务使用场景的关键操作。
> 相关：`scripts/gen-k8s.mjs`（部署）、`worker/scripts/seed-skills.mjs`（skill 播种）、`scripts/verify-21.mjs`（skill 验证）。

## 0. 部署接线架构（先读，避免误用）

**产品路径（唯一生产形态）**：PowerI-Web（网关模式壳容器，K8s 内 `poweri-web`，NodePort 30341）→ 网关（集群内 `gateway.poweri.svc.cluster.local:8080`，对外 NodePort 31080）→ Worker（`worker-<user>`）→ pi（bridge 每连接 spawn 一个 pi RPC 进程）。

```
PowerI-Web 容器 ──SSE──> 网关 gateway ──WS──> worker-<user> (bridge) ──spawn──> pi (--mode rpc)
(Basic Auth)         (Bearer token)       (8081)                (加载该用户 PVC 的配置/会话/skill)
```

**开发/验证路径（不使用 Worker）**：旧 `piweb-<user>:30241`（上游 @agegr/pi-web 进程内 SDK 旁路网关）与 `piweb2`（jmfederico 试点）。**ticket 27 起废弃**（gen-k8s `--piweb`/`--piweb2` 打废弃警告，保留可回滚）——产品路径唯一化为 PowerI-Web 网关壳。

**连接身份判别法**（一眼看出是哪个路径在服务）：
| 路径 | 会话文件位置（用户 PVC 上） | 文件名特征 |
|---|---|---|
| Worker 链（产品，含 PowerI-Web UI） | `sessions/<网关id>.jsonl` | 网关生成的短 id（如 `msb1xxx-xxxx.jsonl`） |
| pi-web（开发，已废弃） | `sessions/<编码cwd>/<ts>_<uuid>.jsonl` | ISO 时间戳 + pi 的 UUID（cwd=/workspace 编码为 `--workspace--`） |

两条路径**共用同一份用户数据**（worker 与 pi-web 挂载同一 PVC 的 `pi-agent` 与 `workspace` 子路径）：同一模型配置、同一会话目录、同一 workspace。产品选型时 Web UI 必须走网关（Worker）路径。

## 1. skill 加载机制

- pi 运行时**启动时扫描** skill 位置：`~/.pi/agent/skills/`（容器内 = `/home/piuser/.pi/agent/skills/`，即用户 PVC 的 `pi-agent` 子路径）。
- **Worker 链每次连接都 spawn 新 pi 进程 → 每次连接都重新扫描**，播种后无需重启 Worker。
- pi-web 的进程内 pi 长期存活 → **播种后需重启 piweb Pod** 才重扫（`kubectl rollout restart deploy/piweb-<user> -n poweri`）。
- pi-web UI 的"技能"面板只有网络搜索入口，**不代表运行时不能加载本地 skill**——本地加载由运行时扫描完成，与 UI 无关。
- 每个 skill = 一个目录 `<name>/SKILL.md`（可附脚本/资源）。系统提示词只注入 skill 名称与描述（渐进披露），任务匹配时 agent 用 read 加载完整 SKILL.md 并执行。
- **业务 skill 应加载进 Worker**（产品路径），即播种到用户 PVC 的 agent 目录——pi-web 进程内 pi 同源加载，仅是开发验证副产物。

## 2. 播种业务 skill（部署后、业务使用前）

```bash
# 默认集：15 个轻量自包含技能（code-review/tdd/humanizer-zh/prototype/research/ponytail 全家桶等）
node worker/scripts/seed-skills.mjs alice,bob

# 自定义集（指定 skill 名）
node worker/scripts/seed-skills.mjs alice,bob data-analyzer,aliyun-cost

# 播种后 pi-web 需重启重扫（脚本自动执行）；Worker 无需
```

- **来源目录**：`~/.agents/skills/<name>` 与 `~/.pi/agent/git/github.com/DietrichGebert/ponytail/skills/<name>`（宿主机，按需调整脚本 `SRCS`）。
- **方法**：tar 管道经 `kubectl exec`（worker Pod 作 PVC 代理）写入 `/home/piuser/.pi/agent/skills/`，幂等（同名覆盖）。
- **重技能注意**：data-analyzer（2925 文件）/aliyun-cost 等含大量附属资源，可播种但体积大，且**依赖外部数据源与凭据**（如 dbx MCP、阿里云 key），生产接入前需先解决凭据注入与网络策略。

## 3. 验证 skill 加载

```bash
node scripts/verify-21.mjs alice,bob
```

覆盖：认证 → PVC 播种数 → **两条路径**的 skill 发现与执行：
- pi-web 进程内 pi：会话创建 + 列出 `/skill:` + 工具事件读 SKILL.md（可选，模型行为有波动）
- **Worker 链（产品路径）**：网关 `/v1/chat` → Worker → pi 列出 skills + 工具执行读 SKILL.md

期望输出：`✓ alice Worker 链路（网关→Worker→pi）: skills=humanizer-zh,... + 工具执行读 SKILL.md`

## 4. 新增/自定义 skill

1. 在宿主写好 `<name>/SKILL.md`（Agent Skills 标准），`node worker/scripts/seed-skills.mjs alice,bob <name>` 播种。
2. 或直接让 pi 在会话里创建 skill（pi 会写回 agent 目录，落盘即持久）——已有实例：`frontend-design`。
3. 重技能（带数据源/凭据的领域技能）需配套数据采集 skill 与凭据注入，见 §2。

## 5. 已知限制与生产决策点

| 项 | 现状 | 生产影响 |
|---|---|---|
| pi-web 初始目录 | 非预设：default-cwd 返回 `~/pi-cwd-<日期>` 临时目录，选定值仅存浏览器 localStorage | 每浏览器一次性选 `/workspace`；需确定性目录可小补丁改 default-cwd |
| skill 分发机制 | 手动播种（seed-skills.mjs） | 万人规模需决策：镜像内置默认技能 / ConfigMap 下发 / 按需安装，另开 ticket |
| user-memory 扩展 | 仅 bridge `-e` 注入；pi-web 进程内 pi 未挂 | 跨入口记忆一致性缺口，需纳入 settings.json 或 piweb 镜像 |
| 网络策略 | `deploy/k8s/networkpolicy.yaml` 未应用到集群（模型白名单为占位标签） | 生产启用前先替换为真实 AI 网关白名单 |

## 6. 常用操作速查

```bash
# 部署（worker + gateway + [--ui] PowerI-Web UI / [--piweb] 旧 pi-web（废弃） / [--piweb2] jmfederico（废弃））
POWERI_AI_API_KEY=<key> node scripts/gen-k8s.mjs alice,bob --ui

# skill 播种 / 验证
node worker/scripts/seed-skills.mjs alice,bob
node scripts/verify-21.mjs alice,bob

# 访问
#   PowerI-Web UI（产品入口）: http://127.0.0.1:30341（每用户账号：alice/poweri-alice、bob/poweri-bob，ticket 28；POWERI_WEB_USERS 可覆盖）
#   Web API（产品路径）     : 网关 http://127.0.0.1:31080/v1/chat（Bearer token-a/token-b）
#   Worker 数据（PVC）    : kubectl exec deploy/worker-<user> -n poweri -- ls /home/piuser/.pi/agent/sessions
```

## 6.5 生产收口实况（ticket 30，K8s 已验证）

- **新用户按需开通（ticket 31）**：网关 k8s provider 对不在静态表（POWERI_K8S_USERS）的新用户，经 in-cluster SA（Role `poweri-gateway`，gateway.yaml 自带）调 K8s API 自动创建 PVC+Deployment+ClusterIP Service（模板与 gen-k8s 同构）。验证：`node scripts/verify-31.mjs alice,carol`（仅预置 alice；carol 首次 Web 接入 → worker-carol 自动创建 + 会话落自己 PVC + 与 alice 零重叠 + 不同 Pod，10/10）。

- **所有用户空闲缩容（ticket 32，统一版）**：预置与按需用户行为一致——任何 worker 空闲超过
  `POWERI_WORKER_IDLE_MINUTES`（默认 30，gen-k8s 注入；`node scripts/gen-k8s.mjs ... POWERI_WORKER_IDLE_MINUTES=1`
- **资源限额**：worker（requests 250m/256Mi，limits 1/512Mi）与 gateway（100m/128Mi → 1/512Mi）已入 gen-k8s（此前缺失）。
  30-90s）。验证：`node scripts/verify-32.mjs alice,carol`（两用户各自 开通/预置→空闲缩容→拉起→数据不丢，10/10）。
  `kubectl rollout restart deploy/gateway` 后，重启前已缩容/开通的 worker 会在下次请求按需恢复。

- **资源限额**：worker（requests 250m/256Mi，limits 1/512Mi）与 gateway（100m/128Mi → 1/512Mi）已入 gen-k8s（此前缺失——HPA CPU 利用率依赖 requests 字段）。
- **无 HPA（ticket 32 移除）**：CPU-only HPA 不支持 `minReplicas: 0`（需 Object/External 指标才允许缩到 0），
  与"所有用户统一缩到 0"互斥；负载扩容属优化，需要指标源后另行决策。metrics-server 不再需要
  （`scripts/install-metrics-server.mjs` 保留备用）。
- **NetworkPolicy**：`deploy/k8s/networkpolicy.yaml` 已应用（默认拒绝出站 + DNS + 模型 API 198.18.2.74/32 白名单）。**注意：本机 OrbStack k3s 无 policy 型 CNI（无 flannel/cilium pod，k3s 内嵌 CNI），策略只落不实施；enforcement 需 Cilium/Calico，属生产集群决策。** 生产环境模型 API 出口需替换 CIDR（或集群内自建网关走 namespaceSelector）。

**待用户决策**（ticket 30 未决项）：镜像仓库地址/凭据 + CI/CD 流水线（GitLab）；Ingress 域名 + TLS；网关多副本共享元数据存储（现 store.mjs 文件存储，单副本）。

## 7 网关文件/技能 API（pi-web 壳接通）（pi-web 壳接通）

网关新增只读三接口（Bearer token 认证，token→user 路由到对应 worker）：
- `GET /v1/files?path=&recursive=` — 工作区目录列表/递归走查（限 /workspace 内）
- `GET /v1/file?path=` — 读取工作区文件（utf8）
- `GET /v1/skills` — worker 上技能列表（扫 agent skills 目录，解析 SKILL.md frontmatter）

用途：PowerI-Web（独立仓库 /Users/tianzhao/code/leoao/poweri-web，原名 pi-web (agegr)）壳网关模式的文件浏览器与技能菜单（ticket 25）。bridge 侧对应 HTTP 面 `GET /files|/file|/skills`（同 /sessions 模式），改 bridge/gateway 后需重建 poweri-worker + poweri-gateway 镜像并 rollout restart。
