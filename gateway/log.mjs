// PowerI 结构化日志（ticket 11）：JSONL 追加写，路径 data/logs/<YYYY-MM-DD>.jsonl
// 每请求一行：{ts, type:"request", userId, sessionId, requestId, ok, durationMs, usage, platform}
// requestId 即 traceId：client→网关→Pod（桥 prompt id）贯穿同一链路（PoC 单进程已足够关联）
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export function logDir() {
  return process.env.POWERI_LOG_DIR ?? path.join(process.env.POWERI_DATA_DIR ?? "data", "logs");
}
const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function logEvent(obj) {
  try {
    const dir = logDir();
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, `${dayKey()}.jsonl`), JSON.stringify({ ts: Date.now(), ...obj }) + "\n");
  } catch { /* 日志失败不影响请求 */ }
}
