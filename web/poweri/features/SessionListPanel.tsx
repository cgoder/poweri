"use client";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  fetchHistoryRows, groupByDayFlat, groupByWorkspace,
  dayLabel, fmtClock, fmtClockFull, fmtTokens, fmtCount, fmtCost,
  groupTokens, groupCost, groupCacheHitRate, fullTime,
  type GroupMode, type HistoryRow,
} from "@/poweri/lib/session-groups";
import { tp } from "@/poweri/lib/i18n";

/**
 * PowerI 历史会话面板（F6）：面向人的时间线形态（2026-08-20 定稿）。
 * - 按天模式（默认）：天内严格时间升序（工作路径），项目 chip 标识，
 *   天头聚合 tokens/费用/缓存命中率
 * - 按工作区模式：该项目的专属时间线（区内时间降序，跨天带日期）
 * - 行点击：行本身不变，详情在行下方全宽展开（SessionStatsView 圆环）
 * 数据源：/poweri/api/session-summaries + /api/sessions（一次性拉取）
 *        /poweri/api/session-stats/[id]（行展开时按需）
 */

type SessionStats = {
  ok: boolean;
  stats?: {
    sessionName?: string;
    sessionFile?: string;
    sessionId: string;
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    toolResults: number;
    totalMessages: number;
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    cost: number;
    contextUsage?: { percent: number | null; contextWindow: number };
    totalActiveMs?: number;
  };
  error?: string;
};

function fmtDuration(ms: number): string {
  if (!ms || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function fmtNum(n: number | undefined): string {
  return (n ?? 0).toLocaleString("zh-CN");
}

function fmtCompact(n: number | undefined): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function StatRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="poweri-stats-row">
      <span className="poweri-stats-label">{label}</span>
      <span className={mono ? "poweri-stats-value" : "poweri-stats-value poweri-stats-value-plain"}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="poweri-stats-sec">
      <div className="poweri-stats-title">{title}</div>
      {children}
    </div>
  );
}

const DONUT_COLORS = ["#4f9cf9", "#9c6ef9", "#f9a84f", "#4fd1a0", "#e06c75", "#5ac8fa"];

