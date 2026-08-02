# PowerI — 基于Pi内核的Power Agent 平台

基于 [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent)（派）的多租户 Agent 平台（约 1 万用户），生产级容器部署。网关路由请求到容器化的 Worker Pod，每用户数据独立 PVC 强隔离，会话/记忆/计量全部落盘，pod 销毁重建数据不丢。

**命名由来**：业务产品名 **Power**，用 **pi** 替换其内核作为 Agent 智能体内核——**Power + PI = PowerI**。

## 文档索引

- **Spec**：`.scratch/pi-agent-platform/spec.md`（38 条用户故事，测试/实现决策）
- **架构决策**：`docs/adr/`（0001~0008：per-user PVC、stdio↔WS 桥、无状态网关、温池、会话串行、计量、账单、User Memory）
- **术语表**：`CONTEXT.md`
- **调研**：`docs/research/`（容器部署 / 容器 PoC / 记忆生态包 / pi-web 视觉多用户验证）
- **设计**：`docs/design/08-user-memory.md`
- **执行 ticket**：`.scratch/pi-agent-platform/issues/`（主线 01–13 + K8s 验证 16 + 可视化验证 15 + 记忆包决策 14 + 记忆移植 18 + 生产化收口 19 已完成；17 pi-web 网关客户端评估已定案不做）

## 仓库结构

```
gateway/           无状态网关：认证/路由/会话续接/并发串行/流式转发(SSE+WS)/计量/计价/账单/日志
bridge/            每个 Worker Pod 内的 stdio↔WebSocket 桥（每连接一个 pi --mode rpc 子进程）
memory-extension/  User Memory pi 扩展（remember 工具 + 预算注入，随执行循环读写）
deploy/            docker 镜像（poweri-worker + poweri-gateway）+ k8s manifests（每用户 PVC/Deployment/NodePort、NetworkPolicy、gateway 部署）+ config/pi 平台配置目录
scripts/           构建(build-image/build-gateway)/配置生成(gen-pi-config)/K8s 部署(gen-k8s)/验证(verify-05~12、verify-19、verify-23~30、verify-k8s)
docs/              ADR / design / research / agents
data/              PoC 数据目录（每用户 PVC 占位，已 gitignore）
```

## 本地验证（macOS + OrbStack）

测试环境跑在本机 macOS，Docker 用 OrbStack（含 K8s 集成），小步迭代快速反馈——见 ticket `13` 与 `deploy/`。

```bash
# 1. 配置：cp env.example .env 填 AI 网关变量 → 生成 pi 配置（到项目 deploy/config/pi，不污染宿主 ~/.pi/agent）
bun run gen:pi-config          # 渲染 deploy/config/pi/models.json + settings.json
# 2. 镜像：构建锁版本 worker 镜像（pi@0.83.0，非 root，512MB 官方形态）
node scripts/build-image.mjs   # → poweri-worker:local
# 3. 验证：网关 fake/docker 层单元 + 集成验证
node --test gateway/test/      # 网关单测
node scripts/verify-06.mjs B   # docker + 真实 pi 全链路（流式/续接/隔离）
# 4. K8s：每用户 PVC + worker Deployment + NodePort 真实部署验证
node scripts/gen-k8s.mjs alice,bob   # ConfigMap 播种 + Secret 注入（密钥不进 ConfigMap）
node scripts/verify-k8s.mjs          # 多用户隔离 / 会话落 PVC / Pod 重建续接
# 5. 生产形态（ticket 19）：gateway 也进 K8s + 密钥 Secret 化全链路
node scripts/build-gateway.mjs       # → poweri-gateway:local
node scripts/verify-19.mjs alice     # 部署 gateway+worker、ConfigMap 无明文密钥、真实模型回复
# 6. PowerI-Web（产品 UI 壳，独立仓库）：浏览器 → 网关 → Worker → 真实 pi
#    部署：node scripts/gen-k8s.mjs alice,bob --ui → http://127.0.0.1:30341（账号 alice/poweri-alice）
node scripts/verify-27.mjs alice,bob # UI 部署形态 + 旧形态废弃
node scripts/verify-28.mjs alice,bob # 每用户账号 → 网关 token 认证隔离
node scripts/verify-29.mjs alice     # 会话改名/删除 + 用户侧计量
node scripts/verify-30.mjs alice     # 生产收口（资源限额/HPA/NetworkPolicy）
```

Worker 镜像大小构成与运行资源实测见 `deploy/docker/README.md`；K8s 生产形态（HPA、NetworkPolicy、资源限额草案）见 `deploy/k8s/README.md`。
