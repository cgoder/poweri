# 22 — A′ 路线试点：jmfederico/pi-web（sessiond 分裂形态）进 K8s 每用户 Pod 验证

Type: task
Status: resolved
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

## 后续调研待办（生产运维部署）

- [ ] **agent-sandbox（k8s SIG，https://agent-sandbox.sigs.k8s.io/docs/）** — 社区 case（jmfederico issue #56）即用它拉取 agent Pod。它提供 `Sandbox`（有状态单例 Pod + 稳定 hostname + 持久存储）、`SandboxTemplate`/`SandboxClaim`、`SandboxWarmPool`（预热池毫秒级分配）、hibernation/resume（空闲休眠省算力，网络触发恢复）、运行时可换 gVisor/Kata（多租户隔离）。与本项目生产关切逐条对应：warm-pool ≈ ticket 19 未来项；Sandbox ≈ 每用户 worker Deployment + PVC；隔离 ≈ 10k 多租户跑 LLM 生成代码；hibernation ≈ 空闲成本。调研点：作为每用户 worker 生产形态的替代/演进 vs 自管 Deployment+PVC，控制器成熟度、与 gen-k8s 生成物的一致性、gVisor/Kata 落地成本。

## 产出

- 运行态验证记录（verify-22 脚本或等价证据）
- ticket Answer：验证结论 + 对 A′ vs C 决策的影响 + 生产化候选改造成本

## 检查清单

- [x] ticket 创建并 claimed
- [x] 源码与运行配置读取（sessiond/web 启动方式、认证、数据目录、pi 版本依赖）
- [x] 镜像构建 / Pod 部署（每用户，挂 alice-pvc）
- [x] 验证点 1：NodePort + 认证可用（受信网络模型，见 Answer 发现 3）
- [x] 验证点 2：会话脱离浏览器存活（关连接后继续跑/写盘，0→11938B）
- [x] 验证点 3：消息往返 + 多会话并行
- [x] 验证点 4：既有会话呈现（跨重启持久）+ skills 加载（16 个，且慢任务中真实调用了 humanizer-zh）
- [x] 验证点 5：镜像/依赖成本记录（924MB / 1.202607.3 / pi-coding-agent 0.82.1 / node 22.23.2）
- [x] code-review（双轴：标准 + 规格；发现已修：锁版本、sessiond 监督、verify 三个伪检查）
- [x] Answer + resolved

## Answer

**结论：A′ 路线（jmfederico/pi-web sessiond 分裂形态）在 K8s 每用户 Pod 形态完全可行，核心用户场景（浏览器监督服务器上真实运行的 pi 会话、会话脱离浏览器存活）实证通过。** verify-22.mjs 11/11 通过。

### 验证证据（alice，piweb2-alice NodePort 30251）

- 部署：`poweri-piweb2:local`（924MB，node:22-bookworm-slim + 全局 npm 包，锁版 1.202607.3），entrypoint 后台 sessiond + 前台 web，sessiond 死亡则 web 自杀触发 Pod 重启（自愈）；gen-k8s.mjs `--piweb2` 每用户 Deployment 挂 alice-pvc 子路径 pi-agent→/data/pi-agent、workspace→/data/workspace，NodePort 30251+。
- 断开存活：`POST /sessions`（cwd=/data/workspace）→ `POST /sessions/:id/prompt` 返回 `{accepted:true}` 后**连接即关**；随后无任何客户端连接，会话在 sessiond 中继续跑完，JSONL 从 0B 长到 11938B（断开期间写盘实证）；messages API 返回完整 assistant 消息（含 usage/stopReason）。
- **真实工作证据**：慢任务（写 800 字文章）中模型调用 humanizer-zh skill 并向 /data/workspace 写入 1157B 文件 —— 浏览器 → piweb2 → sessiond → 真实 pi 在用户工作区干活，全链路通。
- 多会话并行：2 会话同时跑 6s 完成，互不阻塞。
- 跨重启持久：Pod rollout 重启后，重启前创建的 3 个会话仍出现在会话列表（JSONL 在 PVC）。
- skills：/data/pi-agent/skills 16 个（PVC 播种集），且运行中真实加载执行。

### 关键发现

