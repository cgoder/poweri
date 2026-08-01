# Poweri — pi 万人 Agent 平台

基于 [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) 的多租户 Agent 平台（约 1 万用户），生产级容器部署。网关路由请求到容器化的 Worker Pod，每用户数据独立 PVC 强隔离。

## 文档索引

- **Spec**：`.scratch/pi-agent-platform/spec.md`（36+ 条用户故事，测试/实现决策）
- **架构决策**：`docs/adr/`（0001~0008）
- **术语表**：`CONTEXT.md`
- **调研依据**：`docs/research/pi-container-deployment.md`
- **执行 ticket**：`.scratch/pi-agent-platform/issues/`
  - Frontier：`01 pi 沙箱镜像`（无阻塞）、`13 本地最小端到端 PoC`（仅依赖 01）

## 仓库结构

```
gateway/           无状态网关层：认证/路由/会话续接/并发控制/流式转发/计量
bridge/            每个 Worker Pod 内的 stdio↔WebSocket 桥（暴露 pi RPC）
memory-extension/  User Memory pi 扩展（随执行循环读写用户记忆）
deploy/            部署：docker 镜像 + k8s manifests
docs/              ADR / agents 配置 / 调研
```

## 本地验证（macOS + OrbStack）

测试环境跑在本机 macOS，Docker 用 OrbStack（含 K8s 集成）。以最小端到端 PoC 小步迭代、快速反馈、修正架构——见 ticket `13` 与 `deploy/`。
