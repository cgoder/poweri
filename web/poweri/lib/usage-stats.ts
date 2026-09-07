/**
 * PowerI 产品层：使用统计聚合（纯逻辑，SDK-free）。
 *
 * 从 ct-jyjntc fork 的 app/api/usage/route.ts 移植。route.ts 的 GET 处理器被拆成
 * 两部分：
 *   - 本文件：聚合纯逻辑（parseSessionFile / mergeSlices / buildAggregate /
 *     getAggregate / summarizeUsage）——不依赖 Next.js，可用 node 直接单测；
 *   - app/poweri/api/usage/route.ts：Next.js 薄包装（参数解析 + JSON 响应）。
 *
 * 性能设计（照搬 ct）：
 * - 会话列表 readdir + header-only 读 id（绝不整档解析）；
 * - 消息行流式逐行 + substring 字段提取（assistant 行携带巨大 thinking 块）；
 * - per-file size:mtime 签名缓存，只重解析变更文件；
 * - soft 45s / hard 15min 双层 TTL + 并发合并（__piUsagePromise）；
 * - 聚合签名未变时保留旧数据与 soft window，避免无意义重建。
 */
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { listSessionFiles, readSessionHeader } from "./session-files";

type DayBucket = {
  /** Local date YYYY-MM-DD */
  date: string;
  tokens: number;
  messages: number;
  /** modelId -> totalTokens */
  models: Record<string, number>;
  sessionIds: Set<string>;
  /** token 分项与费用（天级聚合，供分组头参考统计） */
  input: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
};

type FileDaySlice = {
  date: string;
  tokens: number;
  messages: number;
  models: Record<string, number>;
  sessionId: string;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
};

type FileCacheEntry = {
  sig: string;
  days: FileDaySlice[];
};

type UsageAggregate = {
  days: Map<string, DayBucket>;
  builtAt: number;
};

/** Serve last aggregate without re-stat (typical "open Usage again" path). */
const SOFT_TTL_MS = 45_000;
/** After soft TTL, re-stat; reuse per-file parses when size/mtime unchanged. */
const HARD_TTL_MS = 15 * 60 * 1000;
export const USAGE_HEATMAP_DAYS = 26 * 7;
export const MAX_RANGE_DAYS = 366;

declare global {
  var __piUsageCache: { signature: string; at: number; data: UsageAggregate } | undefined;
  var __piUsagePromise: Promise<UsageAggregate> | undefined;
  var __piUsageFileCache: Map<string, FileCacheEntry> | undefined;
}

function fileCache(): Map<string, FileCacheEntry> {
  if (!globalThis.__piUsageFileCache) globalThis.__piUsageFileCache = new Map();
  return globalThis.__piUsageFileCache;
}

export function dateKey(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function shiftKey(key: string, deltaDays: number): string {
  return dateKey(new Date(`${key}T12:00:00`).getTime() + deltaDays * 86_400_000);
}

/** Extract a "key":"value" string field starting the search at `from`. */
export function sliceStringField(line: string, field: string, from: number): string | null {
  const idx = line.indexOf(`"${field}":"`, from);
  if (idx === -1) return null;
  const start = idx + field.length + 4;
  const end = line.indexOf('"', start);
  return end === -1 ? null : line.slice(start, end);
}

/** Extract a "key":number field starting the search at `from`. */
export function sliceNumberField(line: string, field: string, from: number): number {
  const idx = line.indexOf(`"${field}":`, from);
  if (idx === -1) return 0;
  const start = idx + field.length + 3;
  let end = start;
  while (end < line.length && /[\d.]/.test(line[end])) end++;
  const n = Number(line.slice(start, end));
  return Number.isFinite(n) ? n : 0;
}

export async function parseSessionFile(filePath: string, sessionId: string): Promise<FileDaySlice[]> {
  const byDate = new Map<string, FileDaySlice>();
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.startsWith('{"type":"message"')) continue;
    const tsRaw = sliceStringField(line, "timestamp", 0);
    if (!tsRaw) continue;
    const ts = Date.parse(tsRaw);
    if (!Number.isFinite(ts)) continue;

    const roleStart = line.indexOf('"role":"');
    if (roleStart === -1) continue;
    const roleEnd = line.indexOf('"', roleStart + 8);
    const role = line.slice(roleStart + 8, roleEnd);
    if (role !== "user" && role !== "assistant") continue;

    const key = dateKey(ts);
    let bucket = byDate.get(key);
    if (!bucket) {
      bucket = { date: key, tokens: 0, messages: 0, models: {}, sessionId, input: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
      byDate.set(key, bucket);
    }
    bucket.messages++;

    if (role !== "assistant") continue;
    const usageIdx = line.indexOf('"usage":{');
    if (usageIdx === -1) continue;
    const tokens = sliceNumberField(line, "totalTokens", usageIdx);
    bucket.input += sliceNumberField(line, "input", usageIdx);
    bucket.cacheRead += sliceNumberField(line, "cacheRead", usageIdx);
    bucket.cacheWrite += sliceNumberField(line, "cacheWrite", usageIdx);
    // cost 是嵌套对象 {"input":N,"output":N,"cacheRead":N,"cacheWrite":N,"total":N}
    const costIdx = line.indexOf('"cost":{', usageIdx);
    if (costIdx !== -1) bucket.cost += sliceNumberField(line, "total", costIdx);
    if (tokens <= 0) continue;
    // Message-level "model" sits just before "usage"; last match before usageIdx wins.
    const modelIdx = line.lastIndexOf('"model":"', usageIdx);
    let model = "unknown";
    if (modelIdx !== -1) {
      const start = modelIdx + 9;
      const end = line.indexOf('"', start);
      if (end !== -1) model = line.slice(start, end) || "unknown";
    }
    bucket.tokens += tokens;
    bucket.models[model] = (bucket.models[model] ?? 0) + tokens;
  }
  return [...byDate.values()];
}

