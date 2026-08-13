import { NextResponse } from "next/server";
import { readModelsConfig, writeModelsConfig } from "@/lib/models-config-store";
import { gatewayConfig, GW_MODEL } from "@/lib/gateway-client"; // PowerI 网关模式（ticket 04）

export const dynamic = "force-dynamic";

export async function GET() {
  // PowerI 网关模式（ticket 04）：模型配置只读展示 worker 真实状态（平台单一模型 poweri-gw/agent），宿主不可编辑
  if (gatewayConfig.enabled) {
    return NextResponse.json({
      providers: {
        "poweri-gw": {
          name: "poweri-gw",
          baseUrl: gatewayConfig.baseUrl,
          api: "openai-completions",
          models: [{ id: GW_MODEL.id, name: "poweri-gw/agent" }],
        },
      },
    });
  }
  return NextResponse.json(readModelsConfig());
}

export async function PUT(req: Request) {
  // PowerI 网关模式：只读——worker 的 models.json 由部署链（gen-k8s/seed）管理，禁止在宿主编辑
  if (gatewayConfig.enabled) {
    return NextResponse.json({ error: "Gateway mode is read-only" }, { status: 403 });
  }
  try {
    const body = await req.json() as Record<string, unknown>;
    writeModelsConfig(body);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
