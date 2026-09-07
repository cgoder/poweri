// 包更新检测的客户端安全共享层:类型 + 纯匹配函数,零 SDK/Node 依赖。
// 客户端组件必须从这里 import(包更新检测的 SDK 调用在 package-update-service.ts,
// 那个模块顶部引 SDK 会拉入 child_process,客户端打包会炸——与 subscription-url 拆分同理)。

/** 与 pi TUI 启动横幅同链路的检测结果形状(仅含有可用更新的包)。 */
export interface PackageUpdatesResult {
  updates: Array<{
    source: string;
    displayName: string;
    type: "npm" | "git";
    scope: string;
  }>;
  summary: { outdated: number };
  checkedAt: number;
  error?: string;
}

/**
 * 包/技能检测数据变更的全局事件名:任意面板 force 重拉成功后 dispatch,
 * AppShell 顶栏角标监听后用普通 fetch 重查(读刚刷新的服务端缓存,零网络)。
 */
export const PACKAGE_UPDATES_CHANGED_EVENT = "poweri:pkg-updates-changed";

/**
 * 判断某个已安装包 source 是否命中"有可用更新"名单。
 * source 形态可能带版本锁定(npm:foo@1.2.3)或前缀差异,由调用方传入规范化比对函数
 * (packages-catalog 的 isSamePackage,与 PowerIPluginsConfig 现有匹配逻辑同口径)。
 */
export function isPackageUpdateAvailable(
  pkgSource: string,
  updates: Array<Pick<PackageUpdatesResult["updates"][number], "source" | "displayName">>,
  isSame: (a: string, b: string) => boolean,
): boolean {
  return updates.some((u) => isSame(u.source, pkgSource) || isSame(u.displayName, pkgSource));
}