export function mergeSlices(slices: Iterable<FileDaySlice[]>): Map<string, DayBucket> {
  const days = new Map<string, DayBucket>();
  for (const fileDays of slices) {
    for (const slice of fileDays) {
      let bucket = days.get(slice.date);
      if (!bucket) {
        bucket = {
          date: slice.date,
          tokens: 0,
          messages: 0,
          models: {},
          sessionIds: new Set(),
          input: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0,
        };
        days.set(slice.date, bucket);
      }
      bucket.tokens += slice.tokens;
      bucket.messages += slice.messages;
      // ?? 0：容忍旧版文件缓存（字段缺失）与新增字段并存
      bucket.input += slice.input ?? 0;
      bucket.cacheRead += slice.cacheRead ?? 0;
      bucket.cacheWrite += slice.cacheWrite ?? 0;
      bucket.cost += slice.cost ?? 0;
      bucket.sessionIds.add(slice.sessionId);
      for (const [model, v] of Object.entries(slice.models)) {
        bucket.models[model] = (bucket.models[model] ?? 0) + v;
      }
    }
  }
  return days;
}

/** Session id from the archive's header line, or undefined when unreadable. */
function readSessionId(filePath: string): string | undefined {
  try {
    return readSessionHeader(filePath)?.id;
  } catch {
    return undefined;
  }
}

async function buildAggregate(): Promise<{ data: UsageAggregate; signature: string }> {
  // Path-sorted so the aggregate signature is stable across readdir orderings.
  const files = (await listSessionFiles()).sort((a, b) => a.path.localeCompare(b.path));
  const cache = fileCache();
  const livePaths = new Set<string>();
  const sigParts: string[] = [];
  const queue: Array<{ path: string; id: string; sig: string }> = [];

  for (const file of files) {
    // The session id sits in the header line; parsing every archive end-to-end
    // (~180ms / 68MB locally) just to hand back path + id is too expensive.
    const id = readSessionId(file.path);
    // Headerless archives are skipped by SessionManager.listAll() as well.
    if (!id) continue;
    livePaths.add(file.path);
    const sig = `${file.path}:${file.size}:${Math.round(file.mtimeMs)}`;
    sigParts.push(sig);
    queue.push({ path: file.path, id, sig });
  }

  // Drop entries for sessions that no longer exist.
  for (const key of cache.keys()) {
    if (!livePaths.has(key)) cache.delete(key);
  }

  // Only re-parse files whose size/mtime signature changed.
  const dirty = queue.filter((s) => cache.get(s.path)?.sig !== s.sig);
  const workers = Array.from({ length: 8 }, async () => {
    for (;;) {
      const item = dirty.shift();
      if (!item) return;
      try {
        const days = await parseSessionFile(item.path, item.id);
        cache.set(item.path, { sig: item.sig, days });
      } catch {
        cache.delete(item.path);
      }
    }
  });
  await Promise.all(workers);

  const slices: FileDaySlice[][] = [];
  for (const s of queue) {
    const hit = cache.get(s.path);
    if (hit) slices.push(hit.days);
  }

  return {
    signature: sigParts.join("|"),
    data: { days: mergeSlices(slices), builtAt: Date.now() },
  };
}

