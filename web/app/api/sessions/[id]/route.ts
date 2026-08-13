import { NextResponse } from "next/server";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  resolveSessionPath,
  resolveSessionIdByPath,
  invalidateSessionPathCache,
  invalidateSessionListCache,
  buildSessionContext,
  readSessionHeader,
} from "@/lib/session-reader";
import { sessionPathKey } from "@/lib/session-path";
import { getRpcSession } from "@/lib/rpc-manager";
import { projectTreeForResponse } from "@/lib/project-tree";
import { computeSessionTotalActiveMs } from "@/lib/session-timing";
import {
  gatewayConfig,
  fetchGatewaySessions,
  gatewayHistoryContext,
  gatewaySessionToInfo,
  fetchGatewaySessionRename,
  fetchGatewaySessionDelete,
} from "@/lib/gateway-client"; // PowerI 网关模式（ticket 04/05）

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // ── PowerI 网关模式（ticket 04）：历史来自网关 /v1/sessions/<id>/messages，不再读本地会话文件 ──
  if (gatewayConfig.enabled) {
    const context = await gatewayHistoryContext(id);
    if (!context) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const gwSessions = await fetchGatewaySessions();
    const entry = gwSessions.find((s) => s.id === id);
    const info = entry
      ? { ...gatewaySessionToInfo(entry), id, messageCount: Number(entry.messageCount ?? context.messages.length) }
      : null;
    return NextResponse.json({
      sessionId: id,
      filePath: `/gateway/${id}.jsonl`,
      info,
      leafId: context.entryIds.length ? context.entryIds[context.entryIds.length - 1] : undefined,
      tree: [],
      context,
    });
  }
  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const resolvedPath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !resolvedPath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sm = liveRpc?.inner.sessionManager ?? SessionManager.open(resolvedPath!);
    const filePath = liveRpc?.sessionFile || sm.getSessionFile() || resolvedPath || "";
    const entries = sm.getEntries();
    const leafId = sm.getLeafId();
    const tree = projectTreeForResponse(sm.getTree());
    const searchParams = new URL(req.url).searchParams;
    const deferThinking = searchParams.has("deferThinking");
    const deferToolResultImages = searchParams.has("deferMedia");
    const context = buildSessionContext(entries as never, leafId, { deferThinking, deferToolResultImages });
    const totalActiveMs = computeSessionTotalActiveMs(entries);

    const header = sm.getHeader();
    let modified = header?.timestamp ?? new Date().toISOString();
    try { modified = statSync(filePath).mtime.toISOString(); } catch { /* use header timestamp */ }
    const parentSessionId = header?.parentSession
      ? await resolveSessionIdByPath(header.parentSession)
      : undefined;
    const info = header ? {
      path: filePath,
      id: header.id,
      cwd: header.cwd ?? "",
      name: sm.getSessionName(),
      created: header.timestamp,
      modified,
      messageCount: context.messages.length,
      firstMessage: context.messages.find((m) => m.role === "user")
        ? (() => {
            const msg = context.messages.find((m) => m.role === "user")!;
            const c = (msg as { content: unknown }).content;
            return typeof c === "string" ? c : (Array.isArray(c) ? (c.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "" : "") || "(no messages)";
          })()
        : "(no messages)",
      parentSessionId,
      transient: !filePath || !existsSync(filePath),
    } : null;

    return NextResponse.json({
      sessionId: id,
      filePath,
      info,
      leafId,
      tree,
      context,
      totalActiveMs,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH /api/sessions/[id]  body: { name: string }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { name } = await req.json() as { name?: string };
    if (typeof name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    // ── PowerI 网关模式（ticket 05）：改名写入 worker PVC（网关 → bridge 追加 session_info）──
    if (gatewayConfig.enabled) {
      const { status } = await fetchGatewaySessionRename(id, name.trim());
      if (status === 404) return NextResponse.json({ error: "Session not found" }, { status: 404 });
      if (status !== 200) return NextResponse.json({ error: `gateway rename HTTP ${status}` }, { status: 502 });
      invalidateSessionListCache();
      return NextResponse.json({ ok: true });
    }
    const filePath = await resolveSessionPath(id);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/sessions/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // ── PowerI 网关模式（ticket 05）：删除 worker PVC 上的会话 JSONL（网关 → bridge）──
    if (gatewayConfig.enabled) {
      const { status } = await fetchGatewaySessionDelete(id);
      if (status === 404) return NextResponse.json({ error: "Session not found" }, { status: 404 });
      if (status !== 200) return NextResponse.json({ error: `gateway delete HTTP ${status}` }, { status: 502 });
      await getRpcSession(id)?.shutdown();
      invalidateSessionListCache();
      return NextResponse.json({ ok: true });
    }
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Read only the bounded header before deleting.
    const parentSessionPath = readSessionHeader(filePath)?.parentSession;

    // Re-attach all direct children to this session's parent (cascade re-parent)
    // Scan sibling files in the same directory
    const targetPathKey = sessionPathKey(filePath);
    const dir = dirname(filePath);
    try {
      const files = readdirSync(dir).filter(
        (file) => file.endsWith(".jsonl") && sessionPathKey(join(dir, file)) !== targetPathKey,
      );
      for (const file of files) {
        const childPath = join(dir, file);
        try {
          const content = readFileSync(childPath, "utf8");
          const lines = content.split("\n");
          const header = JSON.parse(lines[0]) as { type?: string; parentSession?: string };
          if (
            header.type === "session" &&
            header.parentSession &&
            sessionPathKey(header.parentSession) === targetPathKey
          ) {
            // Rewrite header with new parentSession
            header.parentSession = parentSessionPath;
            lines[0] = JSON.stringify(header);
            writeFileSync(childPath, lines.join("\n"));
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* skip if dir unreadable */ }

    await getRpcSession(id)?.shutdown();
    unlinkSync(filePath);
    invalidateSessionPathCache(id);
    invalidateSessionListCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