function Donut({
  segments,
  centerValue,
  centerLabel,
}: {
  segments: Array<{ label: string; value: number }>;
  centerValue: string;
  centerLabel: string;
}) {
  const total = Math.max(1, segments.reduce((s, x) => s + x.value, 0));
  const C = 2 * Math.PI * 36;
  let acc = 0;
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={centerLabel}>
      <circle cx="48" cy="48" r="36" fill="none" style={{ stroke: "var(--bg-subtle)" }} strokeWidth="13" />
      {segments.map((seg, i) => {
        const frac = seg.value / total;
        if (frac <= 0) return null;
        const dash = frac * C;
        const offset = -acc * C;
        acc += frac;
        return (
          <circle
            key={seg.label}
            cx="48"
            cy="48"
            r="36"
            fill="none"
            style={{ stroke: DONUT_COLORS[i % DONUT_COLORS.length] }}
            strokeWidth="13"
            strokeDasharray={`${dash} ${C - dash}`}
            strokeDashoffset={offset}
            transform="rotate(-90 48 48)"
          />
        );
      })}
      <text x="48" y="46" textAnchor="middle" style={{ fill: "var(--text)", fontSize: 12, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
        {centerValue}
      </text>
      <text x="48" y="60" textAnchor="middle" style={{ fill: "var(--text-dim)", fontSize: 9 }}>
        {centerLabel}
      </text>
    </svg>
  );
}

function DonutList({ items }: { items: Array<{ label: string; value: string; share: number }> }) {
  return (
    <div className="poweri-donut-list">
      {items.map((it, i) => (
        <div key={it.label} className="poweri-donut-row">
          <span className="poweri-donut-dot" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
          <span className="poweri-donut-label">{it.label}</span>
          <span className="poweri-donut-value">{it.value}</span>
          <span className="poweri-donut-share">{it.share > 0 ? `${it.share.toFixed(1)}%` : ""}</span>
        </div>
      ))}
    </div>
  );
}

function SessionDetail({ stats }: { stats: NonNullable<SessionStats["stats"]> }) {
  const { locale } = useI18n();
  const statsInfo = stats;
  const contextUsage = statsInfo.contextUsage;
  const hitDenom = (statsInfo.tokens?.cacheRead ?? 0) + (statsInfo.tokens?.cacheWrite ?? 0) + (statsInfo.tokens?.input ?? 0);
  const cacheHitRate =
    (statsInfo.tokens?.cacheRead ?? 0) + (statsInfo.tokens?.cacheWrite ?? 0) > 0 && hitDenom > 0
      ? ((statsInfo.tokens!.cacheRead / hitDenom) * 100).toFixed(1)
      : null;
  const messageTotal = Math.max(1, (statsInfo.userMessages ?? 0) + (statsInfo.assistantMessages ?? 0) + (statsInfo.toolCalls ?? 0) + (statsInfo.toolResults ?? 0));
  const tokenTotal = Math.max(1, (statsInfo.tokens?.input ?? 0) + (statsInfo.tokens?.output ?? 0) + (statsInfo.tokens?.cacheRead ?? 0) + (statsInfo.tokens?.cacheWrite ?? 0));
  const messageSegments = [
    { label: tp(locale, "stats.user"), value: statsInfo.userMessages },
    { label: tp(locale, "stats.assistant"), value: statsInfo.assistantMessages },
    { label: tp(locale, "stats.toolCalls"), value: statsInfo.toolCalls },
    { label: tp(locale, "stats.toolResults"), value: statsInfo.toolResults },
  ];
  const tokenSegments = [
    { label: tp(locale, "stats.input"), value: statsInfo.tokens?.input ?? 0 },
    { label: tp(locale, "stats.output"), value: statsInfo.tokens?.output ?? 0 },
    { label: tp(locale, "stats.cacheRead"), value: statsInfo.tokens?.cacheRead ?? 0 },
    { label: tp(locale, "stats.cacheWrite"), value: statsInfo.tokens?.cacheWrite ?? 0 },
  ];
  const messageLegendItems = messageSegments.map((item) => ({ ...item, value: fmtNum(item.value), share: (item.value / messageTotal) * 100 }));
  const tokenLegendItems = tokenSegments.map((item) => ({ ...item, value: fmtNum(item.value), share: (item.value / tokenTotal) * 100 }));

  return (
    <div className="poweri-stats-detail">
      <Section title={tp(locale, "stats.sessionInfo")}>
        {statsInfo.sessionName && <StatRow label={tp(locale, "stats.name")} value={statsInfo.sessionName} />}
        <StatRow label={tp(locale, "stats.file")} value={statsInfo.sessionFile ?? tp(locale, "stats.inMemory")} />
        <StatRow label="ID" value={statsInfo.sessionId} />
        {statsInfo.totalActiveMs ? <StatRow label={tp(locale, "stats.activeTime")} value={fmtDuration(statsInfo.totalActiveMs)} /> : null}
      </Section>
      {/* 消息/Token 圆环并排横放（以人为本：缩小可视区高度，减轻竖向压力） */}
      <div className="poweri-stats-donut-pair">
        <Section title={tp(locale, "stats.messages")}>
          <div className="poweri-donut-wrap">
            <Donut segments={messageSegments} centerValue={fmtNum(statsInfo.totalMessages)} centerLabel={tp(locale, "stats.total")} />
            <DonutList items={messageLegendItems} />
          </div>
        </Section>
        <Section title={tp(locale, "stats.tokens")}>
          <div className="poweri-donut-wrap">
            <Donut segments={tokenSegments} centerValue={fmtTokens(statsInfo.tokens?.total ?? 0)} centerLabel={tp(locale, "stats.total")} />
            <DonutList items={tokenLegendItems} />
          </div>
          {(statsInfo.cost > 0 || contextUsage?.contextWindow || cacheHitRate !== null) && (
            <div className="poweri-token-extras">
              {statsInfo.cost > 0 && <StatRow label={tp(locale, "stats.cost")} value={`$${statsInfo.cost.toFixed(4)}`} />}
              {contextUsage?.contextWindow ? (
                <StatRow label={tp(locale, "stats.context")} value={`${contextUsage.percent !== null ? `${contextUsage.percent.toFixed(1)}%` : "?"} / ${fmtCompact(contextUsage.contextWindow)}`} />
              ) : null}
              {cacheHitRate !== null && <StatRow label={tp(locale, "stats.avgHitRate")} value={`${cacheHitRate}%`} />}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

/** 单个会话的离线统计详情（含圆环）；供历史会话行展开与当前会话 tab 复用。 */
export function SessionStatsView({ sessionId }: { sessionId: string }) {
  const { locale } = useI18n();
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setStats(null);
    fetch(`/poweri/api/session-stats/${encodeURIComponent(sessionId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: SessionStats) => {
        if (!alive) return;
        setStats(d);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setStats({ ok: false, error: tp(locale, "stats.loadFailed") });
        setLoading(false);
      });
    return () => { alive = false; };
  }, [sessionId, locale]);

  return (
    <div>
      {loading && <div className="poweri-hint">{tp(locale, "stats.loadingInfo")}</div>}
      {stats?.error && <div className="poweri-hint poweri-hint-err">{stats.error}</div>}
      {stats?.stats && <SessionDetail stats={stats.stats} />}
    </div>
  );
}

export function SessionListPanel() {
  const { locale } = useI18n();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [mode, setMode] = useState<GroupMode>("day");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchHistoryRows()
      .then((r) => { if (alive) setRows(r); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, []);

  const toggleExpand = useCallback((id: string) => setExpandedId((cur) => (cur === id ? null : id)), []);

  const dayGroups = mode === "day" && rows ? groupByDayFlat(rows) : null;
  const wsGroups = mode === "workspace" && rows ? groupByWorkspace(rows) : null;

  return (
    <div className="poweri-sess-scroll">
      <div className="poweri-tl-toolbar">
        <div className="poweri-tl-mode">
          <button
            type="button"
            className={mode === "day" ? "poweri-tl-mode-btn poweri-tl-mode-on" : "poweri-tl-mode-btn"}
            onClick={() => setMode("day")}
          >
            {tp(locale, "stats.byDay")}
          </button>
          <button
            type="button"
            className={mode === "workspace" ? "poweri-tl-mode-btn poweri-tl-mode-on" : "poweri-tl-mode-btn"}
            onClick={() => setMode("workspace")}
          >
            {tp(locale, "stats.byWorkspace")}
          </button>
        </div>
        <span className="poweri-hint">
          {tp(locale, "stats.allSessions", { count: rows?.length ?? "…" })}
        </span>
      </div>

      {mode === "day" && dayGroups && dayGroups.map((day) => (
        <div key={day.key} className="poweri-tl-day">
          <div className="poweri-tl-head">
            <span className="poweri-tl-head-label">{dayLabel(day.ts)}</span>
            <span className="poweri-tl-head-meta">
              {tp(locale, "stats.sessionsCount", { count: day.rows.length })} · {fmtTokens(groupTokens(day.rows))} tokens
              {groupCost(day.rows) > 0 && <> · <span className="poweri-tl-cost">{fmtCost(groupCost(day.rows))}</span></>}
              {groupCacheHitRate(day.rows) !== null && <> · <span className="poweri-tl-hit">{tp(locale, "stats.cacheHit", { rate: groupCacheHitRate(day.rows)!.toFixed(1) })}</span></>}
            </span>
          </div>
          {day.rows.map((r) => <TimelineRow key={r.id} row={r} open={expandedId === r.id} onToggle={toggleExpand} showWorkspace />)}
        </div>
      ))}

      {mode === "workspace" && wsGroups && wsGroups.map((ws) => (
        <div key={ws.name} className="poweri-tl-day">
          <div className="poweri-tl-head">
            <span className="poweri-tl-head-label" title={ws.rows[0]?.cwd}>{ws.name}</span>
            <span className="poweri-tl-head-meta">
              {tp(locale, "stats.sessionsCount", { count: ws.rows.length })} · {fmtTokens(groupTokens(ws.rows))} tokens
              {groupCost(ws.rows) > 0 && <> · <span className="poweri-tl-cost">{fmtCost(groupCost(ws.rows))}</span></>}
              {groupCacheHitRate(ws.rows) !== null && <> · <span className="poweri-tl-hit">{tp(locale, "stats.cacheHit", { rate: groupCacheHitRate(ws.rows)!.toFixed(1) })}</span></>}
            </span>
          </div>
          {ws.rows.map((r) => <TimelineRow key={r.id} row={r} open={expandedId === r.id} onToggle={toggleExpand} showDate />)}
        </div>
      ))}
    </div>
  );
}

/** 时间线行：行本身展开时不变，详情在行下方全宽展开 */
function TimelineRow({ row, open, onToggle, showWorkspace, showDate }: {
  row: HistoryRow; open: boolean; onToggle: (id: string) => void; showWorkspace?: boolean; showDate?: boolean;
}) {
  return (
    <div className="poweri-tl-sess">
      <button
        type="button"
        className={open ? "poweri-tl-row poweri-tl-row-on" : "poweri-tl-row"}
        onClick={() => onToggle(row.id)}
      >
        <span className="poweri-tl-time" title={fullTime(row.ts)}>{showDate ? fmtClockFull(row.ts) : fmtClock(row.ts)}</span>
        {showWorkspace && <span className="poweri-tl-chip" title={row.cwd}>{row.workspace}</span>}
        <span className="poweri-tl-title">{row.title}</span>
        <span className="poweri-tl-right">
          {row.tokens > 0 && <span className="poweri-tl-tokens">{fmtTokens(row.tokens)}</span>}
          <span className="poweri-tl-count">{fmtCount(row.messages)}</span>
        </span>
      </button>
      {open && (
        <div className="poweri-tl-detail">
          <SessionStatsView sessionId={row.id} />
        </div>
      )}
    </div>
  );
}
