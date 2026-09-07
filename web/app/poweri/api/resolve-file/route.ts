import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";
import { getFileName } from "@/lib/file-paths";
import { findFilesByBasename, expandTildeFakePath } from "@/poweri/lib/workspace-file-search";

export const dynamic = "force-dynamic";

/**
 * PowerI product-layer API: basename 兜底解析
 *
 * GET /poweri/api/resolve-file?cwd=/a/b&path=/a/b/installer.rs
 *
 * - 若 path 指向的文件已存在 → 直接返回 path（命中）
 * - 否则在 cwd 递归查找与 basename 同名的文件：
 *   - 唯一命中 → 返回该完整路径
 *   - 0 命中或多命中 → 返回 null + candidates 供调用方决定
 */
export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd");
    const filePath = request.nextUrl.searchParams.get("path");

    if (!cwd || !filePath) {
      return NextResponse.json({ error: "cwd and path are required" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots) || !isFilePathAllowed(filePath, allowedRoots)) {
      // filePath 可能在 cwd 外的唯一命中也应受控；先按 cwd 授权
      if (!isFilePathAllowed(cwd, allowedRoots)) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
    }

    // 原路径已存在：直接命中
    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        return NextResponse.json({ resolvedPath: filePath, candidates: [filePath], hit: true });
      }
    } catch {
      // 不存在，继续兜底搜索
    }

    // `~` 前缀的 markdown 链接：展开为 homedir 真实路径
    const tildeExpanded = expandTildeFakePath(filePath);
    if (tildeExpanded) {
      return NextResponse.json({ resolvedPath: tildeExpanded, candidates: [tildeExpanded], hit: true });
    }

    const basename = getFileName(filePath);
    if (!basename || basename === filePath) {
      return NextResponse.json({ resolvedPath: null, candidates: [], hit: false });
    }

    const candidates = findFilesByBasename(cwd, basename);
    if (candidates.length === 1) {
      const resolved = candidates[0];
      if (!isFilePathAllowed(resolved, allowedRoots)) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
      return NextResponse.json({ resolvedPath: resolved, candidates, hit: true });
    }

    return NextResponse.json({ resolvedPath: null, candidates, hit: false });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
