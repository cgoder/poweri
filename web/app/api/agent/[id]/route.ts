import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { startRpcSession, getRpcSession, setRpcSessionTools } from "@/lib/rpc-manager";
import { gatewayConfig, GatewayAuthError, isGatewaySessionOwner, GatewaySessionClient, isGatewayCommandSupported } from "@/lib/gateway-client"; // PowerI 网关模式（ticket 04）

// POST /api/agent/[id] - Send a command to an existing session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let commandType: string | undefined;
  let promptAccepted = false;

  try {
    const body = await req.json() as { type: string; [key: string]: unknown };
    commandType = typeof body.type === "string" ? body.type : undefined;
    const requestedToolNames = body.toolNames;
    if (
      requestedToolNames !== undefined
      && (!Array.isArray(requestedToolNames) || requestedToolNames.some((name) => typeof name !== "string"))
    ) {
      throw new Error("toolNames must be an array of strings");
    }
    const toolNames = requestedToolNames as string[] | undefined;

    // Fast path: already-running session
    const existing = getRpcSession(id);
    if (body.type === "set_tools" && gatewayConfig.enabled) {
      // Gateway/worker 尚未暴露工具预设变更 API；绝不能回退到 web 宿主的本地 session。
      // 否则同一 ID 命中旧 registry 时会绕过 worker 归属校验并修改本地 AgentSession。
      if (existing?.isAlive()) {
        const gw = existing as unknown as GatewaySessionClient;
        if (!(await isGatewaySessionOwner(gw))) {
          return NextResponse.json({ error: "Session not found" }, { status: 404 });
        }
      }
      return NextResponse.json({ error: "Tool selection is unavailable in gateway mode" }, { status: 501 });
    }
    if (gatewayConfig.enabled && !isGatewayCommandSupported(body.type)) {
      return NextResponse.json({ error: `Gateway command '${String(body.type)}' is not implemented` }, { status: 501 });
    }
    if (body.type === "set_tools") {
      const filePath = existing?.sessionFile || await resolveSessionPath(id) || undefined;
      if (!existing?.isAlive() && !filePath) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      const changed = await setRpcSessionTools(id, filePath, toolNames);
      return NextResponse.json({
        success: true,
        data: { sessionId: changed.sessionId, recreated: changed.recreated },
      });
    }
    if (existing?.isAlive()) {
      // PowerI 网关模式（ticket 04）：跨用户隔离——请求者不是会话所有者则拒绝（registry 单实例共享）
      if (gatewayConfig.enabled) {
        const gw = existing as unknown as GatewaySessionClient;
        if (!(await isGatewaySessionOwner(gw))) {
          return NextResponse.json({ error: "Session not found" }, { status: 404 });
        }
      }
      const result = await existing.send(body);
      promptAccepted = body.type === "prompt";
      return NextResponse.json({
        success: true,
        data: result,
        ...(gatewayConfig.enabled ? { sessionId: (existing as unknown as GatewaySessionClient).sessionId } : {}),
      });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({
        error: "Session not found",
        ...(body.type === "prompt"
          ? { code: "prompt_rejected", accepted: false }
          : {}),
      }, { status: 404 });
    }

    const { session } = await startRpcSession(id, filePath, undefined, {
      ...(toolNames !== undefined ? { toolNames } : {}),
    });
    const result = await session.send(body);
    promptAccepted = body.type === "prompt";

    return NextResponse.json({
      success: true,
      data: result,
      ...(gatewayConfig.enabled ? { sessionId: (session as unknown as GatewaySessionClient).sessionId } : {}),
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      ...(commandType === "prompt" && !promptAccepted
        ? { code: "prompt_rejected", accepted: false }
        : {}),
    }, { status: error instanceof GatewayAuthError ? error.status : 500 });
  }
}

// GET /api/agent/[id] - Get current agent state
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    if (gatewayConfig.enabled) {
      const session = getRpcSession(id);
      if (!session || !session.isAlive()) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      const gatewaySession = session as unknown as GatewaySessionClient;
      if (!(await isGatewaySessionOwner(gatewaySession))) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      const state = await session.send({ type: "get_state" });
      return NextResponse.json({ running: true, state });
    }

    const session = getRpcSession(id);
    if (!session || !session.isAlive()) {
      return NextResponse.json({ running: false });
    }

    const state = await session.send({ type: "get_state" });
    return NextResponse.json({ running: true, state });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: error instanceof GatewayAuthError ? error.status : 500 });
  }
}
