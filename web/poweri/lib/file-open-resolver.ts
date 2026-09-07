/**
 * PowerI 产品层：文件打开前的兜底解析（浏览器端，纯逻辑，UI-free）。
 *
 * 消息内文件链接（含裸 basename，如 `file-map.md`）点击时先经
 * `/poweri/api/resolve-file` 解析：
 * - 原路径存在 → 直接打开；
 * - basename 在工作区内唯一命中 → 打开命中路径（解决"文件不在 cwd 根目录、
 *   仅凭 basename 打不开"）；
 * - 0 命中 → missing（调用方给出"文件不存在"反馈）；
 * - 多命中 → ambiguous（不猜，调用方列出候选）；
 * - 越权（工作区外，如 home 下文件）→ denied（安全边界不动，仅反馈）；
 * - API 不可用/非预期响应 → open 原路径（保持旧行为：viewer 内自会显示加载错误）。
 */
export type FileOpenResolution =
  | { kind: "open"; filePath: string }
  | { kind: "missing" }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "denied" };

interface ResolveFileResponse {
  resolvedPath: string | null;
  candidates?: string[];
  hit?: boolean;
}

export async function resolveFileForOpen(
  cwd: string | null | undefined,
  filePath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FileOpenResolution> {
  if (!cwd) return { kind: "open", filePath };
  try {
    const params = new URLSearchParams({ cwd, path: filePath });
    const res = await fetchImpl(`/poweri/api/resolve-file?${params.toString()}`);
    if (res.status === 403) return { kind: "denied" };
    if (!res.ok) return { kind: "open", filePath };
    const data = (await res.json()) as ResolveFileResponse;
    if (data.resolvedPath) return { kind: "open", filePath: data.resolvedPath };
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    if (candidates.length > 1) return { kind: "ambiguous", candidates };
    return { kind: "missing" };
  } catch {
    // 网络/API 异常时不阻断打开动作，退回旧行为
    return { kind: "open", filePath };
  }
}