export async function getAggregate(forceRefresh: boolean): Promise<UsageAggregate> {
  const cache = globalThis.__piUsageCache;
  const now = Date.now();

  // Soft path: instant return while the user re-opens Usage within SOFT_TTL.
  if (!forceRefresh && cache && now - cache.at < SOFT_TTL_MS) {
    return cache.data;
  }

  // Hard path still valid and signature-checked only after soft TTL.
  if (!forceRefresh && cache && now - cache.at < HARD_TTL_MS) {
    // Fall through to the rebuild check below — but coalesce concurrent rebuilds.
  }

  if (!forceRefresh && globalThis.__piUsagePromise) return globalThis.__piUsagePromise;

  const promise = buildAggregate()
    .then(({ data, signature }) => {
      // If nothing changed and we already have data, keep previous builtAt soft window.
      const prev = globalThis.__piUsageCache;
      if (prev && prev.signature === signature && !forceRefresh) {
        globalThis.__piUsageCache = { signature, at: Date.now(), data: prev.data };
        return prev.data;
      }
      globalThis.__piUsageCache = { signature, at: Date.now(), data };
      return data;
    })
    .finally(() => {
      globalThis.__piUsagePromise = undefined;
    });
  globalThis.__piUsagePromise = promise;
  return promise;
}

export type UsageSummary = {
  range: { days: number; startDate: string };
  totals: { tokens: number; sessions: number; messages: number; activeDays: number };
  streak: number;
  topModel: { id: string; tokens: number; share: number } | null;
  models: Array<{ id: string; tokens: number; share: number }>;
  trend: Array<{ date: string; tokens: number; models: Record<string, number> }>;
  heatmap: Array<{ date: string; messages: number }>;
};

/**
 * Shape the response payload for a given range (days). Pure — no I/O, no cache,
 * so it is directly unit-testable against a synthetic aggregate.
 */
export function summarizeUsage(agg: UsageAggregate, rangeDays: number, now = Date.now()): UsageSummary {
  const today = dateKey(now);
  const startDate = shiftKey(today, -(rangeDays - 1));

  let tokens = 0;
  let messages = 0;
  let activeDays = 0;
  const rangeSessionIds = new Set<string>();
  const modelTotals = new Map<string, number>();

  for (const bucket of agg.days.values()) {
    if (bucket.date < startDate || bucket.date > today) continue;
    tokens += bucket.tokens;
    messages += bucket.messages;
    if (bucket.messages > 0) activeDays++;
    for (const id of bucket.sessionIds) rangeSessionIds.add(id);
    for (const [model, v] of Object.entries(bucket.models)) {
      modelTotals.set(model, (modelTotals.get(model) ?? 0) + v);
    }
  }

  const models = [...modelTotals.entries()]
    .map(([id, v]) => ({ id, tokens: v, share: tokens > 0 ? v / tokens : 0 }))
    .sort((a, b) => b.tokens - a.tokens);
  const topModel = models[0] ?? null;

  // Zero-filled daily trend for the selected range.
  const trend: Array<{ date: string; tokens: number; models: Record<string, number> }> = [];
  for (let i = 0; i < rangeDays; i++) {
    const date = shiftKey(startDate, i);
    const bucket = agg.days.get(date);
    trend.push({
      date,
      tokens: bucket?.tokens ?? 0,
      models: bucket ? { ...bucket.models } : {},
    });
  }

  // Heatmap: fixed trailing window, independent of the selected range.
  const heatmapStart = shiftKey(today, -(USAGE_HEATMAP_DAYS - 1));
  const heatmap: Array<{ date: string; messages: number }> = [];
  for (let i = 0; i < USAGE_HEATMAP_DAYS; i++) {
    const date = shiftKey(heatmapStart, i);
    heatmap.push({ date, messages: agg.days.get(date)?.messages ?? 0 });
  }

  // Current streak of consecutive active days (today counts; otherwise
  // start from yesterday so a today-not-yet-active run still shows).
  const isActive = (key: string) => (agg.days.get(key)?.messages ?? 0) > 0;
  let cursor = isActive(today) ? today : shiftKey(today, -1);
  let streak = 0;
  while (isActive(cursor)) {
    streak++;
    cursor = shiftKey(cursor, -1);
  }

  return {
    range: { days: rangeDays, startDate },
    totals: { tokens, sessions: rangeSessionIds.size, messages, activeDays },
    streak,
    topModel,
    models,
    trend,
    heatmap,
  };
}

