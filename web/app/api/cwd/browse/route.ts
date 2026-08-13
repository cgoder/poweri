import { NextRequest, NextResponse } from "next/server";
import { stat } from "fs/promises";
import {
  getBrowseStartDirectory,
  getParentDirectory,
  listDirectories,
  listWindowsDrives,
  resolveDirectory,
  shouldShowWindowsDrivePicker,
} from "@/lib/directory-browser";
import { gatewayConfig } from "@/lib/gateway-client"; // PowerI 网关模式（ticket 05）

// GET /api/cwd/browse?path=...：列出文件系统中的可读子目录。
export async function GET(request: NextRequest) {
  // ── PowerI 网关模式（ticket 05）：工作区固定为 worker PVC（/workspace），宿主目录浏览一律拒绝（防宿主路径枚举）──
  if (gatewayConfig.enabled) {
    return NextResponse.json({ error: "网关模式工作区固定为 /workspace，不支持宿主目录浏览" }, { status: 400 });
  }
  try {
    const requested = request.nextUrl.searchParams.get("path")?.trim();

    if (shouldShowWindowsDrivePicker(requested)) {
      return NextResponse.json({
        path: "",
        parentPath: null,
        drives: await listWindowsDrives(),
        directories: [],
      });
    }

    const candidate = getBrowseStartDirectory(requested);

    let resolved: string;
    try {
      resolved = await resolveDirectory(candidate);
    } catch {
      return NextResponse.json({ error: "Directory does not exist" }, { status: 404 });
    }

    const directoryStat = await stat(resolved);
    if (!directoryStat.isDirectory()) {
      return NextResponse.json({ error: "Path is not a directory" }, { status: 400 });
    }

    const directories = await listDirectories(resolved);

    return NextResponse.json({
      path: resolved,
      parentPath: getParentDirectory(resolved),
      directories,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
