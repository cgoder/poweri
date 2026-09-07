import { NextResponse } from "next/server";
import { summarizeBySession, summarizeGatewayBySession } from "@/poweri/lib/usage-stats";
import { fetchGatewayUsage, gatewayConfig } from "@/lib/gateway-client";

export const dynamic = "force-dynamic";

/**
 * PowerI product-layer API: per-session token/message totals for the
 * "历史会话" list (F6). Reuses the usage aggregation's file cache, so it
 * is cheap after a usage fetch and needs no per-session RPC.
 */
export async function GET() {
  try {
    if (gatewayConfig.enabled) {
      const remote = await fetchGatewayUsage();
      if (remote.status !== 200) {
        return NextResponse.json(
          { error: `Gateway usage unavailable (HTTP ${remote.status})` },
          { status: remote.status === 401 ? 401 : 502 },
        );
      }
      return NextResponse.json({ ok: true, sessions: summarizeGatewayBySession(remote.records) });
    }

    const sessions = await summarizeBySession();
    return NextResponse.json({ ok: true, sessions });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Failed to summarize sessions: ${message}` }, { status: 500 });
  }
}
