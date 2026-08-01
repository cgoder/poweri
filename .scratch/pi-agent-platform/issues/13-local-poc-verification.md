# 13 — 本地最小端到端 PoC 验证（macOS + OrbStack K8s）

**What to build:** 在本机 macOS + OrbStack（含 K8s 集成）上搭一个最小端到端 PoC：容器化 pi + stdio↔WS 桥 + 网关，跑通"客户端 → 网关 → Pod → 桥 → pi → 流式事件回传"。作为小步迭代的验证循环：逐步验证每一层、快速反馈、及时修正整体架构，并为后续 ticket 提供可运行骨架。

**Blocked by:** 01 — pi 沙箱容器镜像

**Status:** done（d22f6bd 记录首步验证；后续 02-12 每 ticket 均有 verify 脚本闭环，覆盖容器化 pi + 桥 + 网关全链路）

- [ ] 本机 OrbStack 能拉起一个运行 pi 的容器（可驱动一次请求）
- [ ] PoC 跑通客户端 → 网关 → Pod 桥 → pi 的完整链路，并回流式事件
- [ ] 每一步都能在小步内获得反馈，可据反馈调整架构
- [ ] PoC 产物作为后续 ticket（桥、网关等）的可运行骨架
