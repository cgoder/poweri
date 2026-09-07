// 包更新检测服务(服务端 only,禁止被客户端组件 import——依赖 SDK 的 fs/child_process)。
//
// 设计(2026-09 拍板:plugins/skills 更新提醒,面板内提示 + 全局徽标):
// - 复用 SDK DefaultPackageManager.checkForAvailableUpdates()——与 pi TUI 启动横幅完全同一条
//   检测链路(npm 源 = npm view + semver gt;git 源 = rev-parse vs ls-remote;跳过 local/pinned),
//   口径与 TUI 一致,不自行造 registry 查询。
// - 检测代价:每个 npm 包一次 `npm view` 进程(TUI 启动同样如此),因此结果做进程内 TTL 缓存,
//   面板打开 / 顶栏徽标 / 技能映射共用同一份缓存,窗口内零网络。
// - fail-soft:SDK 检测抛错时返回空结果并附 error,不炸调用方(UI 保留上一次缓存由调用方决定)。

import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { getProjectTrustStatus } from "@/lib/project-trust";
import type { PackageUpdatesResult } from "./package-update-shared";

// 客户端安全共享层 re-export:类型与纯匹配函数统一从这里可达(服务端调用方便利)
export type { PackageUpdatesResult } from "./package-update-shared";
export { isPackageUpdateAvailable } from "./package-update-shared";

/** TTL 窗口:与 PowerI skills 订阅同步 TTL 一致(10 分钟),窗口内重复请求零网络。 */
export const PACKAGE_UPDATES_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  result: PackageUpdatesResult;
  expiresAt: number;
}

// 模块级缓存:Next.js dev/prod 的 API 路由模块实例跨请求存活,进程内共享
const cacheByCwd = new Map<string, CacheEntry>();

/** 测试钩子:清空缓存(TTL 语义不进单测,避免 sleep)。 */
export function clearPackageUpdatesCacheForTests(): void {
  cacheByCwd.clear();
}

export interface PackageUpdatesFetcherResult {
  updates: Array<{ source: string; displayName: string; type: "npm" | "git"; scope: string }>;
}

/** 供单测注入的 SDK 调用形状(避免测试真的 spawn npm)。 */
export type PackageUpdatesFetcher = (cwd: string) => Promise<PackageUpdatesFetcherResult["updates"]>;

async function fetchUpdatesViaSdk(cwd: string): Promise<PackageUpdatesResult["updates"]> {
  const agentDir = getAgentDir();
  const projectTrust = getProjectTrustStatus(cwd, agentDir);
  const settingsManager = SettingsManager.create(cwd, agentDir, {
    projectTrusted: projectTrust.trusted,
  });
  const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  return packageManager.checkForAvailableUpdates();
}

/**
 * 查询包更新(TTL 缓存优先)。
 * @param opts.force 跳过缓存强制检测(面板手动"重新检查"用)
 * @param opts.now   测试注入时钟
 * @param opts.fetcher 测试注入 SDK 调用
 */
export async function getPackageUpdates(
  cwd: string,
  opts: { force?: boolean; now?: () => number; fetcher?: PackageUpdatesFetcher } = {},
): Promise<PackageUpdatesResult> {
  const now = opts.now ?? Date.now;
  const fetcher = opts.fetcher ?? fetchUpdatesViaSdk;
  const cached = cacheByCwd.get(cwd);
  if (!opts.force && cached && cached.expiresAt > now()) {
    return cached.result;
  }
  try {
    const updates = await fetcher(cwd);
    const result: PackageUpdatesResult = {
      updates,
      summary: { outdated: updates.length },
      checkedAt: now(),
    };
    cacheByCwd.set(cwd, { result, expiresAt: now() + PACKAGE_UPDATES_TTL_MS });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // fail-soft:失败不缓存(下次请求重试),调用方拿到空结果 + error 说明
    return { updates: [], summary: { outdated: 0 }, checkedAt: now(), error: message };
  }
}
