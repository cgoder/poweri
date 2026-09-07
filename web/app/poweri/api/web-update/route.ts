import { NextResponse } from "next/server";
import { isNewerStableVersion } from "@/lib/app-update";

/**
 * PowerI Web 版本检查（纯浏览器模式）。
 *
 * 上游 /api/app-update 查询的是 `@agegr/pi-web`（上游包），对 PowerI fork 而
 * 言数据不对，且属上游文件不可修改；本路由按同一模式查询 `@agegr/pi-web`。
 * 壳（Tauri）模式不走这里——壳经 `check_update`（commands.rs）用 `npm view`
 * 探测并缓存 12h，两条路径由 poweri/hooks/useAppUpdate.ts 归一。
 *
 * `?force=1` 跳过缓存重查（设置面板的「检查更新」按钮）。幂等且无副作用；
 * 结果仅含版本号与检查时刻，不含任何用户数据。
 */
export const dynamic = "force-dynamic";

const CURRENT_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
const NPM_LATEST_URL = "https://registry.npmjs.org/@agegr%2Fpi-web/latest";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;
const SKIP_VERSION_CHECK = process.env.PI_WEB_SKIP_VERSION_CHECK === "1";

/** 镜像 poweri/hooks/useAppUpdate.ts 的 WebUpdateInfo。 */
interface WebUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  /** 服务端完成本次检查的时刻（ISO），供「X 前检查」展示。 */
  checkedAt: string;
}

interface WebUpdateCache {
  value?: WebUpdateInfo;
  expiresAt: number;
  inFlight?: Promise<WebUpdateInfo>;
}

declare global {
  var __poweriWebUpdateCache: WebUpdateCache | undefined;
}

function getCache(): WebUpdateCache {
  return (globalThis.__poweriWebUpdateCache ??= { expiresAt: 0 });
}

async function fetchLatestVersion(): Promise<WebUpdateInfo> {
  const response = await fetch(NPM_LATEST_URL, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);

  const body = (await response.json()) as { version?: unknown };
  const latestVersion = typeof body.version === "string" ? body.version : "";
  if (!latestVersion) throw new Error("npm registry returned an invalid version");

  return {
    currentVersion: CURRENT_VERSION,
    latestVersion,
    updateAvailable: isNewerStableVersion(latestVersion, CURRENT_VERSION),
    checkedAt: new Date().toISOString(),
  };
}

async function loadUpdateStatus(force: boolean): Promise<WebUpdateInfo> {
  const cache = getCache();
  if (!force && cache.value && cache.expiresAt > Date.now()) return cache.value;
  if (!cache.inFlight) {
    cache.inFlight = fetchLatestVersion()
      .then((value) => {
        cache.value = value;
        cache.expiresAt = Date.now() + CACHE_TTL_MS;
        return value;
      })
      .finally(() => {
        cache.inFlight = undefined;
      });
  }

  try {
    return await cache.inFlight;
  } catch (error) {
    // 探测失败时回退到旧缓存（与上游 /api/app-update 行为一致）；
    // 没有 old value 则向上抛 → 502。
    if (cache.value) return cache.value;
    throw error;
  }
}

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (SKIP_VERSION_CHECK) {
    return NextResponse.json({
      currentVersion: CURRENT_VERSION,
      latestVersion: CURRENT_VERSION,
      updateAvailable: false,
      checkedAt: new Date().toISOString(),
    } satisfies WebUpdateInfo);
  }
  try {
    return NextResponse.json(await loadUpdateStatus(force));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
