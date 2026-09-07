import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { fetchGatewaySessionMessages, fetchGatewayUsage, gatewayConfig } from "@/lib/gateway-client";
import { resolveSessionPath } from "@/lib/session-reader";
import { computeSessionTotalActiveMs } from "@/lib/session-timing";

export const dynamic = "force-dynamic";

/**
 * PowerI product-layer API: offline session statistics for the
 * "历史会话" view (F6). Replicates pi's live `get_session_stats`
 * (dist/core/agent-session.js getSessionStats) from the session file
 * directly, so any historical session can be inspected without an
 * AgentSession wrapper. `contextUsage` is runtime state and is omitted
 * offline.
 */

type UsageLike = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
};

function addUsage(totals: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }, usage: UsageLike | undefined) {
  if (!usage) return;
  totals.input += usage.input ?? 0;
  totals.output += usage.output ?? 0;
  totals.cacheRead += usage.cacheRead ?? 0;
  totals.cacheWrite += usage.cacheWrite ?? 0;
  totals.cost += usage.cost?.total ?? 0;
}

function numeric(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function gatewayRecordTokens(usage: Record<string, number | undefined> | null | undefined): number {
  const total = numeric(usage?.totalTokens);
  if (total > 0) return total;
  return ["input", "output", "cacheRead", "cacheWrite", "reasoning"]
    .reduce((sum, key) => sum + numeric(usage?.[key]), 0);
}

async function gatewaySessionStats(id: string): Promise<NextResponse> {
  const [remote, history] = await Promise.all([
    fetchGatewayUsage(),
    fetchGatewaySessionMessages(id),
  ]);
  if (remote.status !== 200) {
    return NextResponse.json(
      { error: `Gateway usage unavailable (HTTP ${remote.status})` },
      { status: remote.status === 401 ? 401 : 502 },
    );
  }
  if (history.status === 404) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (history.status !== 200 || !history.messages) {
    return NextResponse.json(
      { error: `Gateway session unavailable (HTTP ${history.status})` },
      { status: history.status === 401 ? 401 : 502 },
    );
  }

  const messages = history.messages;
  const records = remote.records.filter((record) => record.sessionId === id);
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  let tokens = 0;
  for (const record of records) {
    const usage = record.usage;
    totals.input += numeric(usage?.input);
    totals.output += numeric(usage?.output);
    totals.cacheRead += numeric(usage?.cacheRead);
    totals.cacheWrite += numeric(usage?.cacheWrite);
    tokens += gatewayRecordTokens(usage);
  }

  let userMessages = 0;
  let assistantMessages = 0;
  let toolResults = 0;
  for (const message of messages) {
    if (message.role === "user") userMessages++;
    else if (message.role === "assistant") assistantMessages++;
    else if (message.role === "toolResult") toolResults++;
  }

  return NextResponse.json({
    ok: true,
    stats: {
      sessionFile: `/gateway/${id}.jsonl`,
      sessionId: id,
      userMessages,
      assistantMessages,
      // Gateway 的历史 DTO 已经是文本投影，工具调用明细不在该协议中；不伪造统计。
      toolCalls: 0,
      toolResults,
      totalMessages: messages.length,
      tokens: {
        input: totals.input,
        output: totals.output,
        cacheRead: totals.cacheRead,
        cacheWrite: totals.cacheWrite,
        total: tokens,
      },
      cost: totals.cost,
      totalActiveMs: 0,
    },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (gatewayConfig.enabled) return gatewaySessionStats(id);

  const resolvedPath = await resolveSessionPath(id);
  if (!resolvedPath) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    const sm = SessionManager.open(resolvedPath);
    const entries = sm.getEntries() as unknown as Array<{
      type: string;
      usage?: UsageLike;
      message?: {
        role?: string;
        content?: Array<{ type?: string }>;
        usage?: UsageLike;
      };
    }>;

    let userMessages = 0;
    let assistantMessages = 0;
    let toolResults = 0;
    let toolCalls = 0;
    let totalMessages = 0;
    const usageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

    for (const entry of entries) {
      if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
        addUsage(usageTotals, entry.usage);
      }
      if (entry.type !== "message") continue;
      totalMessages++;
      const message = entry.message;
      if (message?.role === "user") {
        userMessages++;
      } else if (message?.role === "toolResult") {
        toolResults++;
        addUsage(usageTotals, message.usage);
      } else if (message?.role === "assistant") {
        assistantMessages++;
        if (Array.isArray(message.content)) {
          toolCalls += message.content.filter((c) => c.type === "toolCall").length;
        }
        addUsage(usageTotals, message.usage);
      }
    }

    const totalActiveMs = computeSessionTotalActiveMs(entries as never);
    return NextResponse.json({
      ok: true,
      stats: {
        sessionFile: sm.getSessionFile() ?? resolvedPath,
        sessionId: id,
        sessionName: sm.getSessionName() || undefined,
        userMessages,
        assistantMessages,
        toolCalls,
        toolResults,
        totalMessages,
        tokens: {
          input: usageTotals.input,
          output: usageTotals.output,
          cacheRead: usageTotals.cacheRead,
          cacheWrite: usageTotals.cacheWrite,
          total: usageTotals.input + usageTotals.output + usageTotals.cacheRead + usageTotals.cacheWrite,
        },
        cost: usageTotals.cost,
        totalActiveMs,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Failed to read session: ${message}` }, { status: 500 });
  }
}
