// user-memory.mjs — PowerI User Memory pi 扩展（设计见 docs/design/08-user-memory.md）
// 打包进 Worker 镜像 /poweri/extensions/，由桥以 `-e` 加载。
// 职责：context 事件按预算截断注入记忆；remember 工具让 agent 回合内零额外成本写入。
import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "typebox";
import { ensureMemoryFile, parseSections, applyRemember, truncateInjection, buildInjection } from "./memory-core.mjs";

const MEMORY_DIR = process.env.POWERI_MEMORY_DIR || path.join(process.cwd(), ".poweri", "memory");
const BUDGET_TOKENS = Number(process.env.POWERI_MEMORY_BUDGET || 3000);
const BUDGET_CHARS = BUDGET_TOKENS * 4;
const KEEP_BACKUPS = Number(process.env.POWERI_MEMORY_BACKUPS || 20);
const MARKER = "## User Memory（持久记忆"; // 幂等标记：同一进程内只注入一次
const log = (...a) => console.error("[user-memory]", ...a);

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 写前备份 + 原子写回（tmp+rename，防并发/崩溃截断） */
function writeMemory(file, content) {
  const hist = path.join(path.dirname(file), "history");
  fs.mkdirSync(hist, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backups = fs.readdirSync(hist).filter((f) => f.startsWith("memory-")).sort();
  while (backups.length >= KEEP_BACKUPS) fs.unlinkSync(path.join(hist, backups.shift()));
  fs.copyFileSync(file, path.join(hist, `memory-${stamp}.md`));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

export default function userMemoryExtension(pi) {
  let memoryFile = null;

  pi.on("session_start", async () => {
    memoryFile = ensureMemoryFile(MEMORY_DIR);
    log(`memory ready: ${memoryFile} (budget=${BUDGET_TOKENS}t)`);
  });

  // 注入点（实证结论）：context 事件改消息不会进入最终 provider 负载；
  // 新增 system 消息会触发 llsm 网关的 developer 角色位置校验 400。
  // 唯一可靠路径：before_provider_request 把记忆块追加到首位 system/developer 消息。
  pi.on("before_provider_request", async (event) => {
    const msgs = event.payload?.messages;
    if (!Array.isArray(msgs) || !msgs.length) return undefined;
    const first = msgs[0];
    if ((first.role !== "system" && first.role !== "developer") || typeof first.content !== "string") return undefined;
    if (first.content.includes(MARKER)) return undefined; // 多轮/工具调用时多次触发，幂等
    if (!memoryFile) memoryFile = ensureMemoryFile(MEMORY_DIR);
    const content = fs.existsSync(memoryFile) ? fs.readFileSync(memoryFile, "utf8") : "";
    const sec = parseSections(content);
    const hasContent = sec.profile.length || sec.facts.length || sec.preferences.length;
    first.content += "\n\n" + buildInjection(truncateInjection(content, BUDGET_CHARS), !hasContent);
    return undefined; // 原地修改生效
  });

  // 写路径：agent 回合内调用（零额外模型调用）
  pi.registerTool({
    name: "remember",
    description: "把用户透露的持续性信息写入其长期记忆（跨会话保留）。section: profile=画像 / facts=事实 / preferences=偏好；fact: 一事一行；同义更新传 replace=true。",
    parameters: Type.Object({
      section: Type.Union([Type.Literal("profile"), Type.Literal("facts"), Type.Literal("preferences")]),
      fact: Type.String(),
      replace: Type.Optional(Type.Boolean()),
    }),
    async execute(toolCallId, params) {
      if (!memoryFile) memoryFile = ensureMemoryFile(MEMORY_DIR);
      const content = fs.readFileSync(memoryFile, "utf8");
      const res = applyRemember(content, { section: params.section, fact: params.fact, replace: !!params.replace }, today());
      if (res.changed) writeMemory(memoryFile, res.content);
      return {
        content: [{ type: "text", text: res.changed ? `已记入 ${params.section}：${params.fact}` : `未写入（${res.reason}）` }],
        details: { changed: res.changed, reason: res.reason, section: params.section, memoryFile },
      };
    },
  });

  log(`loaded (dir=${MEMORY_DIR}, budget=${BUDGET_TOKENS}t, backups=${KEEP_BACKUPS})`);
}
