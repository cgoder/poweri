"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { tauriInvoke } from "@/poweri/lib/file-actions";
import { deriveAppUpdateBadge, setAppUpdateBadgeState } from "@/poweri/lib/app-update-badge";

/**
 * 「设置 → 通用 → 版本与更新」的数据源与升级状态机。
 *
 * 双源归一：
 * - 壳（Tauri）模式：`check_update`（commands.rs，`npm view` + 12h 缓存，
 *   `force` 可绕过缓存）+ `upgrade_poweri`（npm install + 重启）。
 * - 纯浏览器模式：`/poweri/api/web-update`（npm registry，服务端缓存 12h）。
 *   v1 只提示——展示手动升级命令，不做应用内自升级。
 * - 开发模式（npm run dev）：不检查（壳 debug 构建的 `check_update` 本就跳过）。
 *
 * 升级链路补缺口：`upgrade_poweri` 返回 `restarted: true` 时 Rust 只是把
 * spawn 发出去（端口未就绪），必须轮询健康端点就绪后再 reload——立即 reload
 * 会命中 service worker 的 offline fallback（/poweri 是 navigate 请求），
 * 且地址栏 URL 不变会永久卡死（见壳侧 upgrade() 的同款注释）。健康探针打
 * `/api/home`：public/sw.js 对 `/api/*` 直接放行，不经过 offline fallback，
 * 所以 fetch reject = 服务未就绪，resolve（任意状态码）= 已就绪。
 */

/** 镜像 UpdateInfo in src-tauri/src/commands.rs（serde: snake_case）。 */
export type ShellUpdateInfo = {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  can_upgrade: boolean;
};

/** 镜像 UpgradeResult in src-tauri/src/commands.rs。 */
type ShellUpgradeResult = {
  ok: boolean;
  version: string;
  restarted: boolean;
  restart_failed: boolean;
  message: string;
};

/** 镜像 app/poweri/api/web-update/route.ts 响应。 */
type WebUpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  checkedAt: string;
};

export type UpdateMode = "shell" | "browser" | "dev";

export type AppUpdatePhase =
  | "loading" // 首次模式检测 + 初始检查
  | "idle" // 空闲（可发起手动检查；latest 非空 = 有新版）
  | "checking" // 手动检查中
  | "installing" // npm install 进行中（进度见壳窗口日志）
  | "restarting" // 服务重启中（Rust 已 spawn，等端口就绪）
  | "reloading" // 服务就绪，即将刷新页面
  | "done" // 已安装未重启（下次启动生效）
  | "error"; // 失败（message 带原因）

export type AppUpdateErrorCode = "check" | "reload-timeout";

export type AppUpdateState = {
  phase: AppUpdatePhase;
  mode: UpdateMode;
  current: string;
  /** 非空 = npm 上有更新版本。 */
  latest: string | null;
  /** 壳模式：该安装方式是否支持应用内升级（dev/override 为 false）。 */
  canUpgrade: boolean;
  /** 错误详情或「下次启动生效」的补充说明（壳侧原文）。 */
  message: string | null;
  /** 结构化错误：组件按此映射 i18n 文案；message 仅作详情展示。 */
  errorCode: AppUpdateErrorCode | null;
};

const CHECK_TIMEOUT_MS = 30_000; // 桥超时必须盖过 Rust 侧 20s npm view 上限
const UPGRADE_TIMEOUT_MS = 360_000; // npm install 300s 上限 + 重启余量
const HEALTH_POLL_INTERVAL_MS = 2_000;
const HEALTH_POLL_MAX_MS = 180_000;
const LAST_CHECKED_KEY = "poweri:updateLastCheckedAt";

function noteCheckedAt(): void {
  try {
    localStorage.setItem(LAST_CHECKED_KEY, String(Date.now()));
  } catch {
    // 隐私模式等场景下不可用——仅影响「X 前检查」展示
  }
}