export type SessionSummary = {
  sessionId: string;
  messages: number;
  tokens: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
};

export type GatewayUsageRecord = {
  ts?: number;
  sessionId?: string;
  usage?: Record<string, number | undefined> | null;
};

function usageNumber(usage: GatewayUsageRecord["usage"], key: string): number {
  const value = Number(usage?.[key]);
  return Number.isFinite(value) ? value : 0;
}

function gatewayRecordTokens(record: GatewayUsageRecord): number {
  const total = usageNumber(record.usage, "totalTokens");
  if (total > 0) return total;
  return ["input", "output", "cacheRead", "cacheWrite", "reasoning"]
    .reduce((sum, key) => sum + usageNumber(record.usage, key), 0);
}

/** 将 Gateway 按用户隔离后的计量记录转换为与本地会话相同的使用统计视图。 */
export function summarizeGatewayUsage(records: GatewayUsageRecord[], rangeDays: number, now = Date.now()): UsageSummary {
  const days = new Map<string, DayBucket>();
  for (const record of records) {
    const ts = Number(record.ts);
    if (!Number.isFinite(ts)) continue;
    const date = dateKey(ts);
    const bucket = days.get(date) ?? {
      date,
      tokens: 0,
      messages: 0,
      models: {},
      sessionIds: new Set<string>(),
      input: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
    };
    const tokens = gatewayRecordTokens(record);
    bucket.tokens += tokens;
    // Gateway 计量是一条请求一条记录；这与产品层的“用户消息/回合”口径一致。
    bucket.messages++;
    if (record.sessionId) bucket.sessionIds.add(record.sessionId);
    bucket.input += usageNumber(record.usage, "input");
    bucket.cacheRead += usageNumber(record.usage, "cacheRead");
    bucket.cacheWrite += usageNumber(record.usage, "cacheWrite");
    bucket.models["poweri-gw/agent"] = (bucket.models["poweri-gw/agent"] ?? 0) + tokens;
    days.set(date, bucket);
  }
  return summarizeUsage({ days, builtAt: now }, rangeDays, now);
}

/** Gateway 计量记录 → 历史会话列表所需的 per-session 汇总。 */
export function summarizeGatewayBySession(records: GatewayUsageRecord[]): SessionSummary[] {
  const byId = new Map<string, SessionSummary>();
  for (const record of records) {
    if (!record.sessionId) continue;
    const usage = record.usage;
    const current = byId.get(record.sessionId) ?? {
      sessionId: record.sessionId,
      messages: 0,
      tokens: 0,
      input: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
    };
    current.messages++;
    current.tokens += gatewayRecordTokens(record);
    current.input += usageNumber(usage, "input");
    current.cacheRead += usageNumber(usage, "cacheRead");
    current.cacheWrite += usageNumber(usage, "cacheWrite");
    byId.set(record.sessionId, current);
  }
  return [...byId.values()].sort((a, b) => b.tokens - a.tokens);
}

/**
 * Per-session totals for the "历史会话" list view (F6): reuses the same
 * size:mtime file cache as the aggregate (so this is near-free after a
 * usage fetch) and merges the per-day slices back by session id.
 * Pure aggregation on top of getAggregate()'s cache — no extra I/O.
 */
export async function summarizeBySession(): Promise<SessionSummary[]> {
  // Ensure the file cache is fresh (soft TTL path returns immediately).
  await getAggregate(false);
  const cache = fileCache();
  const byId = new Map<string, { sessionId: string; messages: number; tokens: number; input: number; cacheRead: number; cacheWrite: number; cost: number }>();
  for (const [, entry] of cache) {
    for (const slice of entry.days) {
      const cur = byId.get(slice.sessionId) ?? { sessionId: slice.sessionId, messages: 0, tokens: 0, input: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
      cur.messages += slice.messages;
      cur.tokens += slice.tokens;
      cur.input += slice.input ?? 0;
      cur.cacheRead += slice.cacheRead ?? 0;
      cur.cacheWrite += slice.cacheWrite ?? 0;
      cur.cost += slice.cost ?? 0;
      byId.set(slice.sessionId, cur);
    }
  }
  return [...byId.values()].sort((a, b) => b.tokens - a.tokens);
}
