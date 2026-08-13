// 会话 JSONL 解析与 DTO（与 gateway 模块同步的契约副本）
// 契约所有者：monorepo gateway/session-parse.mjs（ticket 02 并入）
// 变更须两模块同步（worker/bridge 与 gateway/，各自打包进不同镜像，镜像内各持副本）+ 两侧单测锁一致（gateway/test/session-api.test.mjs 等价物）
// 会话 JSONL → 消息列表（纯函数，无 IO；单测覆盖，server.mjs 与测试共用）
export function messagesFromJsonl(lines) {
  const messages = [];
  for (const line of lines.split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      const m = o.message;
      if (!m?.role) continue;
      const parts = m.content ?? [];
      const text = parts.filter((c) => c.type === "text").map((c) => c.text).join("");
      const thinking = parts.filter((c) => c.type === "thinking").map((c) => c.thinking ?? c.text ?? "").join("");
      if (!text && !thinking) continue;
      messages.push({ role: m.role, text, thinking: thinking || undefined, ts: o.timestamp });
    } catch { /* 跳过截断行 */ }
  }
  return messages;
}

// worker 容器内会话目录（bridge HTTP 面与 k8s 会话文件路径共用，避免硬编码漂移）
export const SESSIONS_CONTAINER_DIR = "/home/piuser/.pi/agent/sessions";

// 会话 JSONL → 列表条目（bridge 与 gateway 本地模式共用同一 DTO，语义一致）：
// messageCount = messagesFromJsonl 产出条数（与 /v1/sessions/<id>/messages 天然一致）
export function sessionListEntry(id, lines, modified) {
  const msgs = messagesFromJsonl(lines);
  let cwd = "", created = "", name = "";
  for (const line of lines.split("\n")) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j.type === "session") { cwd = j.cwd ?? ""; created = j.timestamp ?? ""; break; }
    } catch { /* 截断行跳过 */ }
  }
  // 会话名（ticket 29）：反向找最新 session_info 行（pi 的 appendSessionInfo/getSessionName 约定）
  for (const line of lines.split("\n").reverse()) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j.type === "session_info" && j.name) { name = j.name; break; }
    } catch { /* 跳过 */ }
  }
  return { id, cwd, created, modified, messageCount: msgs.length, firstMessage: msgs.find((m) => m.role === "user")?.text ?? "", name };
}
