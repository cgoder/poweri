"use client";

/**
 * PowerI 产品层：使用统计面板（活动栏「统计」面板内容，本次不接入口）。
 *
 * 从 ct-jyjntc fork 的 components/UsagePanel.tsx 移植 + 适配：
 * - useLocale() → 面板内自带中文文案常量（目标仓库无 useLocale，不动基础层）；
 * - SettingsGroup/SettingsPageHeading/SettingsRow → 简单 div + poweri 自有 CSS
 *   （目标仓库无 settings-ui）；
 * - apiFetch（lib/api-transport）→ 原生 fetch("/poweri/api/usage?days=N",
 *   { cache: "no-store" })，stale-while-revalidate 逻辑照搬；
 * - 6 张 StatCard + SVG 环形图采用 ct 仓库 e30bc0d 版本（对应工单 11 拍板的
 *   「顶部聚合卡 + 模型占比」形态；lucide 图标去掉，不新增依赖）。
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useI18n } from "@/hooks/useI18n";
import type { Locale } from "@/lib/i18n/types";
import "../styles/usage-panel.css";

type UsageData = {
  generatedAt: string;
  range: { days: number; startDate: string };
  totals: {
    tokens: number;
    sessions: number;
    messages: number;
    activeDays: number;
  };
  streak: number;
  topModel: { id: string; tokens: number; share: number } | null;
  models: Array<{ id: string; tokens: number; share: number }>;
  trend: Array<{ date: string; tokens: number; models: Record<string, number> }>;
  heatmap: Array<{ date: string; messages: number }>;
};

function getUsageStrings(locale: Locale) {
  const isZh = locale.startsWith("zh");
  return {
    title: isZh ? "使用统计" : "Usage Stats",
    range7: isZh ? "最近 7 天" : "Last 7 Days",
    range30: isZh ? "最近 30 天" : "Last 30 Days",
    refresh: isZh ? "刷新" : "Refresh",
    loading: isZh ? "加载中…" : "Loading...",
    tokens: isZh ? "Tokens 用量" : "Token Usage",
    tokensShort: "Tokens",
    sessions: isZh ? "会话数量" : "Sessions",
    messages: isZh ? "消息数量" : "Messages",
    activeDays: isZh ? "活跃天数" : "Active Days",
    streak: isZh ? "当前连续天数" : "Current Streak",
    topModel: isZh ? "最常用模型" : "Top Model",
    shareOfTokens: (pct: number) => isZh ? `占比 ${pct}%` : `${pct}% of tokens`,
    heatmap: isZh ? "活跃热力图" : "Activity Heatmap",
    less: isZh ? "较少" : "Less",
    more: isZh ? "较多" : "More",
    trend: isZh ? "按天 Token 趋势" : "Daily Token Trend",
    modelUsage: isZh ? "模型用量" : "Model Breakdown",
    other: isZh ? "其他" : "Other",
    empty: isZh ? "暂无使用数据" : "No usage data available",
    messagesCount: (n: number) => isZh ? `${n} 条消息` : `${n} messages`,
    loadError: isZh ? "加载使用统计失败" : "Failed to load usage stats",
  };
}

/** Monochrome series ramp (strongest first) — charts stay on the accent token. */
const SERIES_COLORS = [
  "var(--accent)",
  "color-mix(in oklab, var(--accent) 64%, var(--bg))",
  "color-mix(in oklab, var(--accent) 44%, var(--bg))",
  "color-mix(in oklab, var(--accent) 28%, var(--bg))",
  "color-mix(in oklab, var(--accent) 17%, var(--bg))",
  "color-mix(in oklab, var(--accent) 10%, var(--bg))",
];
const HEAT_LEVELS = [
  "var(--bg-subtle)",
  "color-mix(in oklab, var(--accent) 18%, var(--bg))",
  "color-mix(in oklab, var(--accent) 36%, var(--bg))",
  "color-mix(in oklab, var(--accent) 58%, var(--bg))",
  "color-mix(in oklab, var(--accent) 85%, var(--bg))",
];
const TOP_SERIES = 5;
/** Bar track height — must match `.usage-trend-bars` height in usage-panel.css. */
const TREND_TRACK_PX = 120;
/** Per-segment floor so tiny series stay visible; reserved per series so the
 *  stacked minimums of the tallest day can never exceed the track. */
const TREND_MIN_SEG_PX = 2;

function fmtTokens(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return String(n);
}

