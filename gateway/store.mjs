// PowerI 元数据存储（PoC：本地 JSON 文件；生产替换为数据库/元数据服务）
// 职责：维护 user→最新 session 映射，支撑无状态网关路由。
// 数据目录：POWERI_DATA_DIR（默认 <cwd>/data），user→session 映射在 data/meta/<userId>.json

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.POWERI_DATA_DIR ?? path.join(process.cwd(), "data");
const META_DIR = path.join(DATA_DIR, "meta");

const metaFile = (userId) => path.join(META_DIR, `${userId}.json`);

export function getLastSession(userId) {
  try {
    return JSON.parse(readFileSync(metaFile(userId), "utf8")).lastSessionId ?? null;
  } catch {
    return null;
  }
}

export function setLastSession(userId, sessionId) {
  mkdirSync(META_DIR, { recursive: true });
  const prev = { userId, sessions: [] };
  try { prev.sessions = JSON.parse(readFileSync(metaFile(userId), "utf8")).sessions ?? []; } catch {}
  if (!prev.sessions.includes(sessionId)) prev.sessions.push(sessionId);
  writeFileSync(metaFile(userId), JSON.stringify(
    { userId, lastSessionId: sessionId, sessions: prev.sessions.slice(-50), updatedAt: Date.now() }, null, 2));
}

export function newSessionId() {
  return `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}
