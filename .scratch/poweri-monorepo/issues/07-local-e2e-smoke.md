# 07 — Local 全链路冒烟（主缝）

**What to build:** 主缝验收——迁移成功的权威标准：monorepo 内本地启动 gateway（fake provider）→ worker（bridge → pi）→ web（网关模式），浏览器完成认证 → 新建会话 → 发消息收流式回复 → 会话续接全流程；不同用户 token 之间隔离互不可见。冒烟步骤固化为可重复执行的脚本/文档。

**Blocked by:** 02, 05

**Status:** resolved

- [x] 全链路完成一次真实聊天（流式输出 + 工具调用过程可见）
- [x] 会话续接：重开页面/重连后历史完整
- [x] 多用户隔离：不同用户 token 会话互不可见
- [x] 冒烟脚本/文档落库（可重复执行，作为后续每次迁移/升级的回归基准）

## Comments

- 2026-08-13：主缝全链路冒烟打通，脚本落库。
  **链路形态**：gateway `POWERI_POD_PROVIDER=docker`（每会话自动拉起 worker 容器：`docker run -u 宿主uid:gid -v userPiDir:/home/piuser/.pi/agent -v userWorkspace:/workspace -e POWERI_AI_MODEL=agent --entrypoint node /bridge/server.mjs`）→ 容器内 bridge spawn `pi --mode rpc --model poweri-gw/agent` → 真实模型（llms.litta.cn AI 网关）。会话列表/文件/技能经 localSessions/localFiles（挂载目录双向同步）。
  **与 spec 表述的偏离**：spec 主缝写“gateway（fake provider）”，但验收要求“真实聊天 + 工具调用过程可见”，fake 无真实回复/工具（fake 模式全链路已由 ticket 04/05 验证）。冒烟采用 docker provider + 真实 pi，属自洽选型；fake-only 路径由 gateway 14/14 单测与 verify-23 覆盖。
  **修复（docker provider 实测发现）**：容器内 piuser(1001) 对宿主挂载目录（owner 1000）无写权限 → settings.lock EACCES + 会话文件不落盘 + User Memory mkdir 失败。修复：pods.mjs docker run 加 `-u $(process.getuid()):$(process.getgid())`（容器进程以宿主 uid 运行，挂载互通）。修复后：会话 JSONL 正常落盘（容器内 /home/piuser/.pi/agent/sessions/<id>.jsonl → 宿主同步）、无 EACCES、User Memory 正常。
  **真实验证**（手动 + 脚本各跑通）：
  - 真实聊天：SSE 事件流 connected/session_created(msb id)/agent_start/message_update×99（thinking_delta + text_delta 顶层 assistantMessageEvent）/tool_execution_start+end×1/agent_end/agent_settled/prompt_done；真实模型中文回复正确反映工作区内容（bash 工具列出 README.md、src/、.poweri/）——工具调用过程可见 ✅
  - 会话续接：GET /api/sessions/<msb>?deferThinking=1&deferMedia=1 返回 4 条消息（user 原文/assistant 思考+回复/toolResult 输出）content 数组完整 ✅
  - 多用户隔离：bob 会话列表空 + 读 alice 会话 404 ✅
  **脚本**：scripts/verify-33-local-e2e.mjs（自启动 gateway 18080 + web dev 30143，13 项断言，超时 300s，自动清理进程/容器，幂等；端口可覆盖；子进程意外退出立刻失败并打印日志，外部 daemon 占端口不再静默超时）。运行结果 PASS。
  **脚本断言 vs 手动观察**：脚本断言 13 项（401×2、新建会话、session_created msb、事件流收敛、工具调用事件、流式文本非空、历史≥2 条、user/assistant 内容、toolResult 持久化、历史与流式一致、bob 列表空、bob 读 404）；“回复正确反映工作区内容”“4 条消息 content 数组完整”为手动验证观察，比脚本断言更强（脚本只断言非空与一致性，防模型措辞波动）。
  **文档**：docs/local-e2e-smoke.md（自动化用法 + 浏览器人工确认清单 + 环境注意：Next16 单实例保护的外部 next dev 占用、容器 uid 修复、会话落盘机制）；README 命令列表加 verify-33。
  **gateway 回归**：14/14 通过（pods.mjs --user 改动不影响 fake/k8s 路径）。
  **遗留**：浏览器人工确认（自动化已覆盖等价断言）；GitLab CI 接入冒烟 → ticket 08 前后；真实模型依赖（llms.litta.cn 可达 + 有效 key）为运行前提。
