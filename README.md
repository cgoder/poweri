# PowerI — 基于Pi内核的Power Agent 平台

基于 [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent)（派）的多租户 Agent 平台（约 1 万用户），生产级容器部署。网关路由请求到容器化的 Worker Pod，每用户数据独立 PVC 强隔离，会话/记忆/计量全部落盘，pod 销毁重建数据不丢。

**命名由来**：业务产品名 **Power**，用 **pi** 替换其内核作为 Agent 智能体内核——**Power + PI = PowerI**。

## 文档索引

- **Spec**：`.scratch/poweri-monorepo/spec.md`（monorepo + subtree 迁移，20 条用户故事）
- **架构决策**：`docs/adr/`（0001~0010：per-user PVC、stdio↔WS 桥、无状态网关、温池、会话串行、计量、账单、User Memory、成熟 OSS 优先、monorepo + subtree）
- **术语表**：`CONTEXT.md`
- **调研**：`docs/research/`（容器部署 / 容器 PoC / 记忆生态包 / pi-web 深度 / pi-web 视觉多用户验证）
- **设计**：`docs/design/08-user-memory.md`
- **执行 ticket**：`.scratch/poweri-monorepo/issues/`（01–09：monorepo 骨架 → gateway subtree 并入 → web subtree 引入 → 适配层重放 → local 全链路验证 → gitlab 迁移；01–04 已完成）
- **web 定制清单**：`docs/web-customizations.md`（侵入上游文件的改动集合，上游升级前对照）
  - 平台主线历史（已收口）：`.scratch/pi-agent-platform/issues/`（01–32）

## 仓库结构（monorepo，ADR-0010）

```
worker/            Worker 沙箱模块（自包含）：
                   bridge/          每个 Worker Pod 内的 stdio↔WebSocket 桥（每连接一个 pi --mode rpc 子进程）
                   memory-extension/ User Memory pi 扩展（remember 工具 + 预算注入，随执行循环读写）
                   docker/           Worker 镜像构建（Dockerfile.poweri + 大小/资源实测文档）
                   scripts/          Worker 初始化脚本（init-memory 存量记忆导入、seed-skills 播种）
gateway/           无状态网关：认证/路由/会话续接/并发串行/流式转发(SSE+WS)/计量/计价/账单/日志
                   —— ticket 02 已并入（git subtree add，squash；源 poweri-gateway dev f3a9406）
web/               PowerI-Web（网关模式 UI 壳）
                   —— ticket 03 已引入（git subtree add，squash；上游 agegr/pi-web v0.8.8 纯净基底，零定制）
deploy/            平台控制面部署物：k8s/（每用户 PVC/Deployment/NodePort、NetworkPolicy、gateway 部署）+ config/（平台 pi 配置，gen-pi-config 输出）
scripts/           根级聚合脚本：构建（build-image → worker/docker/）、配置生成（gen-pi-config）、
                   K8s 部署（gen-k8s）、metrics-server 安装、验证（verify-19/21~32）
docs/              ADR / design / research / agents
CONTEXT.md         平台术语表
data/              PoC 数据目录（每用户 PVC 占位，已 gitignore）
```

### 模块边界判定（ticket 01）

判定原则：**文件运行在 worker 沙箱内、或其产物被 worker 沙箱独占消费 → `worker/`；运行在平台控制面且被多模块消费 → 留根。**

| 判定 | 文件 | 理由 |
|---|---|---|
| 进 `worker/` | `bridge/`、`memory-extension/` | Worker 镜像内运行（Dockerfile COPY 进镜像） |
| 进 `worker/` | `docker/`（原 `deploy/docker/`） | worker 镜像构建物，Dockerfile 与桥/扩展强耦合，随模块自包含 |
| 进 `worker/` | `scripts/init-memory.mjs`、`scripts/seed-skills.mjs` | worker 初始化脚本：初始化 User Memory / 播种 skills，产物仅 worker 沙箱消费 |
| 留根 | `deploy/config/` | 平台 pi 配置（gen-pi-config 输出），gateway seedUser 也消费 → 平台级 |
| 留根 | `deploy/k8s/`、`scripts/` 其余、`docs/`、`CONTEXT.md` | 部署编排、验证脚本、平台文档 |

## 本地验证（macOS + OrbStack）

测试环境跑在本机 macOS，Docker 用 OrbStack（含 K8s 集成），小步迭代快速反馈——见 ticket `13` 与 `deploy/`。

```bash
# 1. 配置：cp env.example .env 填 AI 网关变量 → 生成 pi 配置（到项目 deploy/config/pi，不污染宿主 ~/.pi/agent）
bun run gen:pi-config          # 渲染 deploy/config/pi/models.json + settings.json
# 2. 镜像：构建锁版本 worker 镜像（pi@0.83.0，非 root，512MB 官方形态；Dockerfile 在 worker/docker/）
node scripts/build-image.mjs   # → poweri-worker:local
# 3. worker 单测（memory-extension 纯逻辑）
npm run test:unit              # node --test worker/memory-extension/test/
# 4. 验证：K8s 全链路（fake/docker 层 + 真实模型）
node scripts/verify-19.mjs alice     # gateway+worker 全 K8s、ConfigMap 无明文密钥、真实模型回复
node scripts/verify-21.mjs alice,bob # skill 播种 + Worker 链路 skill 加载
node scripts/verify-23.mjs          # 会话列表/历史 API
node scripts/verify-24.mjs          # PowerI-Web 壳 → 网关 → worker 全链路（旧形态）
node scripts/verify-26.mjs          # PowerI-Web 容器化验证（ticket 26）
node scripts/verify-27.mjs alice,bob # PowerI-Web UI 部署形态 + 旧形态废弃
node scripts/verify-28.mjs alice,bob # 每用户账号 → 网关 token 认证隔离
node scripts/verify-29.mjs alice     # 会话改名/删除 + 用户侧计量
node scripts/verify-30.mjs alice     # 生产收口（资源限额/NetworkPolicy）
node scripts/verify-31.mjs alice,carol # 新用户按需开通（仅预置 alice，carol 首次接入自动开 worker）
node scripts/verify-32.mjs alice,carol # 空闲超时缩容（PVC 保留，数据不丢）
# 5. worker 初始化脚本（worker/scripts/）
node worker/scripts/seed-skills.mjs alice,bob            # 播种默认业务技能到各用户 PVC
node worker/scripts/init-memory.mjs --legacy legacy.json # 存量用户数据导入 User Memory（幂等）
# 6. metrics-server（OrbStack k3s 必需：HPA CPU 指标依赖；reset/新机后务必先跑）
node scripts/install-metrics-server.mjs  # 幂等：阿里云镜像 + --kubelet-insecure-tls，见 OPERATIONS.md §6.5
```

Worker 镜像大小构成与运行资源实测见 `worker/docker/README.md`；K8s 生产形态（NetworkPolicy、资源限额、按需开通/空闲缩容）见 `deploy/k8s/README.md`。
