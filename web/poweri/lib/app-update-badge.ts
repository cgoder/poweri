/**
 * 应用本体（poweri-web）更新检测结果的客户端共享层——设置入口升级圆点的唯一数据源。
 *
 * 背景：`useAppUpdate`（poweri/hooks/useAppUpdate.ts）是自包含状态机，只服务
 * 设置 → 通用 →「版本与更新」区块；检测结果不外泄导致设置入口/常规 tab 永远
 * 无法示意「有新版」。本模块把它镜像成一处可订阅的轻量状态：
 *
 * - VersionUpdateSection 挂载/手动检查/升级后经 useAppUpdate 的镜像 effect 写入；
 * - AppShell（设置按钮圆点）与 SettingsPanel（常规 tab 圆点）经
 *   useSyncExternalStore 读同一 module 单例——同页面同 bundle，单例即全局；
 * - 面板未打开时由 AppShell 的守护实例（autoCheckDelayMs 空闲延迟）触发首次
 *   检测，壳模式命中 Rust 12h 缓存 / 浏览器模式命中服务端 12h 缓存，零网络。
 *
 * react-free（node 单测可直接 import）；检查失败 fail-soft（圆点是增强提示，
 * 不打扰），dev 模式 checked=true 且 updateAvailable=false（与设置页一致不检查）。
 */

/** 与 UpdateMode in poweri/hooks/useAppUpdate.ts 同义（此处自带定义保持零依赖）。 */
export type AppUpdateBadgeMode = "shell" | "browser" | "dev";

export type AppUpdateBadgeState = {
  /** 是否已有一次可信检测结果（false = 尚未检测或检测中，圆点一律不显示）。 */
  checked: boolean;
  /** npm 上存在比当前运行版本更新的稳定版。 */
  updateAvailable: boolean;
  /** 新版本号（无点号 v 前缀），供 title「发现新版本 {version}」。 */
  latest: string | null;
  mode: AppUpdateBadgeMode | null;
};

const INITIAL: AppUpdateBadgeState = {
  checked: false,
  updateAvailable: false,
  latest: null,
  mode: null,
};

let state: AppUpdateBadgeState = INITIAL;

const listeners = new Set<() => void>();

export function getAppUpdateBadgeState(): AppUpdateBadgeState {
  return state;
}

/**
 * 整体替换状态并广播。入参必须是新建对象（getSnapshot 引用稳定性语义）。
 * 任意调用点（设置页检查/升级、AppShell 守护检测）写入后，所有圆点同步跟随。
 */
export function setAppUpdateBadgeState(next: AppUpdateBadgeState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** 测试隔离：恢复初始状态并清空订阅者。 */
export function resetAppUpdateBadgeForTests(): void {
  state = INITIAL;
  listeners.clear();
}

/** SSR 稳定快照（useSyncExternalStore 的 getServerSnapshot）：恒为初始态，引用稳定。 */
export function getInitialAppUpdateBadgeState(): AppUpdateBadgeState {
  return INITIAL;
}

export function subscribeAppUpdateBadge(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 从 useAppUpdate 的 AppUpdateState 片段推导圆点状态（纯函数，单测覆盖）。
 *
 * 规则：
 * - loading（模式未定/首查未回）：checked=false，不示意；
 * - dev：checked=true 且永不示意（开发模式不检查，与设置页口径一致）；
 * - idle/checking 及检测失败：latest 保留旧值——曾查到过新版就继续示意
 *   （失败不覆盖已有的好答案，与 Rust 侧探测失败不清缓存的取舍一致）；
 * - done（已安装未重启）：latest 已被清空 → 圆点消失。
 */
export function deriveAppUpdateBadge(
  phase: string,
  mode: AppUpdateBadgeMode | null,
  latest: string | null,
): AppUpdateBadgeState {
  if (phase === "loading") {
    return { checked: false, updateAvailable: false, latest: null, mode: null };
  }
  if (mode === "dev") {
    return { checked: true, updateAvailable: false, latest: null, mode };
  }
  const updateAvailable = latest != null && latest !== "";
  return { checked: true, updateAvailable, latest: updateAvailable ? latest : null, mode };
}
