import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getPackageUpdates } from "@/poweri/lib/package-update-service";

export const dynamic = "force-dynamic";

// GET /poweri/api/plugins/updates?cwd=<path>[&force=1]
// 包更新检测:复用 SDK DefaultPackageManager.checkForAvailableUpdates()(与 pi TUI 启动横幅
// 同一链路:npm view + semver / git ls-remote),服务端 TTL 缓存(10 分钟)内零网络。
// 响应仅含"有可用更新"的包列表;plugins 面板 badge、skills 菜单包映射、顶栏全局徽标共用。
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd") || process.cwd();
  const force = searchParams.get("force") === "1";

  try {
    const result = await getPackageUpdates(cwd, { force });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// 无写操作;保留 POST 校验以免误用
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  return NextResponse.json({ error: "unsupported" }, { status: 405 });
}
