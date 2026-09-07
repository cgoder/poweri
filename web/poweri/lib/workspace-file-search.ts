/**
 * PowerI 产品层：工作区 basename 搜索（服务端，fs 同步）
 *
 * 在给定 cwd 下递归查找与 basename 精确匹配的文件。
 * 用于点击兜底：`installer.rs` 在 cwd 根不存在时，若工作区内唯一存在
 * `src-tauri/src/installer.rs` 则自动打开它。
 */
import fs from "fs";
import os from "os";
import path from "path";

/**
 * 把 markdown 链接解析出的 "<cwd>/~/.poweri/settings.json" 假路径还原为
 * homedir 绝对路径。resolveLocalFileHref（上游）把 `~` 当普通相对段拼接，
 * 这里做服务端兜底展开：`/Users/a/b/~/.poweri/x` → `~/.poweri/x` 展开为 home。
 * 仅在展开后文件真实存在时返回，否则返回 null。
 */
export function expandTildeFakePath(filePath: string): string | null {
  let expanded: string | null = null;
  if (filePath.startsWith("~/")) {
    expanded = path.join(os.homedir(), filePath.slice(2));
  } else {
    const tildeIdx = filePath.indexOf("/~");
    if (tildeIdx !== -1) {
      expanded = path.join(os.homedir(), filePath.slice(tildeIdx + 2));
    }
  }
  if (!expanded) return null;
  return fs.existsSync(expanded) ? expanded : null;
}

const IGNORED_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
  "target", "vendor", ".DS_Store", ".git",
  // PowerI scratch / temp 产物不参与兜底，避免歧义
  "temp", "temp.bak", ".scratch", ".playwright-mcp",
]);
const IGNORED_SUFFIXES = [".pyc"];

// 找到 2 个即停止：只关心 0 / 1 / 多个
const MAX_CANDIDATES = 2;

export function findFilesByBasename(cwd: string, basename: string): string[] {
  const results: string[] = [];
  const stack: string[] = [cwd];
  const useCaseInsensitive = /^[a-zA-Z]:[\\/]/.test(cwd);

  const equalsBasename = useCaseInsensitive
    ? (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
    : (a: string, b: string) => a === b;

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (IGNORED_NAMES.has(name)) continue;
      if (IGNORED_SUFFIXES.some((s) => name.endsWith(s))) continue;

      const fullPath = path.join(dir, name);

      // 符号链接：不追踪目录符号链接，避免循环；文件符号链接按文件处理
      let isDir = false;
      let isFile = false;
      try {
        if (entry.isSymbolicLink()) {
          // 按 lstat 判断目标类型，但不递归进入链接目录
          const stat = fs.statSync(fullPath);
          isDir = false;
          isFile = stat.isFile();
        } else {
          isDir = entry.isDirectory();
          isFile = entry.isFile();
        }
      } catch {
        continue;
      }

      if (isFile && equalsBasename(name, basename)) {
        results.push(fullPath);
        if (results.length >= MAX_CANDIDATES) return results;
      } else if (isDir) {
        stack.push(fullPath);
      }
    }
  }
  return results;
}
