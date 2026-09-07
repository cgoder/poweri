"use client";

import { useI18n } from "@/hooks/useI18n";
import { tp } from "@/poweri/lib/i18n";
import { useAppUpdateBadge } from "@/poweri/hooks/useAppUpdateBadge";

/**
 * 应用本体更新圆点（accent 色 6px）：设置入口按钮与设置面板「常规」tab 共用。
 *
 * 数据源 = poweri/lib/app-update-badge.ts 共享层（useAppUpdate 状态机镜像写入，
 * AppShell 守护实例触发首查）。仅在「已有可信检测且确认存在新版」时渲染，
 * 其余（未检测/已是最新/dev/检测失败）一律不渲染——圆点是增强提示。
 * 悬停提示由宿主按钮的 title 组合提供（圆点自身 aria-hidden 装饰）。
 */
export function AppUpdateDot() {
  const badge = useAppUpdateBadge();
  const { locale } = useI18n();
  if (!badge.checked || !badge.updateAvailable) return null;
  return (
    <span
      aria-hidden
      title={badge.latest ? tp(locale, "appUpdate.newVersion", { version: badge.latest }) : undefined}
      style={{
        flexShrink: 0,
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "var(--accent)",
        display: "inline-block",
      }}
    />
  );
}

/**
 * 宿主按钮 title 的应用更新片段（「发现新版本 {version}」），无更新时返回 null。
 * 与插件/技能更新计数 title（settings.updatesBadgeTitle）由调用方组合。
 */
export function useAppUpdateTitle(): string | null {
  const badge = useAppUpdateBadge();
  const { locale } = useI18n();
  if (!badge.checked || !badge.updateAvailable || !badge.latest) return null;
  return tp(locale, "appUpdate.newVersion", { version: badge.latest });
}
