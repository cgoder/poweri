"use client";

import { useSyncExternalStore } from "react";
import {
  getAppUpdateBadgeState,
  getInitialAppUpdateBadgeState,
  subscribeAppUpdateBadge,
  type AppUpdateBadgeState,
} from "@/poweri/lib/app-update-badge";

/**
 * 应用本体更新圆点的读取端（数据源与镜像写入见 poweri/lib/app-update-badge.ts）。
 *
 * 消费方：AppShell 侧栏「设置」按钮、SettingsPanel「常规」tab。
 * 首次检测由 AppShell 守护实例（useAppUpdate autoCheckDelayMs）或设置页
 * VersionUpdateSection 挂载触发；本 hook 只订阅，不发起检测。
 */
export function useAppUpdateBadge(): AppUpdateBadgeState {
  return useSyncExternalStore(subscribeAppUpdateBadge, getAppUpdateBadgeState, getInitialAppUpdateBadgeState);
}

/** 圆点可见性：已有一次可信检测且确认存在新版本。 */
export function useAppUpdateDotVisible(): boolean {
  const badge = useAppUpdateBadge();
  return badge.checked && badge.updateAvailable;
}
