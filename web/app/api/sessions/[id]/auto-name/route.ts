import { NextResponse } from "next/server";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { generateSessionTitle } from "@/lib/session-title";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { invalidateSessionListCache, resolveSessionPath } from "@/lib/session-reader";
import { gatewayConfig, fetchGatewaySessionMessages } from "@/lib/gateway-client"; // PowerI 网关模式（ticket 05）

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // ── PowerI 网关模式（ticket 05）：worker 无会话命名 API，用首条用户消息派生标题（本地生成，不走模型）──
  if (gatewayConfig.enabled) {
    try {
      const { status, messages } = await fetchGatewaySessionMessages(id);
      if (status !== 200 || !messages) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      const firstUser = messages.find((m) => m.role === "user");
      const title = (firstUser?.text ?? "新会话").replace(/\s+/g, " ").trim().slice(0, 40);
      return NextResponse.json({ title });
    } catch (error) {
      return NextResponse.json({ error: String(error) }, { status: 500 });
    }
  }

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const existing = getRpcSession(id);
    const { session } = existing?.isAlive()
      ? { session: existing }
      : await startRpcSession(id, filePath, undefined);

    // globalThis keeps wrappers alive across dev hot reloads; older instances
    // may predate waitUntilReady(), but those have already completed startup.
    await session.waitUntilReady?.();
    const result = await generateSessionTitle(session.inner as unknown as AgentSession);

    if (!session.isAlive()) {
      return NextResponse.json(
        { error: "The session was closed while its title was being generated. Please try again." },
        { status: 409 },
      );
    }

    session.inner.setSessionName(result.title);
    invalidateSessionListCache();
    return NextResponse.json({ title: result.title, usage: result.usage ?? null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
