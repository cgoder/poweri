# pi 容器 PoC 验证记录（ticket 13 · 第一步）

> 场景：本地 macOS + OrbStack，验证 pi 沙箱容器能否作为 Agent 内核正常工作，
> 以及网关链路（容器内 pi → 自建 OpenAI 兼容网关）是否打通。

## 环境
- 镜像：`pi-sandbox:local`（`deploy/docker/Dockerfile.pi`，node:24 + pi@0.83.0，非 root `piuser`）
- 配置：`.env` 中 `POWERI_AI_*` 指向自建网关 → `bun run gen:pi-config` 生成 `~/.pi/agent/{models,settings}.json`
- 运行：`docker run --rm -v <cfg>:/home/piuser/.pi/agent pi-sandbox:local ...`

## 验证结果

| # | 能力 | 结果 | 证据 |
|---|------|------|------|
| 0 | 镜像构建/运行 | ✅ | pi 0.83.0 以 `piuser` 运行 |
| 0 | 网关连通 | ✅ | 容器内 pi → `llsm.litta.cn` → 真实返回 |
| ① | Thinking | ✅ | JSONL 含 `thinking_level_change` + `message.content[0].thinking`（229 字推理） |
| ② | 工具调用 | ✅ | write 真实落盘挂载工作区 + read 读回 |
| ③ | 多轮会话 | ✅ | 两个独立容器共享同一 session JSONL，次轮记得上轮事实 |

## 关键复现命令

```bash
# 生成配置
bun run gen:pi-config

# ① thinking（检查 session JSONL 中的 thinking 字段）
docker run --rm -v <cfg>:/home/piuser/.pi/agent \
  pi-sandbox:local --model poweri-gw/agent --thinking medium \
  --session /data/s.jsonl -p "How many r's are in strawberry?"

# ② 工具调用（WS=挂载的工作区）
docker run --rm -v <cfg>:/home/piuser/.pi/agent -v <WS>:/workspace \
  pi-sandbox:local -p "write hello.txt then read it back"

# ③ 多轮（SES=挂载的会话目录，两轮共享同一 session 文件）
docker run --rm -v <cfg>:/home/piuser/.pi/agent -v <SES>:/data \
  pi-sandbox:local --session /data/m.jsonl -p "Remember: favorite color is teal"
docker run --rm -v <cfg>:/home/piuser/.pi/agent -v <SES>:/data \
  pi-sandbox:local --session /data/m.jsonl -p "What is my favorite color?"  # → teal
```

## 结论
- pi 在容器内作为 Agent 内核满足全部核心需求：**会思考、会调用工具、会话可持久化可恢复**。
- 测试③ 字面演示了 ADR-0001 的"从 per-user PVC 恢复会话"架构：独立 pod 只靠共享 session JSONL 完成跨轮记忆。
- 下一步：stdio↔WebSocket 桥（ticket 02），让网关能流式驱动容器内 pi。