function fmtDayLabel(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}月${d}日`;
}

function seriesColor(i: number): string {
  return SERIES_COLORS[Math.min(i, SERIES_COLORS.length - 1)];
}

function fmtShare(share: number): string {
  if (share > 0 && share < 0.095) return `${(share * 100).toFixed(1)}%`;
  return `${Math.round(share * 100)}%`;
}

/** Module-level SWR cache so remounting the panel (leaving & re-entering) is instant. */
const usageClientCache = new Map<number, { data: UsageData; at: number }>();
const USAGE_CLIENT_TTL_MS = 5 * 60 * 1000;
const usageListeners = new Set<() => void>();

async function fetchUsage(rangeDays: number, forceRefresh: boolean): Promise<UsageData> {
  const res = await fetch(
    `/poweri/api/usage?days=${rangeDays}${forceRefresh ? "&refresh=1" : ""}`,
    { cache: "no-store" },
  );
  const json = await res.json() as UsageData & { error?: string };
  if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

/** 预热聚合（未来入口接线用：进入活动栏前后台拉一次，配合 API soft TTL 秒开）。 */
export function prefetchUsage(days: number = 30): void {
  const hit = usageClientCache.get(days);
  if (hit && Date.now() - hit.at < USAGE_CLIENT_TTL_MS) return;
  void fetchUsage(days, false)
    .then((json) => {
      usageClientCache.set(days, { data: json, at: Date.now() });
    })
    .catch(() => {});
}

/** 失效客户端缓存并强制刷新（agent_end 后 debounce 调用，本次入口后置）。 */
export function invalidateUsage(): void {
  usageClientCache.clear();
  if (usageListeners.size === 0) {
    void fetchUsage(30, true)
      .then((json) => {
        usageClientCache.set(30, { data: json, at: Date.now() });
      })
      .catch(() => {});
    return;
  }
  for (const listener of usageListeners) listener();
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const valueRef = useRef<HTMLSpanElement | null>(null);

  // Long values (e.g. model ids) must stay on one line: shrink the font to fit
  // the card instead of wrapping — stat cards are always two rows.
  useLayoutEffect(() => {
    const el = valueRef.current;
    if (!el) return;
    el.style.fontSize = "";
    if (el.scrollWidth <= el.clientWidth + 1) return;
    const fitted = Math.max((el.clientWidth / el.scrollWidth) * 18, 11);
    el.style.fontSize = `${fitted}px`;
  }, [value]);

  return (
    <div className="usage-stat-card">
      <span className="usage-stat-label">
        {label}
        {sub && <span className="usage-stat-sub-inline">{sub}</span>}
      </span>
      <span ref={valueRef} className="usage-stat-value" title={value}>{value}</span>
    </div>
  );
}

export function UsagePanel() {
  const { locale } = useI18n();
  const text = useMemo(() => getUsageStrings(locale), [locale]);
  const [days, setDays] = useState<7 | 30>(30);
  const [data, setData] = useState<UsageData | null>(() => usageClientCache.get(30)?.data ?? null);
  const [loading, setLoading] = useState(() => !usageClientCache.has(30));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (rangeDays: number, forceRefresh: boolean) => {
    const cached = usageClientCache.get(rangeDays);
    const hasFreshCache = cached && Date.now() - cached.at < USAGE_CLIENT_TTL_MS;

    // Stale-while-revalidate: never blank the panel if we already have something to show.
    if (forceRefresh) {
      setRefreshing(true);
    } else if (cached) {
      setData(cached.data);
      // Soft TTL hit → no spinner; stale → quiet background refresh.
      if (!hasFreshCache) setRefreshing(true);
    } else if (!data) {
      setLoading(true);
    } else {
      // Switching range without a cache entry — keep prior chart, mark refreshing.
      setRefreshing(true);
    }
    setError(null);

    // Skip network when we just loaded this range (soft client TTL), unless forced.
    if (!forceRefresh && hasFreshCache) {
      setLoading(false);
      setRefreshing(false);
      // Warm the other common range in the background.
      const other = rangeDays === 30 ? 7 : 30;
      if (!usageClientCache.has(other)) prefetchUsage(other);
      return;
    }

    try {
      const json = await fetchUsage(rangeDays, forceRefresh);
      usageClientCache.set(rangeDays, { data: json, at: Date.now() });
      setData(json);
    } catch (e) {
      // Keep last good data on background refresh failure.
      if (!cached) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // `data` 有意通过稳定闭包读取（ct 原版同款）：load 保持稳定引用，避免 setData
    // 后 effect 重跑成取数循环。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load(days, false);
  }, [days, load]);

  useEffect(() => {
    const onInvalidate = () => {
      void load(days, true);
    };
    usageListeners.add(onInvalidate);
    return () => {
      usageListeners.delete(onInvalidate);
    };
  }, [days, load]);

  // Top-N series + "other" bucket for stacked charts.
  const series = useMemo(() => {
    if (!data) return [] as string[];
    const ids = data.models.slice(0, TOP_SERIES).map((m) => m.id);
    if (data.models.length > TOP_SERIES) ids.push("__other__");
    return ids;
  }, [data]);

  const dayModels = useCallback((day: UsageData["trend"][number]) => {
    const out: Record<string, number> = {};
    let other = 0;
    for (const [id, v] of Object.entries(day.models)) {
      if (series.includes(id)) out[id] = v;
      else other += v;
    }
    if (other > 0) out.__other__ = other;
    return out;
  }, [series]);

  const donutSegments = useMemo(() => {
    if (!data) return [] as Array<{ id: string; tokens: number; share: number }>;
    const top = data.models.slice(0, TOP_SERIES);
    const rest = data.models.slice(TOP_SERIES);
    if (rest.length > 0) {
      const tokens = rest.reduce((s, m) => s + m.tokens, 0);
      top.push({ id: "__other__", tokens, share: data.totals.tokens > 0 ? tokens / data.totals.tokens : 0 });
    }
    return top;
  }, [data]);

  const heatWeeks = useMemo(() => {
    if (!data) return [] as Array<Array<{ date: string; messages: number } | null>>;
    const daysList = data.heatmap;
    const first = daysList[0];
    if (!first) return [];
    const lead = new Date(`${first.date}T12:00:00`).getDay(); // Sunday-first columns
    const cells: Array<{ date: string; messages: number } | null> = [
      ...Array.from({ length: lead }, () => null),
      ...daysList,
    ];
    const weeks: Array<Array<{ date: string; messages: number } | null>> = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }, [data]);

  const heatMax = useMemo(
    () => Math.max(1, ...(data?.heatmap.map((d) => d.messages) ?? [1])),
    [data],
  );

  const heatLevel = (n: number) => (n <= 0 ? 0 : Math.min(4, Math.ceil((n / heatMax) * 4)));

  const trendMax = useMemo(
    () => Math.max(1, ...(data?.trend.map((d) => d.tokens) ?? [1])),
    [data],
  );
  const trendUsablePx = TREND_TRACK_PX - TREND_MIN_SEG_PX * Math.max(1, series.length);

  const modelLabel = (id: string) => (id === "__other__" ? text.other : id);

  return (
    <div className="poweri-usage">
      <div className="usage-header">
        <div className="usage-header-title">
          <div className="poweri-usage-title">{text.title}</div>
          {refreshing && data && (
            <span className="usage-header-status">{text.loading}</span>
          )}
        </div>
        <div className="usage-header-actions">
          <div className="poweri-segmented">
            {([7, 30] as const).map((d) => (
              <button
                key={d}
                type="button"
                className={days === d ? "is-active" : ""}
                aria-pressed={days === d}
                disabled={loading && !data}
                onClick={() => setDays(d)}
              >
                {d === 7 ? text.range7 : text.range30}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="poweri-refresh-btn"
            disabled={refreshing || (loading && !data)}
            onClick={() => void load(days, true)}
            title={text.refresh}
          >
            {text.refresh}
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="usage-state">
          <div className="usage-state-text">{text.loading}</div>
        </div>
      ) : error && !data ? (
        <div className="usage-state">
          <div className="usage-state-text is-error">
            {text.loadError}: {error}
          </div>
          <button type="button" className="poweri-refresh-btn" onClick={() => void load(days, false)}>
            {text.refresh}
          </button>
        </div>
      ) : !data || (data.totals.messages === 0 && data.heatmap.every((d) => d.messages === 0)) ? (
        <div className="usage-state">
          <div className="usage-state-text">{text.empty}</div>
        </div>
      ) : (
        <>
          <div className="usage-stat-grid">
            <StatCard
              label={text.tokens}
              value={fmtTokens(data.totals.tokens)}
            />
            <StatCard
              label={text.sessions}
              value={data.totals.sessions.toLocaleString()}
            />
            <StatCard
              label={text.messages}
              value={data.totals.messages.toLocaleString()}
            />
            <StatCard
              label={text.activeDays}
              value={String(data.totals.activeDays)}
            />
            <StatCard
              label={text.streak}
              value={String(data.streak)}
            />
            <StatCard
              label={text.topModel}
              value={data.topModel?.id ?? "—"}
              sub={data.topModel ? text.shareOfTokens(Math.round(data.topModel.share * 100)) : undefined}
            />
          </div>

          <div className="poweri-usage-section">
            <div className="poweri-usage-section-title">{text.heatmap}</div>
            <div className="usage-card-body">
              <div className="usage-heatmap-scroll">
                <div className="usage-heatmap">
                  {heatWeeks.map((week, wi) => (
                    <div key={wi} className="usage-heatmap-week">
                      {week.map((cell, di) => (
                        <div
                          key={cell?.date ?? `blank-${wi}-${di}`}
                          className={`usage-heatmap-cell${cell ? "" : " is-empty"}`}
                          title={cell ? `${cell.date} · ${text.messagesCount(cell.messages)}` : undefined}
                          style={cell ? { background: HEAT_LEVELS[heatLevel(cell.messages)] } : undefined}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div className="usage-heatmap-legend">
                <span>{text.less}</span>
                {HEAT_LEVELS.map((c) => (
                  <span key={c} className="usage-heatmap-legend-swatch" style={{ background: c }} />
                ))}
                <span>{text.more}</span>
              </div>
            </div>
          </div>

          <div className="poweri-usage-section">
            <div className="poweri-usage-section-title">{text.trend}</div>
            <div className="usage-card-body">
              <div className="usage-trend-chart">
                <div className={`usage-trend-bars${days === 7 ? " is-week" : ""}`}>
                  {data.trend.map((day) => {
                    const dm = dayModels(day);
                    const painted = series
                      .map((id, i) => ({ id, i, v: dm[id] ?? 0 }))
                      .filter((s) => s.v > 0);
                    return (
                      <div
                        key={day.date}
                        className="usage-trend-col"
                        title={`${day.date} · ${fmtTokens(day.tokens)} ${text.tokens}`}
                      >
                        <div className="usage-trend-bar">
                          {painted.map((s) => (
                            <div
                              key={s.id}
                              className="usage-trend-seg"
                              style={{
                                height: Math.max(TREND_MIN_SEG_PX, (s.v / trendMax) * trendUsablePx),
                                background: seriesColor(s.i),
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className={`usage-trend-labels${days === 7 ? " is-week" : ""}`}>
                {data.trend.map((day, i) => {
                  const step = Math.ceil(data.trend.length / 6);
                  const show = i % step === 0 || i === data.trend.length - 1;
                  return (
                    <div key={day.date} className="usage-trend-label">
                      {show ? fmtDayLabel(day.date) : ""}
                    </div>
                  );
                })}
              </div>
              <div className="usage-series-legend">
                {series.map((id, i) => (
                  <span key={id} className="usage-series-item">
                    <span className="usage-series-dot" style={{ background: seriesColor(i) }} />
                    <span className="usage-series-name">{modelLabel(id)}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="poweri-usage-section">
            <div className="poweri-usage-section-title">{text.modelUsage}</div>
            <div className="usage-card-body">
              <div className="usage-model-split">
                <svg
                  className="usage-donut"
                  width="128"
                  height="128"
                  viewBox="0 0 128 128"
                  role="img"
                  aria-label={text.modelUsage}
                >
                  <circle cx="64" cy="64" r="50" fill="none" style={{ stroke: "var(--bg-subtle)" }} strokeWidth="16" />
                  {(() => {
                    const C = 2 * Math.PI * 50;
                    let acc = 0;
                    return donutSegments.map((m, i) => {
                      const frac = data.totals.tokens > 0 ? m.tokens / data.totals.tokens : 0;
                      if (frac <= 0) return null;
                      const dash = frac * C;
                      const offset = -acc * C;
                      acc += frac;
                      return (
                        <circle
                          key={m.id}
                          cx="64"
                          cy="64"
                          r="50"
                          fill="none"
                          style={{ stroke: seriesColor(i) }}
                          strokeWidth="16"
                          strokeDasharray={`${dash} ${C - dash}`}
                          strokeDashoffset={offset}
                          transform="rotate(-90 64 64)"
                        />
                      );
                    });
                  })()}
                  <text
                    x="64"
                    y="60"
                    textAnchor="middle"
                    style={{ fill: "var(--text)", fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
                  >
                    {fmtTokens(data.totals.tokens)}
                  </text>
                  <text x="64" y="76" textAnchor="middle" style={{ fill: "var(--text-dim)", fontSize: 10 }}>
                    {text.tokensShort}
                  </text>
                </svg>
                <div className="usage-model-list">
                  {donutSegments.map((m, i) => (
                    <div key={m.id} className="usage-model-row">
                      <span className="usage-series-dot" style={{ background: seriesColor(i) }} />
                      <span className="usage-model-name" title={modelLabel(m.id)}>{modelLabel(m.id)}</span>
                      <span className="usage-model-tokens">
                        {fmtTokens(m.tokens)}
                      </span>
                      <span className="usage-model-share">{fmtShare(m.share)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
