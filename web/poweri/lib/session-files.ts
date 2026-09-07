/**
 * PowerI 产品层：会话归档枚举（SDK-free）。
 *
 * 从 ct-jyjntc fork（lib/session-reader.ts 的 listSessionFiles/SessionFileStat、
 * lib/agent-dir.ts 的 getAgentDir、readSessionHeader）移植，独立成文件。
 *
 * 刻意不 import @earendil-works/pi-coding-agent：
 * - getAgentDir() 是 SDK 同名函数的镜像实现（$PI_CODING_AGENT_DIR || ~/.pi/agent），
 *   避免 /poweri/api/usage 冷启动加载整套 SDK 模块图（同步 jiti/require 会卡住事件循环）。
 * - readSessionHeader() 只读归档前 64KB 内第一行 JSON 拿 session id，不解析整个归档。
 *   本仓库基础层 lib/session-reader.ts 也有同名函数，但该模块顶层 import SDK，
 *   因此在这里内联一份 SDK-free 的实现（与 ct fork 的 lib/session-reader.ts 一致）。
 */
import { closeSync, existsSync, openSync, readSync } from "fs";
import { readdir, stat } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

/** A session archive on disk, with the stat fields used as a cache signature. */
export type SessionFileStat = {
  path: string;
  size: number;
  mtimeMs: number;
};

/**
 * 镜像 `@earendil-works/pi-coding-agent` 的 `getAgentDir()`：
 *   process.env.PI_CODING_AGENT_DIR（tilde 展开）|| join(homedir(), ".pi", "agent")
 */
export function getAgentDir(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR?.trim();
  if (envDir) return expandTildePath(envDir);
  return join(homedir(), ".pi", "agent");
}

function expandTildePath(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

/**
 * List session archives at <sessionsDir>/<project>/<session>.jsonl. Mirrors
 * SessionManager.listAll()'s traversal: two levels, no recursion into the
 * per-session directories that hold subagent task logs.
 */
export async function listSessionFiles(): Promise<SessionFileStat[]> {
  const sessionsDir = join(getAgentDir(), "sessions");
  if (!existsSync(sessionsDir)) return [];

  let projectDirs: string[];
  try {
    const entries = await readdir(sessionsDir, { withFileTypes: true });
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => join(sessionsDir, e.name));
  } catch {
    return [];
  }

  const perDir = await Promise.all(projectDirs.map(async (dir) => {
    try {
      const names = await readdir(dir);
      return names.filter((name) => name.endsWith(".jsonl")).map((name) => join(dir, name));
    } catch {
      return [];
    }
  }));

  const stats = await Promise.all(perDir.flat().map(async (path): Promise<SessionFileStat | null> => {
    try {
      const st = await stat(path);
      return { path, size: st.size, mtimeMs: st.mtimeMs };
    } catch {
      return null;
    }
  }));
  return stats.filter((file): file is SessionFileStat => file !== null);
}

/** Minimal header shape the usage route needs out of an archive's first line. */
export type SessionHeaderLite = {
  type: "session";
  id: string;
  timestamp?: string;
  cwd?: string;
};

/**
 * Read the archive's header line (first line, capped at 64KB) for its session id.
 * Headerless / corrupt archives return null — the SDK drops those too.
 */
export function readSessionHeader(filePath: string): SessionHeaderLite | null {
  const fd = openSync(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    const maxHeaderBytes = 64 * 1024;
    let position = 0;
    let foundNewline = false;

    while (position < maxHeaderBytes && !foundNewline) {
      const buffer = Buffer.allocUnsafe(Math.min(4096, maxHeaderBytes - position));
      const bytesRead = readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const data = buffer.subarray(0, bytesRead);
      const newlineIndex = data.indexOf(0x0a);
      chunks.push(newlineIndex === -1 ? data : data.subarray(0, newlineIndex));
      position += bytesRead;
      foundNewline = newlineIndex !== -1;
    }

    if (!foundNewline && position >= maxHeaderBytes) return null;
    const firstLine = Buffer.concat(chunks).toString("utf8").trimEnd();
    if (!firstLine) return null;
    try {
      const header = JSON.parse(firstLine) as SessionHeaderLite;
      return header.type === "session" ? header : null;
    } catch {
      return null;
    }
  } finally {
    closeSync(fd);
  }
}
