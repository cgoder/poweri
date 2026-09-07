/**
 * 历史会话时间线分组逻辑（F6 正式实现）。
 * 设计原则（2026-08-20 用户定稿）：
 * - 历史会话首先面向人（用户）：时间线是主框架（工作路径），项目是次维度
 * - 按天模式：天内严格时间升序、不按工作区分组（交替并行工作自然呈现），
 *   项目用 chip 标识；天头聚合 tokens/费用/缓存命中率
 * - 按工作区模式：该项目的专属时间线（区内时间降序，跨天带日期）
 * 纯逻辑、无 React/无 I/O（数据由调用方经 /api 获取后传入）。
 */

export type HistoryRow = {
  id: string;
  title: string;
  cwd: string;
  workspace: string; // cwd basename
  ts: number; // created 时间戳
  messages: number;
  tokens: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
};

export type GroupMode = "day" | "workspace";

export type DayGroup = {
  key: string; // YYYY-MM-DD
  ts: number; // 组内最大时间戳
  rows: HistoryRow[];
};

export type WorkspaceGroup = {
  name: string;
  rows: HistoryRow[];
  lastTs: number;
};

export function workspaceNameOf(cwd: string): string {
  if (!cwd) return "(未知)";
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

const dayKey = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();

/** 天标签：今天 / 昨天 / M月D日 周X */
export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${d.getMonth() + 1}月${d.getDate()}日 ${week[d.getDay()]}`;
}

/** 当天内时间 HH:MM */
export function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 跨天时间线：今天 HH:MM / 昨天 HH:MM / M/D HH:MM */
export function fmtClockFull(ts: number): string {
  const d = new Date(ts);
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
  const hhmm = fmtClock(ts);
  if (diffDays === 0) return hhmm;
  if (diffDays === 1) return `昨天 ${hhmm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`;
}

export function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${n}`;
}

export const fmtCount = (n: number): string => `${n.toLocaleString("zh-CN")} 条消息`;

export const fmtCost = (n: number): string => (n > 0 ? `$${n.toFixed(2)}` : "");

export const fullTime = (ts: number): string => new Date(ts).toLocaleString("zh-CN");

/** 组内 tokens 合计 */
export const groupTokens = (rows: HistoryRow[]) => rows.reduce((s, r) => s + r.tokens, 0);

/** 组内费用合计 */
export const groupCost = (rows: HistoryRow[]) => rows.reduce((s, r) => s + r.cost, 0);

/** 组内缓存命中率：ΣcacheRead / Σ(input + cacheRead + cacheWrite)，无数据返回 null */
export function groupCacheHitRate(rows: HistoryRow[]): number | null {
  const input = rows.reduce((s, r) => s + r.input, 0);
  const read = rows.reduce((s, r) => s + r.cacheRead, 0);
  const write = rows.reduce((s, r) => s + r.cacheWrite, 0);
  const denom = input + read + write;
  if (denom <= 0) return null;
  return (read / denom) * 100;
}

/**
 * 按天 → 天内扁平时间线（严格时间升序，不按工作区分组）。
 * 面向人：时间线是工作路径的主框架，项目用 chip 标识（交替并行工作场景）。
 */
export function groupByDayFlat(rows: HistoryRow[]): DayGroup[] {
  const days = new Map<string, { ts: number; rows: HistoryRow[] }>();
  for (const r of rows) {
    const k = dayKey(r.ts);
    let day = days.get(k);
    if (!day) {
      day = { ts: r.ts, rows: [] };
      days.set(k, day);
    }
    day.rows.push(r);
    if (r.ts > day.ts) day.ts = r.ts;
  }
  return Array.from(days.entries())
    .sort((a, b) => b[1].ts - a[1].ts)
    .map(([key, day]) => ({ key, ts: day.ts, rows: day.rows.sort((a, b) => a.ts - b.ts) }));
}

/** 按工作区 → 该项目的专属时间线（区内时间降序，最近在上） */
export function groupByWorkspace(rows: HistoryRow[]): WorkspaceGroup[] {
  const map = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    const list = map.get(r.workspace) ?? [];
    list.push(r);
    map.set(r.workspace, list);
  }
  return Array.from(map.entries())
    .map(([name, list]) => {
      const sorted = list.sort((a, b) => b.ts - a.ts);
      return { name, rows: sorted, lastTs: sorted[0]?.ts ?? 0 };
    })
    .sort((a, b) => b.lastTs - a.lastTs);
}

/** 合并 /poweri/api/session-summaries（用量）与 /api/sessions（元数据） */
export async function fetchHistoryRows(): Promise<HistoryRow[]> {
  const [sum, list] = await Promise.all([
    fetch("/poweri/api/session-summaries", { cache: "no-store" }).then((r) => r.json()),
    fetch("/api/sessions", { cache: "no-store" }).then((r) => r.json()),
  ]);
  const sums = new Map<string, { tokens: number; messages: number; input: number; cacheRead: number; cacheWrite: number; cost: number }>();
  for (const s of sum.sessions ?? []) {
    sums.set(s.sessionId, {
      tokens: s.tokens ?? 0,
      messages: s.messages ?? 0,
      input: s.input ?? 0,
      cacheRead: s.cacheRead ?? 0,
      cacheWrite: s.cacheWrite ?? 0,
      cost: s.cost ?? 0,
    });
  }
  const meta = new Map<string, { id: string; cwd: string; name?: string; created: string; firstMessage: string; messageCount: number }>(
    (list.sessions ?? []).map((x: { id: string; cwd: string; name?: string; created: string; firstMessage: string; messageCount: number }) => [x.id, x]),
  );
  const merged: HistoryRow[] = [];
  for (const [id, m] of meta) {
    const s = sums.get(id);
    merged.push({
      id,
      title: m.name || m.firstMessage || id,
      cwd: m.cwd ?? "",
      workspace: workspaceNameOf(m.cwd ?? ""),
      ts: m.created ? new Date(m.created).getTime() : 0,
      messages: s?.messages ?? m.messageCount ?? 0,
      tokens: s?.tokens ?? 0,
      input: s?.input ?? 0,
      cacheRead: s?.cacheRead ?? 0,
      cacheWrite: s?.cacheWrite ?? 0,
      cost: s?.cost ?? 0,
    });
  }
  return merged.sort((a, b) => b.ts - a.ts);
}
