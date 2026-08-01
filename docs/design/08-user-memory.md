# 08 — User Memory 扩展设计

> 状态：设计定稿（已完成 调研 → 论证 → 设计 三步）
> 关联：ADR-0008 / ticket 08 / spec 用户故事 29–36

## 1. 目标

每用户跨会话累积"记忆"（画像、事实、偏好），持久化在其 PVC 工作区；agent 执行过程中动态读入上下文（不只请求开始注入一次），使平台越来越懂用户。物理隔离、不丢失、不跨用户泄漏；上线时存量数据幂等初始化。

## 2. 实证基础（调研结论，一手资料 + spike）

- **扩展在容器内可用**：pi 0.83.0，`--extension/-e <path>` 加载；RPC 模式 `ctx.mode="rpc"`、`ctx.hasUI=true`（对话框/通知走 JSON 协议），扩展事件在 headless 下完整触发。
- **注入点**：`context` 事件——每次 LLM 调用前触发，`event.messages` 为深拷贝可安全修改，返回 `{messages}` 生效。
- **写入点**：`turn_end`（本回合消息+工具结果）、`agent_settled`（整轮结束，`ctx.isIdle()=true`）。
- **持久化**：扩展可用 `node:fs` 写 `/workspace`（= 每用户 PVC 挂载点），跨进程/跨会话保留。
- **spike 实测**（memory-probe.ts，沙箱容器）：
  ```
  ext-load(cwd=/workspace) → session_start → context(msgs=1) → turn_end → agent_settled(isIdle=true) → memory.md 落盘
  ```
  第二次运行（新进程）文件仍在 → 跨进程持久成立 ✅

## 3. 决策记录（论证结论，4 项均已确认）

| 维度 | 决策 |
|---|---|
| 内容模型 | **混合**：`## 画像 / ## 事实 / ## 偏好` 三节 markdown |
| 写入时机 | **每回合增量写**（见 4.4 的零额外成本细化） |
| 注入方式 | **上限截断注入**：预算可配（`POWERI_MEMORY_BUDGET`），超预算保留画像 + 最近条目 |
| 存储位置 | `/workspace/.poweri/memory/`（用户可见、可自查编辑；随 PVC 隔离） |

## 4. 设计

### 4.1 组件与加载

- 扩展代码打包进 Worker 镜像：`/poweri/extensions/user-memory.ts`（单一代码源，随镜像版本化）。
- 桥启动 pi 时追加 `-e /poweri/extensions/user-memory.ts`（桥读取 `POWERI_EXTENSIONS` 环境变量，默认带该路径）。
- 每个 Pod 的 pi 进程加载同一扩展；**状态天然按用户隔离**——每个 Pod 只挂载该请求用户自己的 PVC。

### 4.2 记忆文件布局

```
/workspace/.poweri/memory/
├── memory.md          # 主记忆（三节，注入源）
│   ## 画像            # 身份/角色/背景
│   - 产品负责人，中文交流
│   ## 事实            # 随时间累积的事件/决定（带日期）
│   - [2026-08-01] 平台名为 PowerI
│   ## 偏好            # 风格/禁忌/偏好
│   - 回复要简洁，不用 emoji
└── history/           # 写入前备份，滚动保留最近 N 版（默认 20）
```

### 4.3 读路径（注入）

- `context` 事件：每次 LLM 调用前读取 `memory.md`，向 `event.messages` 头部 prepend 一条 system 消息：
  ```
  ## User Memory（来自 /workspace/.poweri/memory/memory.md）
  <memory.md 内容>
  ## 记忆使用规则
  当用户透露持续性信息（身份/偏好/决定/项目进展）时，调用 remember 工具记入对应节；
  寒暄、瞬时指令、已答问题不要记；同义事实用 replace 去重。
  ```
- 预算：`POWERI_MEMORY_BUDGET`（默认 3000 tokens，按 chars≈tokens×4 估算，可调）。
- 超预算截断：**保留 `## 画像` 全部 + 事实/偏好各取最近条目**（先裁最旧），保持 markdown 结构完整。
- 空 memory.md（新用户）：注入"记忆为空"占位，让 agent 知道体系存在但不强行注入。

### 4.4 写路径（remember 工具，零额外模型调用）

- 注册自定义工具 `remember(section, fact, replace?)`：
  - `section`: `"profile" | "facts" | "preferences"`（对应三节）
  - `fact`: 一事一行
  - `replace`: true = 替换同前缀行（去重更新）
- 执行逻辑：读 memory.md → 更新对应节 → 旧内容备份到 `history/` → 原子写回（tmp+rename）。
- 事实自动加 `[YYYY-MM-DD]` 前缀（容器本地日期）；identical fact 幂等跳过。
- **为什么不是 agent_settled 后 LLM 摘要**：回合后另发一次 LLM 调用做摘要 = 每回合模型成本翻倍（10k 用户规模不可接受）。改为 **agent 在回合内直接调用 remember 工具写入**——复用本回合已发生的模型推理，零额外调用；效果上就是"每回合增量写"（Q2 的等价实现）。代价：依赖 agent 自觉调用，用注入指令+工具定义约束。

### 4.5 存量数据初始化（Legacy onboarding）

- `scripts/init-memory.mjs`：平台上线时按用户分批跑。
  - 输入：存量数据（档案/画像/历史记录 JSON/Markdown，按 userId 提供）。
  - 输出：写入该用户 `/workspace/.poweri/memory/memory.md`（与 4.2 同构）。
  - **幂等**：memory.md 已存在则跳过（不覆盖已累积记忆）。
  - 分批 + 可重试（每用户独立文件，失败不影响他人）。
- 兜底：用户首次运行且无 memory.md → 扩展不注入，正常累积（4.3 空记忆路径）。

### 4.6 隔离与安全

- 记忆文件在用户自己的 PVC 工作区 → 物理隔离（ADR-0001），不跨用户泄漏。
- 扩展只读写本容器挂载的 `/workspace`（即该用户目录），无其他网络/存储访问面。
- 注入只发生在该用户 pi 进程的上下文构造中。

## 5. 边界（Out of scope）

- 不做：跨用户记忆共享/推荐、记忆版本冲突合并、agent_settled 后 LLM 摘要式补写、记忆容量管理/清理策略（超出预算前的自然截断是唯一兜底）。
- 预算默认值 3000 tokens 为初值，上线后按实际成本/效果调优。

## 6. 验证计划（实现后执行）

1. **单测**：注入截断（预算内全文 / 超预算保留画像+最近）、remember 增/改/幂等、备份滚动。
2. **集成（真实 pi）**：告知偏好 → 下一会话注入生效（行为体现偏好）；`turn_end` 事件流中无额外 LLM 回合（零成本验证）。
3. **隔离**：alice 记忆绝不出现于 bob 的上下文。
4. **存量初始化**：假存量数据跑 init-memory → memory.md 生成、重跑幂等跳过。
5. **跨 Pod 持久**：销毁 Pod 后新 Pod 仍注入同一记忆。
