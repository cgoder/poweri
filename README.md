# PowerI — 基于Pi内核的Power Agent 平台

基于 [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent)（派）的多租户 Agent 平台（约 1 万用户），生产级容器部署。网关路由请求到容器化的 Worker Pod，每用户数据独立 PVC 强隔离，会话/记忆/计量全部落盘，pod 销毁重建数据不丢。

**命名由来**：业务产品名 **Power**，用 **pi** 替换其内核作为 Agent 智能体内核——**Power + PI = PowerI**。

## 文档索引

- **Spec**：`.scratch/poweri-monorepo/spec.md`（monorepo + subtree 迁移，20 条用户故事）
- **架构决策**：`docs/adr/`（0001~0010：per-user PVC、stdio↔WS 桥、无状态网关、温池、会话串行、计量、账单、User Memory、成熟 OSS 优先、monorepo + subtree）
- **术语表**：`CONTEXT.md`
- **调研**：`docs/research/`（容器部署 / 容器 PoC / 记忆生态包 / pi-web 深度 / pi-web 视觉多用户验证）
- **设计**：`docs/design/08-user-memory.md`
- **执行 ticket**：`.scratch/poweri-monorepo/issues/`（01–09：monorepo 骨架 → gateway subtree 并入 → web subtree 引入 → 适配层重放 → local 全链路验证 → gitlab 迁移；01–08 已完成，09 上游升级演练待真实发版触发）
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

## 仓库与协作（ticket 08，GitLab 迁移后）

- **唯一 remote**：`https://gitlab.litta.cn/litta-power/poweri.git`（monorepo 单一 project，2026-08-13 已推送 dev/main）
- **分支策略**：`dev` 日常开发；`main` 稳定基线（与 dev 同步推进）；改动经本地开发 → 全量验证（verify-33 冒烟等）→ 推送/MR 合并
- **旧 project 归档（只读）**：`litta-power/poweri-gateway`、`litta-power/poweri-web` 代码已并入本仓库，gitlab UI 中设为只读归档（历史保留可追溯）；原 poweri 即本仓库，无需归档
- **上游关系**：github `agegr/pi-web` 仅作 web/ 的 subtree 上游源（升级流程见 docs/upstream-upgrade-process.md），github 无部署配置；cgoder/pi-web fork 已弃用（ADR-0010）
- **subtree 纪律**：web/ 升级只走 `git subtree pull --prefix=web`（升级前跑 scripts/validate-customizations.mjs 校验 + dry-run），禁止 subtree split 反向推送

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
# 4b. 主缝冒烟（迁移/升级回归基准，需真实模型可达 + docker）
node scripts/verify-33-local-e2e.mjs   # 全链路：web→gateway(docker)→worker(pi)→真实模型（详见 docs/local-e2e-smoke.md）
# 5. worker 初始化脚本（worker/scripts/）
node worker/scripts/seed-skills.mjs alice,bob            # 播种默认业务技能到各用户 PVC
node worker/scripts/init-memory.mjs --legacy legacy.json # 存量用户数据导入 User Memory（幂等）
# 6. metrics-server（OrbStack k3s 必需：HPA CPU 指标依赖；reset/新机后务必先跑）
node scripts/install-metrics-server.mjs  # 幂等：阿里云镜像 + --kubelet-insecure-tls，见 OPERATIONS.md §6.5
```

Worker 镜像大小构成与运行资源实测见 `worker/docker/README.md`；K8s 生产形态（NetworkPolicy、资源限额、按需开通/空闲缩容）见 `deploy/k8s/README.md`。

## 云端部署闭环（ticket 10，内网 k3s + harbor）

三模块镜像构建/推送 harbor → 部署到内网 k3s（litta-llms-gw）→ 云端全链路冒烟，全流程脚本化：

```bash
# 1. 构建三镜像并推送 harbor（本机；正式 tag 用日期，如 20260814）
#    注意：本机 ~/.docker/config.json 为 WSL 遗留（wincred credsStore 不可用），需 DOCKER_CONFIG 指向干净配置
#    （只含 harbor auths：python3 -c "..." 从 ~/.docker/config.json 提取 auths 写入 /tmp/pi-docker-config/config.json）
DOCKER_CONFIG=/tmp/pi-docker-config docker build -f web/Dockerfile -t poweri-web:local web/
DOCKER_CONFIG=/tmp/pi-docker-config docker build -f gateway/Dockerfile.gateway -t poweri-gateway:local gateway/
DOCKER_CONFIG=/tmp/pi-docker-config docker build -f worker/docker/Dockerfile.poweri --build-arg PI_VERSION=0.83.0 -t poweri-worker:local worker/
# 推送（tag 替换为当日日期）
DOCKER_CONFIG=/tmp/pi-docker-config docker tag poweri-web:local harbor.litta.cn/poweri/poweri-web:20260814 && docker push ...
# 2. 部署（渲染 manifest → scp → apply → 滚动更新 worker → 冒烟）
node scripts/deploy-cloud.mjs 20260814 --smoke
# 3. 云端全链路冒烟（ssh 隧道访问 NodePort；公网安全组未全放行）
node scripts/verify-34-cloud-e2e.mjs   # 认证/会话/流式/续接/隔离 13 项断言
```

环境注记：
- **k3s 节点拉 harbor 超时**（harbor 经阿里云 ALB，节点不可达）→ deploy-cloud 依赖 ctr import 兜底（本机 save → scp → 节点 `ctr -n k8s.io images import`）；如后续 ALB 放行节点出口可去除。
- NodePort 公网：30341（web）已放行；31080（gateway）未放行 → 全链路验证走 verify-34 内置 ssh 隧道。
- 云端 Secret（poweri-secrets）与 per-user PVC 沿用既有部署，部署脚本不覆盖。
- gitlab CI 流水线（构建→推送→部署→冒烟）为下一步，当前手动脚本已可重复执行（ticket 10）。
