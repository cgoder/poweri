/**
 * PowerI 产品层：inline code 文件引用链接化（纯逻辑，UI-free）
 *
 * 将 markdown 行内代码中的文件路径（如 `docs/desktop/ownership.md`）转换为
 * 可点击链接，供 MarkdownBody 使用：
 * - 路径形式（含 `/`）：原样作为链接 URL，由基础层相对 cwd 解析。
 * - 纯 basename（如 `installer.rs`）：若本轮 writtenFiles 中有唯一同名文件，
 *   用该文件的绝对路径作为链接 URL——解决"文件不在 cwd 根目录、仅凭 basename
 *   打不开"的问题；否则回退原样（由基础层相对 cwd 解析，cwd 根目录存在同名
 *   文件时仍可打开）。
 */
import type { WrittenFile } from "@/lib/turn-written-files";
import { looksLikeFilePath } from "./file-path-detection";

export interface FilePathLinkingOptions {
  /** 本轮 assistant 实际写入的文件（绝对路径）。basename 消歧的唯一依据。 */
  writtenFiles?: WrittenFile[];
}

/**
 * 预处理 markdown 文本，将 inline code 中的文件路径转换为链接。
 *
 * 例如：`docs/desktop/ownership.md` → [`docs/desktop/ownership.md`](docs/desktop/ownership.md)
 */
export function linkifyInlineFilePaths(markdown: string, options: FilePathLinkingOptions = {}): string {
  const { writtenFiles } = options;
  return markdown.replace(/`([^`]+)`/g, (match, code) => {
    if (!looksLikeFilePath(code)) return match;
    const writtenHref = resolveBasenameWrittenHref(code, writtenFiles);
    return `[\`${code}\`](${writtenHref ?? code})`;
  });
}

/** 纯 basename 在本轮 writtenFiles 中唯一匹配时，返回该文件的绝对路径（URL 编码）。 */
function resolveBasenameWrittenHref(code: string, writtenFiles?: WrittenFile[]): string | null {
  // 路径形式交由基础层相对 cwd 解析；无 writtenFiles（用户消息、流式中）时回退。
  if (code.includes("/") || !writtenFiles || writtenFiles.length === 0) return null;

  const matches = writtenFiles.filter((file) => basenameOf(file.filePath) === code);
  if (matches.length !== 1) return null;
  return encodeFilePathHref(matches[0].filePath);
}

function basenameOf(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

/**
 * 将文件系统路径编码为 markdown 链接 URL。
 *
 * encodeURIComponent 编码空格、中文、#、? 等一切会破坏 markdown 链接解析或
 * 被基础层当作 fragment/query 截断的字符（只恢复 / 保持路径结构）；基础层
 * resolveLocalFileHref 会 safeDecode 还原原始路径。
 */
function encodeFilePathHref(filePath: string): string {
  return encodeURIComponent(filePath).replace(/%2F/g, "/");
}
