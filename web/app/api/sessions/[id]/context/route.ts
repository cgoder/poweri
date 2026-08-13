import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveSessionPath, buildSessionContext } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { gatewayConfig, gatewayHistoryContext } from "@/lib/gateway-client"; // PowerI 网关模式（ticket 05）

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // ── PowerI 网关模式（ticket 05）：上下文来自网关历史（worker PVC），无本地 entries ──
  if (gatewayConfig.enabled) {
    try {
      const context = await gatewayHistoryContext(id);
      if (!context) return NextResponse.json({ error: "Session not found" }, { status: 404 });
      return NextResponse.json({ context });
    } catch (error) {
      return NextResponse.json({ error: String(error) }, { status: 500 });
    }
  }

  const url = new URL(req.url);
  const leafId = url.searchParams.get("leafId") ?? undefined;
  const deferThinking = url.searchParams.has("deferThinking");
  const deferToolResultImages = url.searchParams.has("deferMedia");

  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const filePath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sm = liveRpc?.inner.sessionManager ?? SessionManager.open(filePath!);
    const context = buildSessionContext(sm.getEntries() as never, leafId, {
      deferThinking,
      deferToolResultImages,
    });

    return NextResponse.json({ context });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
