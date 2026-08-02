# 30 — 生产收口（镜像仓库/CI、Ingress、网关元数据存储、HPA、NetworkPolicy、计量展示）

- **Type:** task
- **Status:** resolved
- **Blocked by:** 27, 28
- **Depends on:** 19（遗留项）

## 背景

spec 用户故事 45 + 差距清单第 4 项：ticket 19 收口时遗留的生产决策与未实跑项，其中镜像仓库地址/凭据与 CI/CD 流水线（GitLab）此前未决（ticket 19 遗留三件事）。

## 定义 / 范围

1. **镜像仓库 + CI/CD**（**待用户决策**：仓库地址与凭据，GitLab `.gitlab-ci.yml` + trigger）— 决策后实现：构建/推送/部署流水线，镜像 tag 锁版本
2. **Ingress/TLS**：NodePort → Ingress（域名 + TLS 终止），网关与 UI 统一入口
3. **网关多副本元数据存储**：`store.mjs` 单副本文件存储 → 共享存储/数据库（多副本水平扩展前提，见 store.mjs 注释）
4. **HPA 温池 K8s 实跑**：ticket 10 的 HPA 仅在 docker 层实测；K8s 内 min/max/CPU 伸缩验证 + 冷启动数据
5. **NetworkPolicy 应用**：`deploy/k8s/networkpolicy.yaml` 替换占位标签为真实 AI 网关白名单并应用
6. **计量用户侧展示**：`/v1/users/me/usage` 已由 ticket 29 提供 API；此处仅剩 UI 面板接入（可后置）

## 验证

- 决策落地后：verify-30.mjs 逐项（镜像从仓库拉取、Ingress 域名+TLS、网关 2 副本数据一致、HPA 实跑伸缩、NetworkPolicy 生效）
- 未决策项保持 open 状态，不阻塞其余

## 测试决策

按项验证；每项单独小节，未决项不强行实现。

## Answer

可验证项已落地（verify-30 6/6），未决项保持 open：
- **资源限额（补真实缺口）**：worker/gateway 容器此前无 resources（README 规格未进 gen-k8s，HPA CPU 利用率依赖 requests）——已补 worker 250m/256Mi→1/512Mi、gateway 100m/128Mi→1/512Mi
- **HPA K8s 实跑**：装 metrics-server（k3s 需 --kubelet-insecure-tls + registry.k8s.io 换阿里云源）→ apply deploy/k8s/hpa.yaml（worker-alice min1/max3 CPU70%）→ 压测 3 路并行长对话 → **副本 1→2 自动扩容**（CPU 4%→9%/70%），缩容受 300s 稳定窗口约束；HPA manifest 入仓库 deploy/k8s/hpa.yaml
- **NetworkPolicy 应用**：deploy/k8s/networkpolicy.yaml 重写为真实白名单（默认拒绝 + DNS(kube-system) + 模型 API 198.18.2.74/32:443，llms.litta.cn 当前解析 IP）并应用；全链路对话回归正常。**enforcement 未验证**：本机 OrbStack k3s 无 policy 型 CNI（无 flannel/cilium pod，k3s 内嵌 CNI 不实施 NetworkPolicy）——enforcement 需 Cilium/Calico（生产集群决策，另开）
- **未决（用户决策后另开）**：镜像仓库地址/凭据 + CI/CD（ticket 19 遗留）；Ingress 域名 + TLS；网关多副本共享元数据存储（现 store.mjs 文件存储单副本，多副本需 RWX/DB）；计量 UI 面板（API 已由 ticket 29 提供，面板可后置）
- 回归：verify-27/28/29 全绿；verify-30 6/6