1. **pi 版本错位（生产化最大约束）**：peer 范围 `>=0.82.1 <0.83` → npm 装到 pi-coding-agent **0.82.1**，不是平台锁定的 0.83.0。fork 不放开 range 就永远跑旧 SDK；需评估 0.82.x 与 0.83.0 差异（或接受 fork 版本节奏）。
2. **会话文件兼容但 UI 呈现有缺口**：sessiond 会话写 `PI_CODING_AGENT_DIR/sessions/--<cwd 编码>--/<ts>_<uuid>.jsonl`（与 agegr pi-web 同约定）；worker 链 gateway 会话（平铺 `msb*.jsonl`）同目录共存但**不属任何 cwd 编码目录 → UI 会话树不呈现**。跨入口会话文件层共存、UI 层不可见（延续 ticket 21 发现）。
3. **无内置认证**：信任模型 = allowedHosts + 受信网络（源码无密码机制）。每用户 NodePort 形态需网络策略/受信反向代理，是生产化必做项。
4. **镜像更小更快**：924MB vs agegr piweb 1.11GB；Fastify 启动秒级（探针 initialDelay 15s 足够）；CPU/内存请求 250m/512Mi、限制 1/1Gi 实测够用。
5. **sessiond 监督**：entrypoint 已做 sessiond 死→web 自杀→Pod 重启（code-review 后修复）。

### 对 A′ vs C 决策的影响

- **A′ 试点结论**：形态可行、体验最接近产品（会话存活/真实终端/多项目/fleet），是**每用户实例路线的最佳现成实现**；但平台语义（计量/账单/多租户/认证）完全不在这层——仍需网关侧，且 pi 版本被 fork peer 锁在 0.82.x。
- **C 不变**：产品 chat 入口仍推荐网关侧（平台语义完整）；但 UI 参照系升级为三血缘合并（jmfederico 会话存活/舰队 UX + lemotw 实时镜像 + agegr 工作区）。
- **agent-sandbox**（后续调研待办）：K8s SIG 的 Sandbox/WarmPool/hibernation 与生产关切逐条对应（warm-pool≈ticket 19 未来项、Sandbox≈每用户 worker、隔离≈多租户、hibernation≈空闲成本），独立调研。

### 已知债务（ponytail）

- gen-k8s.mjs 每用户资源块第三次复制（worker/piweb/piweb2 结构重复，可抽 helper）——规模到 3+ 变体时再抽。
- 命名 `piweb2` 不揭示 jmfederico/sessiond 属性。
- verify-22.mjs 单用户、无多用户 argv 循环（与 verify-21 不一致）。

### 未做（后续）

bob 多用户实例（形态与 alice 相同，属 C 场景验证）；fleet/machines 跨机代理；认证加固/网络策略；lemotw fork。浏览器交互验证：http://127.0.0.1:30251（无密码，受信网络）供用户体验。

## Comments

2026-08-02 — 按 matt 工作流（mattpocock/skills main flow）创建并 claim；先确认工作区已全部提交（dev 分支 27ddc14，树干净）。

2026-08-02 — 用户指示：agent-sandbox 方案（社区 case 中用于拉起 agent Pod 的 K8s SIG 项目）补充到生产运维部署调研待办（见上节）。同时继续试点：已克隆 jmfederico/pi-web 到 .research-tmp，确认其运行模型（sessiond+web 分裂进程、官方 Dockerfile 以 `npm i -g @jmfederico/pi-web --include=peer --allow-scripts=node-pty` 装包并软链 pi 二进制、运行时 env HOME/XDG_CONFIG_HOME/PI_WEB_DATA_DIR/PI_WEB_SESSIOND_SOCKET/PI_CODING_AGENT_DIR、无内置密码认证（信任模型=allowedHosts+受信网络）、会话文件写 PI_CODING_AGENT_DIR/sessions 与既有 PVC 布局兼容）。

2026-08-02 — 试点完成：构建 poweri-piweb2:local（924MB，node:22-slim，锁版 1.202607.3，peer 装到 pi-coding-agent 0.82.1），gen-k8s.mjs 加 --piweb2 每用户 Pod（piweb2-alice NodePort 30251），verify-22.mjs **11/11 通过**（NodePort/sessiond/建会话/prompt 断开存活（JSONL 0→11938B）/多会话并行 6s/跨重启会话持久/skills 16 个/成本证据）。真实工作证据：慢任务中模型调用 humanizer-zh skill 并向 /data/workspace 写入 1157B 文件。

2026-08-02 — code-review 双轴审查（固定点 27ddc14）：标准轴 2 硬违例（Depends on 命名、版本未锁）+ 3 气味（重复资源块/命名/数据团）；规格轴 5 缺项（验证点 5 缺失、skills 未验、既有会话仅计数、认证未验、断开写盘伪证）+ 3 实现问题（版本漂移、sessiond 无监督、7b 无法失败）。已修：Dockerfile 锁 1.202607.3、entrypoint sessiond 死亡→web 自杀→Pod 重启、verify-22 重写（完成态检测、真 JSONL 增长断言、skills 计数、成本证据、per-user pod 目标）。保留债务（ponytail）：gen-k8s 每用户资源块第三次复制、piweb2 命名、verify-22 无多用户 argv 循环。
