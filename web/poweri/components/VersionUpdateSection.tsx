"use client";

import { formatRelativeTime } from "@/lib/i18n/format";
import { useI18n } from "@/hooks/useI18n";
import { tp } from "@/poweri/lib/i18n";
import { copyToClipboard } from "@/poweri/lib/file-actions";
import { readLastCheckedAt, useAppUpdate, type AppUpdateState } from "@/poweri/hooks/useAppUpdate";

/**
 * 设置 → 通用 →「版本与更新」（2026-09-03 拍板的 A' 设计原型先行归档于
 * prototype/version-update-settings 分支）。
 *
 * 结构：行内版本行（chip + 状态 + 唯一主动作）+ 行下全宽信息条。任意时刻只有
 * 一个主动作：空闲=检查更新 / 有新版=升级到 vX / 升级进行中=无按钮。有新版时
 * 行下展开纯信息条，不重复按钮。纯浏览器模式只提示手动命令（v1 不自升级）。
 */

const BROWSER_UPGRADE_COMMAND = "npm install -g @agegr/pi-web@latest";

const monoStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontVariantNumeric: "tabular-nums",
};

function VersionChip({ version }: { version: string }) {
  return (
    <span
      style={{
        flexShrink: 0,
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        fontSize: 11,
        lineHeight: 1,
        padding: "4px 8px",
        borderRadius: 5,
        border: "1px solid var(--border)",
        background: "var(--bg-hover)",
        color: "var(--text-muted)",
      }}
    >
      {version}
    </span>
  );
}

