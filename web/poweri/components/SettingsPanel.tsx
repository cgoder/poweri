"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTheme, type ThemePreference } from "@/hooks/useTheme";
import { sendAgentCommand } from "@/lib/agent-client";
import type { ShellToolSettingsResponse } from "@/lib/api-types";
import {
  setLastSettingsSection,
  type SettingsSection,
} from "@/lib/settings-navigation";
import { PowerIPluginsConfig } from "@/poweri/features/plugins/PowerIPluginsConfig";
import { ConfigSwitch } from "@/components/SettingsUi";
import { StatsPanel } from "@/poweri/features/StatsPanel";
import { SkillsMarketView } from "@/poweri/features/skills/SkillsMarketView";
import { ModelsConfig } from "@/components/ModelsConfig";
import { tp } from "@/poweri/lib/i18n";
import { VersionUpdateSection } from "@/poweri/components/VersionUpdateSection";
import { AppUpdateDot, useAppUpdateTitle } from "@/poweri/components/AppUpdateDot";

export type PowerISettingsSection = SettingsSection | "usage";

interface Props {
  cwd: string | null;
  sessionId: string | null;
  initialSection: PowerISettingsSection;
  onClose: () => void;
  onSessionReloaded: () => void;
}

export function SettingsSectionIcon({
  section,
  size = 16,
  strokeWidth = 1.8,
}: {
  section: PowerISettingsSection;
  size?: number;
  strokeWidth?: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "settings-section-icon",
  };

  if (section === "general") {
    return (
      <svg {...common}>
        <path d="M20 7h-9M14 17H5" />
        <circle cx="7" cy="7" r="3" />
        <circle cx="17" cy="17" r="3" />
      </svg>
    );
  }
  if (section === "models") {
    return (
      <svg {...common}>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <rect x="9" y="9" width="6" height="6" />
        <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" />
      </svg>
    );
  }
  if (section === "skills") {
    return (
      <svg {...common}>
        <path d="m12 2-10 5 10 5 10-5-10-5Z" />
        <path d="m2 12 10 5 10-5M2 17l10 5 10-5" />
      </svg>
    );
  }
  if (section === "agents") {
    return (
      <svg {...common} className="settings-section-icon is-agent">
        <rect x="5" y="7" width="14" height="11" rx="2" />
        <path d="M9 11h.01M15 11h.01M9 15h6M12 7V4M10 4h4" />
      </svg>
    );
  }
  if (section === "usage") {
    return (
      <svg {...common}>
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M9 7V2M15 7V2M6 13V8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v5a6 6 0 0 1-12 0ZM12 19v3" />
    </svg>
  );
}

function ThemeIcon({ preference }: { preference: ThemePreference }) {
  if (preference === "light") {
    return (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    );
  }
  if (preference === "dark") {
    return (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
      </svg>
    );
  }
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function GeneralSettings({ sessionId, onSessionReloaded }: Pick<Props, "sessionId" | "onSessionReloaded">) {
  const { locale, setLocale, supportedLocales, t } = useI18n();
  const { preference, setThemePreference } = useTheme();
  const [shellSettings, setShellSettings] = useState<ShellToolSettingsResponse | null>(null);
  const [shellSaving, setShellSaving] = useState(false);
  const [shellError, setShellError] = useState<string | null>(null);
  const themeOptions: { id: ThemePreference; label: string }[] = [
    { id: "light", label: t("settings.themeLight") },
    { id: "dark", label: t("settings.themeDark") },
    { id: "auto", label: t("settings.themeSystem") },
  ];

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/tools/settings")
      .then(async (response) => {
        const data = await response.json() as ShellToolSettingsResponse & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!cancelled) setShellSettings(data);
      })
      .catch((cause) => {
        if (!cancelled) setShellError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, []);

  const togglePowerShell = async (enabled: boolean) => {
    setShellSaving(true);
    setShellError(null);
    try {
      const response = await fetch("/api/tools/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json() as ShellToolSettingsResponse & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setShellSettings(data);
      if (sessionId) {
        await sendAgentCommand(sessionId, { type: "reload" });
        onSessionReloaded();
      }
    } catch (cause) {
      setShellError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setShellSaving(false);
    }
  };

  return (
    <div className="settings-general">
      <h2 className="settings-general-title">{t("settings.general")}</h2>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("settings.appearance")}</h3>
        <p className="settings-general-description">{t("settings.appearanceDescription")}</p>
        <div role="radiogroup" aria-label={t("settings.appearance")} className="settings-theme-options">
          {themeOptions.map((option) => {
            const selected = preference === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setThemePreference(option.id)}
                className="settings-theme-option"
              >
                <ThemeIcon preference={option.id} />
                <span className="settings-theme-option-label">{option.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {shellSettings?.isWindows && (
        <section className="settings-general-section">
          <h3 className="settings-general-heading">{t("settings.shellTool")}</h3>
          <p className="settings-general-description">{t("settings.shellToolDescription")}</p>
          <div className="settings-shell-option">
            <span>{t("settings.usePowerShell")}</span>
            <ConfigSwitch
              checked={shellSettings.powerShellEnabled}
              loading={shellSaving}
              label={t("settings.usePowerShell")}
              onChange={(enabled) => void togglePowerShell(enabled)}
            />
          </div>
          {shellError && <p role="alert" className="settings-general-error">{shellError}</p>}
        </section>
      )}

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("common.language")}</h3>
        <p className="settings-general-description">{t("settings.languageDescription")}</p>
        <div role="radiogroup" aria-label={t("common.language")} className="settings-language-options">
          {supportedLocales.map((plugin) => {
            const selected = locale === plugin.id;
            return (
              <button
                key={plugin.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setLocale(plugin.id as typeof locale)}
                className="settings-language-option"
              >
                <span className="settings-language-radio">
                  {selected && <span className="settings-language-radio-dot" />}
                </span>
                <span className="settings-language-label">{plugin.label}</span>
                <span className="settings-language-code">{plugin.id}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* PROTOTYPE(version-update): 底部 slot（变体 A/C 挂这里） */}
      {/* 版本与更新（胜出设计 A'：行内版本行 + 手动检查），详见 VersionUpdateSection.tsx */}
      <VersionUpdateSection />
    </div>
  );
}

export function SettingsPanel({ cwd, sessionId, initialSection, onClose, onSessionReloaded }: Props) {
  const { t, locale } = useI18n();
  const [section, setSection] = useState<PowerISettingsSection>(initialSection);
  const [mountedSections, setMountedSections] = useState<ReadonlySet<PowerISettingsSection>>(
    () => new Set([section]),
  );
  // 更新计数(plugins 包更新 / skills 订阅源+包技能):
  // 初始自 fetch(普通模式,命中服务端 TTL 缓存零网络)供未挂载 section 的 tab 角标;
  // 子面板挂载后 force 检测经 onUpdateCount 回调覆盖为最新值。
  const [pluginUpdateCount, setPluginUpdateCount] = useState(0);
  const [skillUpdateCount, setSkillUpdateCount] = useState(0);
  // 应用本体更新（poweri-web）：入口圆点/常规 tab 圆点与 title 共用一份数据源
  const appUpdateTitle = useAppUpdateTitle();

  const sections: { id: PowerISettingsSection; label: string; requiresProject: boolean }[] = [
    { id: "general", label: t("settings.general"), requiresProject: false },
    { id: "models", label: t("common.models"), requiresProject: false },
    { id: "skills", label: t("common.skills"), requiresProject: true },
    { id: "plugins", label: t("common.plugins"), requiresProject: true },
    { id: "usage", label: tp(locale, "common.data"), requiresProject: false },
  ];

  useEffect(() => {
    if (initialSection !== "usage") {
      setLastSettingsSection(initialSection as SettingsSection);
    }
  }, [initialSection]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (cwd || (section !== "skills" && section !== "plugins")) return;
    setSection("general");
    setMountedSections((current) => new Set(current).add("general"));
    setLastSettingsSection("general");
  }, [cwd, section]);

  useEffect(() => {
    if (!cwd) return;
    let cancelled = false;
    void (async () => {
      try {
        const [pkgRes, skillRes] = await Promise.all([
          fetch(`/poweri/api/plugins/updates?cwd=${encodeURIComponent(cwd)}`),
          fetch("/poweri/api/skills/update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "check", mode: "auto" }),
          }),
        ]);
        const pkgData = pkgRes.ok ? ((await pkgRes.json()) as { summary?: { outdated?: number } } | null) : null;
        const skillData = skillRes.ok ? ((await skillRes.json()) as { updates?: Array<{ updateState?: string }> } | null) : null;
        if (!cancelled && pkgData?.summary && typeof pkgData.summary.outdated === "number") {
          setPluginUpdateCount(pkgData.summary.outdated);
        }
        if (!cancelled && Array.isArray(skillData?.updates)) {
          setSkillUpdateCount(
            skillData.updates.filter(
              (u) => u.updateState === "update-available" || u.updateState === "conflict",
            ).length,
          );
        }
      } catch {
        // 角标是增强提示,检测失败静默
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  const activateSection = (nextSection: PowerISettingsSection) => {
    setMountedSections((current) => new Set(current).add(nextSection));
    setSection(nextSection);
    if (nextSection !== "usage") {
      setLastSettingsSection(nextSection as SettingsSection);
    }
  };

  const sectionHost = (id: PowerISettingsSection, content: ReactNode) =>
    mountedSections.has(id) ? (
      <div
        key={id}
        hidden={section !== id}
        className="settings-section-host"
        style={id === "usage" ? { height: "100%", overflowY: "auto" } : undefined}
      >
        {content}
      </div>
    ) : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("settings.title")}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="settings-dialog-backdrop"
    >
      <div className="settings-dialog-surface">
        <div className="settings-dialog-header">
          <strong className="settings-dialog-title">{t("settings.title")}</strong>
          <select
            aria-label={t("settings.title")}
            value={section}
            onChange={(event) => activateSection(event.target.value as PowerISettingsSection)}
            className="settings-mobile-section-picker"
          >
            {sections.map((item) => (
              <option key={item.id} value={item.id} disabled={item.requiresProject && !cwd}>
                {item.label}
              </option>
            ))}
          </select>
          <nav aria-label={t("settings.title")} className="settings-section-tabs">
            {sections.map((item) => {
              const selected = section === item.id;
              const disabled = item.requiresProject && !cwd;
              const badgeCount =
                item.id === "plugins" ? pluginUpdateCount : item.id === "skills" ? skillUpdateCount : 0;
              // 常规 tab：应用本体有新版时加圆点示意（与侧栏设置按钮同数据源）
              const generalAppUpdate = item.id === "general" && appUpdateTitle != null;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="settings-section-tab"
                  disabled={disabled}
                  title={
                    disabled
                      ? t("settings.projectRequired")
                      : generalAppUpdate
                        ? appUpdateTitle!
                        : item.id === "plugins" || item.id === "skills"
                          ? tp(locale, "settings.updatesBadgeTitle", { p: pluginUpdateCount, s: skillUpdateCount })
                          : item.label
                  }
                  aria-current={selected ? "page" : undefined}
                  onClick={() => activateSection(item.id)}
                >
                  <SettingsSectionIcon section={item.id} />
                  <span>{item.label}</span>
                  {!disabled && item.id === "general" && <AppUpdateDot />}
                  {!disabled && badgeCount > 0 && (
                    <span
                      style={{
                        flexShrink: 0,
                        minWidth: 14,
                        height: 14,
                        padding: "0 4px",
                        borderRadius: 7,
                        background: "#3b82f6",
                        color: "#fff",
                        fontSize: 10,
                        fontWeight: 600,
                        lineHeight: "14px",
                        textAlign: "center",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
          <button
            type="button"
            onClick={onClose}
            title={t("i18n.close")}
            aria-label={t("i18n.close")}
            className="config-close-button settings-dialog-close"
          >
            ×
          </button>
        </div>

        <main className="settings-dialog-main">
          {sectionHost("general", <GeneralSettings sessionId={sessionId} onSessionReloaded={onSessionReloaded} />)}
          {sectionHost("models", <ModelsConfig embedded onClose={onClose} />)}
          {sectionHost(
          "skills",
          <SkillsMarketView
            cwd={cwd}
            sessionId={sessionId}
            onReloaded={onSessionReloaded}
            onClose={onClose}
            onUpdateCount={setSkillUpdateCount}
          />,
        )}
          {cwd && sectionHost("plugins", <PowerIPluginsConfig key={cwd} cwd={cwd} sessionId={sessionId} onReloaded={onSessionReloaded} onUpdateCount={setPluginUpdateCount} />)}
          {sectionHost("usage", <StatsPanel sessionId={sessionId} />)}
        </main>
      </div>
    </div>
  );
}
