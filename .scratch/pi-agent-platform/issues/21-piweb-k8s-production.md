# 21 — pi-web 容器化 K8s 生产化部署与全链路用户故事回溯（ticket 15 的 K8s 形态）

- **Type:** task
- **Status:** claimed
- **Depends on:** 15（pi-web 可视化多用户验证，docker 层已实测）+ 16/19（K8s 部署形态与密钥 Secret 化）
- **核心任务：** 把 pi-web 项目做成独立容器、由 K8s（本机 OrbStack）按真实生产方式管理；通过浏览器访问 pi-web 实例，回溯生产部署前的全链路用户故事。
- **背景：** ticket 15 方案 A（每用户一个 pi-web 实例直连）已在 docker 层验证；本 ticket 把同一形态搬进 K8s——每用户 pi-web Pod 挂载该用户 PVC（与 worker 同一数据布局），生产化资源管理。

## 部署设计（生产化要素）

- **每用户独立实例**：`piweb-<user>` Deployment，挂载 `<user>-pvc` 的 `pi-agent`（/home/piuser/.pi/agent，pi-web 与 pi 共用配置/会话目录）与 `workspace`（/workspace）子路径——与 worker 完全同一数据布局，会话/工作区/记忆跨入口一致
- **密钥**：`PI_WEB_PASSWORD_<USER>` 进 Secret `poweri-secrets`（不进 ConfigMap），Pod 经 secretKeyRef 注入
- **探针**：全站 Basic Auth（无认证连接被重置）→ HTTP probe 无法携带认证 → 用 **exec probe**（node fetch + `$PI_WEB_PASSWORD`，状态 <500 即就绪）
- **限额/安全**：非 root（镜像已 USER piuser=1000）、allowPrivilegeEscalation=false、cpu 1 / mem 1Gi（pi-web 进程内驱动 pi，比桥 512MB 宽裕）
- **入口**：NodePort Service（30241 起，避开 worker 30081+/gateway 31080）
- **网络**：现有 NetworkPolicy（deploy/k8s/networkpolicy.yaml）只作用于 worker role；pi-web 同走模型 API egress，后续并入同一策略（本 ticket 不启用该策略——其模型白名单为占位标签，启用会断模型外呼）

## 验证场景（浏览器驱动）

- **(a) 单用户多会话/多话题/多场景**：alice 一个浏览器登录 pi-web，开多个会话（多标签）并行聊不同话题，观察流式输出、会话续接、工作区文件浏览
- **(b) 多用户隔离**：alice/bob 用不同浏览器（或同一浏览器不同 profile）分别登录各自实例（独立 Basic Auth），互相看不到对方会话/文件

## 运行

```bash
node scripts/gen-k8s.mjs alice,bob --piweb   # worker + gateway + piweb 一并生成应用
npm run prototype:ux                          # （可选）同时跑旅程原型
# 浏览器：http://127.0.0.1:30241（alice）/ 30242（bob），用户名 pi，密码 poweri-alice / poweri-bob
```

## Checklist

- [x] gen-k8s 支持 `--piweb`：每用户 piweb Deployment + NodePort + Secret 密码 + 探针/限额/非 root
- [x] 部署就绪（rollout status 全过），NodePort 带 Basic Auth 返回 200；交叉密码/无认证均被拒
- [x] 会话创建 smoke：ensure_session（cwd:/workspace）→ 真实 sessionId（poweri-gw/agent）
- [x] 隔离断言：Secret 含 PI_WEB_PASSWORD_ALICE/BOB；ConfigMap 无密码（仅模型名 poweri-gw）
- [x] 数据一致性：piweb-alice 挂 alice-pvc / piweb-bob 挂 bob-pvc（与 worker 同一 PVC）
- [ ] 单用户场景：多会话/多话题/多场景验证（浏览器）——原型实测中已产生 8 个真实会话（00:02–00:07）
- [ ] 多用户场景：不同浏览器隔离验证（浏览器）
- [x] 文档同步（deploy/k8s/README piweb 段）

## Answer

（部署与自动化断言已完成；浏览器场景待用户体验后补充结论）