const btnBase: React.CSSProperties = {
  flexShrink: 0,
  fontSize: 12,
  lineHeight: 1,
  padding: "7px 12px",
  borderRadius: 6,
  border: "1px solid transparent",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const btnSecondary: React.CSSProperties = {
  ...btnBase,
  background: "transparent",
  borderColor: "var(--border)",
  color: "var(--text)",
};

const btnPrimary: React.CSSProperties = {
  ...btnBase,
  background: "var(--accent)",
  color: "#fff",
};

/** 不确定进度条（下载/重启阶段；真实 npm 进度在壳窗口日志）。 */
function IndeterminateBar() {
  return (
    <div
      style={{
        marginTop: 10,
        height: 4,
        borderRadius: 999,
        background: "var(--bg-hover)",
        overflow: "hidden",
      }}
    >
      <div
        className="vux-indeterminate-fill"
        style={{ height: "100%", width: "38%", borderRadius: 999, background: "var(--accent)" }}
      />
    </div>
  );
}

/** 行下全宽信息条：variant=info 蓝色 / error 红色 / done 绿色。 */
function DetailStrip({ tone, children }: { tone: "info" | "error" | "done"; children: React.ReactNode }) {
  const color = tone === "info" ? "var(--accent)" : tone === "error" ? "#ef4444" : "#10b981";
  return (
    <div
      style={{
        marginTop: 10,
        padding: "9px 12px",
        borderRadius: 8,
        border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
        background: `color-mix(in srgb, ${color} 7%, transparent)`,
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 6,
        fontSize: 12,
        color: "var(--text)",
      }}
    >
      {children}
    </div>
  );
}

function statusText(state: AppUpdateState, locale: Parameters<typeof tp>[0]): string | null {
  switch (state.phase) {
    case "loading":
    case "checking":
      return tp(locale, "appUpdate.checking");
    case "idle":
      if (state.latest) return tp(locale, "appUpdate.newVersion", { version: state.latest });
      if (state.mode === "dev") return tp(locale, "appUpdate.devModeNote");
      if (state.mode === "shell" && !state.canUpgrade) return tp(locale, "appUpdate.cannotUpgrade");
      return tp(locale, "appUpdate.upToDate");
    case "installing":
      return tp(locale, "appUpdate.downloading");
    case "restarting":
      return tp(locale, "appUpdate.restarting");
    case "reloading":
      return tp(locale, "appUpdate.reloading");
    case "done":
      return tp(locale, "appUpdate.installed", { version: state.current });
    case "error":
      return state.errorCode === "check"
        ? tp(locale, "appUpdate.checkFailed")
        : tp(locale, "appUpdate.upgradeFailedShort");
  }
}

export function VersionUpdateSection() {
  const { locale } = useI18n();
  const { state, check, upgrade } = useAppUpdate();
  const lastCheckedAt = readLastCheckedAt();
  const busy = state.phase === "installing" || state.phase === "restarting";
  const idle = state.phase === "idle" || state.phase === "done" || state.phase === "error";
  // 空闲且可操作时行右侧的主动作
  const showCheckButton = idle && state.mode !== "dev" && (state.mode === "browser" || state.canUpgrade);
  const showUpgradeButton = state.phase === "idle" && state.mode === "shell" && state.canUpgrade && !!state.latest;

  return (
    <section className="settings-general-section" data-testid="version-update-section">
      {/* 进度条/指示器的 keyframes；量小就近内联，避免为 3 个动画动上游 globals.css */}
      <style>{`
        @keyframes vux-slide { 0% { transform: translateX(-110%); } 100% { transform: translateX(290%); } }
        .vux-indeterminate-fill { animation: vux-slide 1.3s ease-in-out infinite; }
        @keyframes vux-spin { to { transform: rotate(360deg); } }
        .vux-spinner {
          display: inline-block; width: 11px; height: 11px; border-radius: 50%;
          border: 2px solid var(--border); border-top-color: var(--accent);
          animation: vux-spin 0.8s linear infinite; vertical-align: -1px;
        }
      `}</style>
      <h3 className="settings-general-heading">{tp(locale, "appUpdate.sectionTitle")}</h3>
      <p className="settings-general-description">
        PowerI Web {state.current && <span style={monoStyle}>v{state.current}</span>}
        {lastCheckedAt && (
          <>
            {" · "}
            {tp(locale, "appUpdate.lastChecked", {
              time: formatRelativeTime(new Date(lastCheckedAt), locale),
            })}
          </>
        )}
      </p>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          minHeight: 32,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {state.current && <VersionChip version={`v${state.current}`} />}
          {(state.phase === "loading" || state.phase === "checking") && <span className="vux-spinner" aria-hidden />}
          <span
            style={{
              fontSize: 12,
              color: state.phase === "idle" && state.latest ? "var(--text)" : "var(--text-muted)",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {statusText(state, locale)}
          </span>
        </div>
        {showCheckButton && (
          <button
            type="button"
            style={btnSecondary}
            onClick={() => void check(true)}
            title={tp(locale, "appUpdate.checkNow")}
          >
            {tp(locale, "appUpdate.checkNow")}
          </button>
        )}
        {showUpgradeButton && (
          <button
            type="button"
            style={btnPrimary}
            onClick={() => void upgrade()}
            title={tp(locale, "appUpdate.autoRestartNote")}
          >
            {tp(locale, "appUpdate.upgradeToVersion", { version: state.latest ?? "" })}
          </button>
        )}
      </div>

      {/* 有新版：行下全宽信息条（纯信息，动作固定在行右侧） */}
      {state.phase === "idle" && state.latest && state.mode === "shell" && (
        <DetailStrip tone="info">
          <span style={monoStyle}>
            v{state.current} <span style={{ color: "var(--text-muted)" }}>→</span> v{state.latest}
          </span>
          <span style={{ color: "var(--text-muted)" }}>{tp(locale, "appUpdate.autoRestartNote")}</span>
        </DetailStrip>
      )}

      {/* 纯浏览器：手动命令提示（v1 只提示不自升级） */}
      {state.phase === "idle" && state.latest && state.mode === "browser" && (
        <DetailStrip tone="info">
          <span>{tp(locale, "appUpdate.browserNoInApp")}</span>
          <code
            style={{
              ...monoStyle,
              padding: "3px 8px",
              borderRadius: 5,
              background: "var(--bg-hover)",
              border: "1px solid var(--border)",
            }}
          >
            {BROWSER_UPGRADE_COMMAND}
          </code>
          <button
            type="button"
            style={{ ...btnSecondary, padding: "4px 10px" }}
            onClick={() => void copyToClipboard(BROWSER_UPGRADE_COMMAND)}
          >
            {tp(locale, "appUpdate.copyCommand")}
          </button>
          <span style={{ color: "var(--text-muted)" }}>{tp(locale, "appUpdate.browserTakesEffect")}</span>
        </DetailStrip>
      )}

      {/* 升级中：进度条 */}
      {busy && <IndeterminateBar />}

      {/* 已安装未重启：绿色说明 + 壳侧补充消息 */}
      {state.phase === "done" && (
        <DetailStrip tone="done">
          <span>{state.message ?? tp(locale, "appUpdate.browserTakesEffect")}</span>
        </DetailStrip>
      )}

      {/* 失败：红色详情（壳侧原文或结构化错误） */}
      {state.phase === "error" && (
        <DetailStrip tone="error">
          <span>
            {state.errorCode === "reload-timeout"
              ? tp(locale, "appUpdate.reloadTimeout")
              : state.errorCode === "check"
                ? tp(locale, "appUpdate.checkFailed")
                : state.message}
          </span>
        </DetailStrip>
      )}
    </section>
  );
}
