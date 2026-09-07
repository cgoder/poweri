import { realpathSync } from "fs";
import path from "path";
import { isWindowsAbsolutePath } from "./paths";

/**
 * UNC hosts that denote the same share. Windows exposes the WSL filesystem
 * under both `\\wsl$\...` and `\\wsl.localhost\...`; realpath output and
 * user-typed roots may use either form, so they must compare equal.
 */
function normalizeUncHost(p: string): string {
  return p.replace(/^([\\/]{2})wsl\.localhost([\\/]|$)/i, "$1wsl$$$2");
}

/**
 * Lexical containment check. Accepts either canonical form on both sides: it
 * re-resolves through path.win32/path.posix and case-folds on Windows, so
 * separator style and drive-letter case never decide the answer.
 */
export function isPathWithinRoots(target: string, roots: Set<string>): boolean {
  for (const root of roots) {
    const useWindowsRules = isWindowsAbsolutePath(target) || isWindowsAbsolutePath(root);
    const resolver = useWindowsRules ? path.win32 : path;
    const sep = useWindowsRules ? "\\" : path.sep;
    const normalized = resolver.resolve(target);
    const normalizedRoot = resolver.resolve(root);
    let comparable = useWindowsRules ? normalized.toLowerCase() : normalized;
    let comparableRoot = useWindowsRules ? normalizedRoot.toLowerCase() : normalizedRoot;
    if (useWindowsRules) {
      comparable = normalizeUncHost(comparable);
      comparableRoot = normalizeUncHost(comparableRoot);
    }
    const rootWithSep = comparableRoot.endsWith(sep) ? comparableRoot : comparableRoot + sep;
    if (comparable === comparableRoot || comparable.startsWith(rootWithSep)) return true;
  }
  return false;
}

export function isExistingPathWithinRoots(target: string, roots: Set<string>): boolean {
  let realTarget: string;
  try {
    realTarget = realpathSync(target);
  } catch {
    // Network filesystems (e.g. \\wsl$) may not support realpath reliably.
    // The caller has already passed the lexical check, so fall back to it
    // instead of denying legitimate access because realpath is unavailable.
    return isPathWithinRoots(target, roots);
  }

  const realRoots = new Set<string>();
  for (const root of roots) {
    try {
      realRoots.add(realpathSync(root));
    } catch {
      // Keep the lexical form: a root that cannot be resolved right now
      // (removed session dir, or a network share without realpath support)
      // must not silently shrink the allowed set and turn a contained path
      // into an access denial.
      realRoots.add(root);
    }
  }
  return isPathWithinRoots(realTarget, realRoots);
}