export function readLastCheckedAt(): number | null {
  try {
    const raw = localStorage.getItem(LAST_CHECKED_KEY);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function useAppUpdate(opts?: { autoCheckDelayMs?: number }): {
  state: AppUpdateState;
  check: (force: boolean) => Promise<void>;
  upgrade: () => Promise<void>;
} {
  // 守护实例用（AppShell）：空闲延迟首查，避开启动高峰；设置页实例立即查。
  const autoCheckDelayMs = opts?.autoCheckDelayMs ?? 0;
  const [state, setState] = useState<AppUpdateState>({
    phase: "loading",
    mode: "shell",
    current: "",
    latest: null,
    canUpgrade: false,
    message: null,
    errorCode: null,
  });
  // 升级/轮询期间卸载组件（关设置面板）后不再 setState。
  const disposed = useRef(false);
  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
    };
  }, []);

  const applyShellInfo = useCallback((u: ShellUpdateInfo) => {
    noteCheckedAt();
    setState({
      phase: "idle",
      mode: "shell",
      current: u.current_version,
      latest: u.update_available ? u.latest_version : null,
      canUpgrade: u.can_upgrade,
      message: null,
      errorCode: null,
    });
  }, []);

  const applyWebInfo = useCallback((u: WebUpdateInfo) => {
    noteCheckedAt();
    setState({
      phase: "idle",
      mode: "browser",
      current: u.currentVersion,
      latest: u.updateAvailable ? u.latestVersion : null,
      canUpgrade: false,
      message: null,
      errorCode: null,
    });
  }, []);

  // 挂载：模式检测 + 初始检查（默认走缓存，冷缓存时 Rust 侧现查 npm）
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (process.env.NODE_ENV === "development") {
        setState({
          phase: "idle",
          mode: "dev",
          current: process.env.NEXT_PUBLIC_APP_VERSION ?? "",
          latest: null,
          canUpgrade: false,
          message: null,
          errorCode: null,
        });
        return;
      }
      const shellInfo = await tauriInvoke<ShellUpdateInfo>("check_update", { force: false }, CHECK_TIMEOUT_MS)
        .catch(() => null);
      if (cancelled) return;
      if (shellInfo && shellInfo.current_version) {
        applyShellInfo(shellInfo);
        return;
      }
      // 纯浏览器（无 IPC 无桥）：查本服务自己的 web-update 路由
      try {
        const res = await fetch("/poweri/api/web-update", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const info = (await res.json()) as WebUpdateInfo;
        if (!cancelled) applyWebInfo(info);
      } catch {
        if (!cancelled) {
          setState((s) => ({ ...s, phase: "error", mode: "browser", errorCode: "check" }));
        }
      }
    };
    if (autoCheckDelayMs > 0) {
      const timer = setTimeout(() => {
        void run();
      }, autoCheckDelayMs);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [applyShellInfo, applyWebInfo, autoCheckDelayMs]);

  // 镜像到入口圆点共享层：状态落地即整体替换写入，设置入口/常规 tab 圆点实时
  // 跟随（面板外守护实例与面板内状态机写同一 store，见 app-update-badge.ts）。
  useEffect(() => {
    setAppUpdateBadgeState(deriveAppUpdateBadge(state.phase, state.mode, state.latest));
  }, [state.phase, state.mode, state.latest]);

  const check = useCallback(
    async (force: boolean) => {
      if (state.phase === "checking" || state.phase === "loading") return;
      if (state.mode === "dev") return;
      setState((s) => ({ ...s, phase: "checking", message: null, errorCode: null }));
      if (state.mode === "shell") {
        try {
          const u = await tauriInvoke<ShellUpdateInfo>("check_update", { force }, CHECK_TIMEOUT_MS);
          if (disposed.current) return;
          if (u && u.current_version) applyShellInfo(u);
          else setState((s) => ({ ...s, phase: "idle" }));
        } catch {
          if (!disposed.current) setState((s) => ({ ...s, phase: "idle" }));
        }
        return;
      }
      // browser
      try {
        const res = await fetch(`/poweri/api/web-update${force ? "?force=1" : ""}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const info = (await res.json()) as WebUpdateInfo;
        if (disposed.current) return;
        applyWebInfo(info);
      } catch {
        if (!disposed.current) setState((s) => ({ ...s, phase: "idle" }));
      }
    },
    [state.phase, state.mode, applyShellInfo, applyWebInfo],
  );

  const upgrade = useCallback(async () => {
    if (state.mode !== "shell" || !state.canUpgrade || state.phase !== "idle" || !state.latest) return;
    const latest = state.latest;
    setState((s) => ({ ...s, phase: "installing", latest, message: null }));
    let result: ShellUpgradeResult | null = null;
    try {
      result = await tauriInvoke<ShellUpgradeResult>("upgrade_poweri", undefined, UPGRADE_TIMEOUT_MS);
    } catch (error) {
      result = {
        ok: false,
        version: "unknown",
        restarted: false,
        restart_failed: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    if (disposed.current) return;
    if (!result?.ok) {
      setState((s) => ({ ...s, phase: "error", message: result?.message ?? null, errorCode: null }));
      return;
    }
    if (result.restarted) {
      // Rust 已 spawn 新进程但端口未必就绪：轮询 /api/home（绕过 SW offline
      // fallback）直到响应，再整页刷新加载新版本。
      setState((s) => ({ ...s, phase: "restarting", current: result!.version || s.current }));
      const startedAt = Date.now();
      while (!disposed.current && Date.now() - startedAt < HEALTH_POLL_MAX_MS) {
        await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
        try {
          // 单次探测限时：防 TCP 已接受但不响应的挂死连接把轮询拖过 180s 上限
          await fetch("/api/home", { cache: "no-store", signal: AbortSignal.timeout(5_000) });
          if (disposed.current) return;
          setState((s) => ({ ...s, phase: "reloading" }));
          // 给 React 一帧渲染「正在刷新页面…」，随后整页重载
          setTimeout(() => window.location.reload(), 300);
          return;
        } catch {
          // 服务未就绪，继续轮询
        }
      }
      if (!disposed.current) {
        setState((s) => ({ ...s, phase: "error", errorCode: "reload-timeout" }));
      }
      return;
    }
    // restarted=false：非本应用启动的服务仍在运行（或未运行已代为启动失败
    // 走 error 分支），新版本已装好，下次启动生效。
    setState((s) => ({
      ...s,
      phase: "done",
      current: result!.version || s.current,
      latest: null,
      message: result!.message,
    }));
  }, [state]);

  return { state, check, upgrade };
}
