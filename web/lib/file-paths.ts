export function normalizeFilePathSlashes(filePath: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith("\\\\")) {
    return filePath.replace(/\\/g, "/");
  }
  return filePath;
}

// URL marker segment for UNC prefixes (e.g. \\wsl$\Ubuntu\...). The
// `//` prefix cannot survive a catch-all route split, so the encoder emits
// this marker as the first segment and the files route restores `//` from it.
const UNC_PREFIX_MARKER = "__pi_unc__";

export function encodeFilePathForApi(filePath: string): string {
  const normalized = normalizeFilePathSlashes(filePath);
  const isUnc = normalized.startsWith("//");
  // filter(Boolean) would drop the empty segment a `//` UNC prefix splits
  // into, turning \\wsl$\... into a plain relative-looking path. Emit a
  // marker segment instead so the server restores the UNC form and the
  // containment check matches the root.
  const parts = normalized
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent);
  const segments = isUnc ? [UNC_PREFIX_MARKER, ...parts] : parts;
  return segments.join("/");
}

/** Restore the filesystem path encoded by encodeFilePathForApi. */
export function decodeFilePathFromApi(encodedSegments: string[]): string {
  if (encodedSegments[0] === UNC_PREFIX_MARKER) {
    return "//" + encodedSegments.slice(1).join("/");
  }
  return encodedSegments.join("/");
}

export function getFileName(filePath: string): string {
  const normalized = normalizeFilePathSlashes(filePath).replace(/\/+$/, "");
  return normalized.split("/").pop() ?? normalized;
}

export function getFileDirectory(filePath: string): string {
  const normalized = normalizeFilePathSlashes(filePath).replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash < 0) return "";
  if (lastSlash === 0) return "/";
  if (lastSlash === 2 && /^[a-zA-Z]:\//.test(normalized)) return normalized.slice(0, 3);
  return normalized.slice(0, lastSlash);
}

export function getRelativeFilePath(filePath: string, cwd?: string): string {
  if (!cwd) return filePath;

  const normalizedFile = normalizeFilePathSlashes(filePath);
  const normalizedCwd = normalizeFilePathSlashes(cwd).replace(/\/$/, "");
  if (normalizedFile.startsWith(normalizedCwd + "/")) {
    return normalizedFile.slice(normalizedCwd.length + 1);
  }
  return filePath;
}

export function joinFilePath(parent: string, child: string): string {
  return `${normalizeFilePathSlashes(parent).replace(/\/$/, "")}/${child}`;
}
