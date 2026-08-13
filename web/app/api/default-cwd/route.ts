import { NextResponse } from "next/server";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { allowFileRoot } from "@/lib/file-access";
import { gatewayConfig } from "@/lib/gateway-client"; // PowerI 网关模式（ticket 04）

// POST /api/default-cwd
// Creates ~/pi-cwd-<YYYYMMDD> if it doesn't exist and returns the path.
export async function POST() {
  // PowerI 网关模式（ticket 04）：真实工作区在 worker PVC，缺省即网关工作区
  if (gatewayConfig.enabled) {
    return NextResponse.json({ cwd: gatewayConfig.workspace });
  }
  try {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const dir = join(homedir(), `pi-cwd-${date}`);
    mkdirSync(dir, { recursive: true });
    allowFileRoot(dir);
    return NextResponse.json({ cwd: dir });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
