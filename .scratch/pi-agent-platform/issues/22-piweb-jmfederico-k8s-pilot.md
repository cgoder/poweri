# 22 — A′ 路线试点：jmfederico/pi-web（sessiond 分裂形态）进 K8s 每用户 Pod 验证

Type: task
Status: claimed
Depends on: 21
Created: 2026-08-02
Tags: pi-web, k8s, sessiond, pilot

## 背景

用户提出产品意图："只需要 pi-web 的用户交互界面，把这个界面和服务器上运行的 K8s Pod / PowerI Worker 连接起来"。
社区生态补充调研（docs/research/pi-web-deep-dive.md 附录）确认该场景真实存在，且有两个现成实现：

- **jmfederico/pi-web**（1.202607.3）：分裂进程模型 —— 独立 **sessiond** 守护进程承载 pi 会话（进程内 SDK，但跑在 daemon 进程，**浏览器断开会话继续跑**），web 服务（Fastify）经 HTTP/Unix socket 代理；远程优先；fleet/machines（浏览器端实例代理多个运行时）；自带 docker 分裂部署（sessiond + web 两服务，`PI_CODING_AGENT_DIR=/data/pi-agent`）；pi 兼容 `>=0.82.1 <0.83`（覆盖本项目锁定的 0.83.0）。
- **lemotw/pi-web**（Go）：镜像-控制模型，pi --mode rpc 子进程承载浏览器聊天。本轮**不验证**。

jmfederico 的 docker 信任模型明言"非沙箱、不适合非信任多租户"——每用户实例形态与此相符。

## 目标（本轮验证范围）

在本地 K8s（OrbStack）以**每用户 Pod 形态**跑起 jmfederico/pi-web，验证用户场景：
"浏览器监督服务器（K8s Pod）上真实运行的 pi agent 会话，会话脱离浏览器存活"。

验证点：
1. **部署形态**：每用户 Pod（sessiond + web 合体或分裂），工作区/agent 目录挂用户 PVC（alice-pvc 复用 ticket 21 布局：`pi-agent` + `workspace` 子路径），NodePort 暴露，web 侧认证可用。
2. **会话存活**：浏览器断开（无客户端连接）时，sessiond 中的 pi 会话仍在运行、JSONL 仍在写盘（模拟"让 pi 干活，关浏览器，回来接着看"）。
3. **会话连续性**：新会话创建、消息往返（sessiond 内真实 pi 响应）、多会话并行。
4. **与既有数据一致性**：读到的既有会话（worker 链 gateway 会话 + pi-web 会话）能否在 UI 中呈现；skills 是否从 agent 目录加载。
5. **镜像/依赖成本**：node 版本、pi 版本、镜像体积、启动时间，评估生产化改造成本。

明确不做：计量/账单/多租户（其信任模型不支持，平台语义仍属网关侧 C 路线）；lemotw fork；fleet/machines 跨机代理。

## 产出

- 运行态验证记录（verify-22 脚本或等价证据）
- ticket Answer：验证结论 + 对 A′ vs C 决策的影响 + 生产化候选改造成本

## 检查清单

- [ ] ticket 创建并 claimed
- [ ] 源码与运行配置读取（sessiond/web 启动方式、认证、数据目录、pi 版本依赖）
- [ ] 镜像构建 / Pod 部署（每用户，挂 alice-pvc）
- [ ] 验证点 1：NodePort + 认证可用
- [ ] 验证点 2：会话脱离浏览器存活（关连接后继续跑/写盘）
- [ ] 验证点 3：消息往返 + 多会话
- [ ] 验证点 4：既有会话呈现 + skills 加载
- [ ] 验证点 5：镜像/依赖成本记录
- [ ] code-review（双轴：标准 + 规格）
- [ ] Answer + resolved

## Comments

2026-08-02 — 按 matt 工作流（mattpocock/skills main flow）创建并 claim；先确认工作区已全部提交（dev 分支 27ddc14，树干净）。
