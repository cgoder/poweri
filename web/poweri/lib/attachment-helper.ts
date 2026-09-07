// PowerI 附件与上下文处理模块
// 两套策略：
//   Web 环境  —— 浏览器无法读取本地绝对路径，将文件内容直接内联到 <attached_files> 信封中
//   Tauri 环境 —— 桌面应用可访问本地文件系统，将文件保存到 cwd/.pi/attachments/ 并引用相对路径

export interface AttachedTextFile {
  id: string;
  name: string;
  /** Tauri: 相对于 cwd 的路径；Web: 空字符串（内容已内联） */
  path: string;
  /** Web 模式下存储文件原始内容（内联发送给模型） */
  inlineContent?: string;
  size?: number;
  lineCount?: number;
}

export type AttachedFile = AttachedTextFile;

/** 支持常见文本、代码、配置与日志文件的扩展名列表 */
export const TEXT_CODE_EXTENSIONS = new Set([
  "txt", "md", "markdown", "mdown", "json", "jsonc", "json5",
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts",
  "py", "pyw", "ipynb",
  "go", "rs", "java", "kt", "kts", "c", "cpp", "cc", "cxx", "h", "hpp", "hxx",
  "cs", "fs", "fsx", "php", "rb", "erb", "lua", "swift", "dart",
  "sh", "bash", "zsh", "fish", "bat", "cmd", "ps1", "psm1",
  "html", "htm", "css", "scss", "sass", "less", "vue", "svelte", "astro",
  "yaml", "yml", "toml", "ini", "cfg", "conf", "config", "env", "properties",
  "xml", "svg", "graphql", "gql", "sql", "prisma", "proto",
  "csv", "tsv", "log", "diff", "patch", "dockerfile", "makefile", "r", "zig",
]);

/** 文本与代码附件大小上限：2MB */
export const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;

/**
 * 判断文件是否为纯文本或代码类文件
 */
export function isTextOrCodeFile(file: Pick<File, "name" | "type">): boolean {
  if (!file) return false;
  if (file.type && (
    file.type.startsWith("text/") ||
    file.type === "application/json" ||
    file.type === "application/xml" ||
    file.type === "application/javascript" ||
    file.type === "application/typescript"
  )) return true;
  const name = file.name.toLowerCase();
  const ext = name.split(".").pop();
  if (ext && TEXT_CODE_EXTENSIONS.has(ext)) return true;
  if (
    name === "dockerfile" ||
    name === "makefile" ||
    name === "gemfile" ||
    name === "rakefile" ||
    name.startsWith(".env")
  ) return true;
  return false;
}

/**
 * 判断文件是否为图片文件
 */
export function isImageFile(file: Pick<File, "name" | "type">): boolean {
  if (!file) return false;
  return file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name);
}

/**
 * 格式化文件字节大小展示
 */
export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 检测当前是否运行在 Tauri 桌面环境
 * Tauri 会在 window 上注入 __TAURI__ 或 __TAURI_INTERNALS__ 对象
 */
export function isTauriEnv(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return typeof w.__TAURI__ !== "undefined" || typeof w.__TAURI_INTERNALS__ !== "undefined";
}

// ─── 信封正则 ────────────────────────────────────────────────────────────────

/**
 * 外层信封外壳（Tauri 路径引用与 Web 内联内容两种内层格式共用）：
 * <attached_files>\n ... \n</attached_files>[\n\n正文]
 */
const ATTACHED_FILES_ENVELOPE_RE = /^<attached_files>\n([\s\S]*?)\n<\/attached_files>(?:\n\n([\s\S]*))?$/;
const PATH_FILE_TAG_RE = /<file\s+path="([^"\n]+)"(?:\s+name="([^"\n]*)")?(?:\s+size="([^"\n]*)")?(?:\s+lines="([^"\n]*)"\s*)?\/>/g;

/**
 * 内联内容信封（Web 环境）内层：
 * <file name="..." size="..." lines="...">
 *   <content>...文件内容...</content>
 * </file>
 */
const INLINE_FILE_TAG_RE = /<file(?:\s+name="([^"\n]*)")?(?:\s+size="([^"\n]*)")?(?:\s+lines="([^"\n]*)")?\s*>\s*<content>([\s\S]*?)<\/content>\s*<\/file>/g;

/** 兼容旧版纯文本提示格式 */
const LEGACY_ATTACHMENT_RE = /^(?:\[Attached File:\s*([^\n\]]+)\](?:\n\(Please use your tools[^\n]*\))?\n*)+([\s\S]*)$/;
const LEGACY_SINGLE_FILE_RE = /\[Attached File:\s*([^\n\]]+)\]/g;

export interface ParsedAttachmentFile {
  id: string;
  name: string;
  path?: string;
  inlineContent?: string;
  size?: number;
  lineCount?: number;
}

export interface ParsedAttachmentEnvelope {
  files: ParsedAttachmentFile[];
  cleanText: string;
  hasEnvelope: boolean;
}

// ─── 组装函数 ────────────────────────────────────────────────────────────────

/**
 * 组装 Tauri 环境下的路径引用信封
 * 模型通过 read / ffgrep 工具按需访问文件路径
 */
function assemblePathEnvelope(cleanMsg: string, files: AttachedFile[]): string {
  const tags = files.map((file) => {
    const nameAttr = file.name ? ` name="${escapeXmlAttr(file.name)}"` : "";
    const sizeAttr = file.size != null ? ` size="${file.size}"` : "";
    const linesAttr = file.lineCount != null ? ` lines="${file.lineCount}"` : "";
    return `  <file path="${escapeXmlAttr(file.path)}"${nameAttr}${sizeAttr}${linesAttr} />`;
  }).join("\n");
  const envelope = `<attached_files>\n${tags}\n</attached_files>`;
  return cleanMsg ? `${envelope}\n\n${cleanMsg}` : envelope;
}

/**
 * 组装 Web 环境下的内联内容信封
 * 浏览器无法获取本地文件路径，直接将文件内容嵌入信封发给模型
 */
function assembleInlineEnvelope(cleanMsg: string, files: AttachedFile[]): string {
  const tags = files.map((file) => {
    const nameAttr = file.name ? ` name="${escapeXmlAttr(file.name)}"` : "";
    const sizeAttr = file.size != null ? ` size="${file.size}"` : "";
    const linesAttr = file.lineCount != null ? ` lines="${file.lineCount}"` : "";
    const content = file.inlineContent ?? "";
    return `  <file${nameAttr}${sizeAttr}${linesAttr}>\n    <content>\n${content}\n    </content>\n  </file>`;
  }).join("\n");
  const envelope = `<attached_files>\n${tags}\n</attached_files>`;
  return cleanMsg ? `${envelope}\n\n${cleanMsg}` : envelope;
}

/**
 * 将用户输入的纯文本与附件列表组装为结构化信封
 *
 * - Tauri 环境：路径引用信封（模型用 read 工具按需读取）
 * - Web 环境：内联内容信封（文件内容直接嵌入，模型立即可读）
 */
export function assembleMessageWithAttachments(
  rawMessage: string,
  attachedFiles?: AttachedFile[],
): string {
  const cleanMsg = (rawMessage ?? "").trim();
  if (!attachedFiles || attachedFiles.length === 0) return cleanMsg;

  if (isTauriEnv()) {
    return assemblePathEnvelope(cleanMsg, attachedFiles);
  }
  return assembleInlineEnvelope(cleanMsg, attachedFiles);
}

// ─── 解析函数 ────────────────────────────────────────────────────────────────

/**
 * 从消息中解析出结构化附件信封与纯净的用户自然语言文本。
 * 支持三种格式：内联内容信封 / 路径引用信封 / 旧版 [Attached File: ...] 格式。
 *
 * 适用于：
 * 1. MessageView 渲染（顶部渲染附件卡片，正文渲染纯净用户文本）
 * 2. 复制与编辑消息（仅操作用户自然语言）
 * 3. 历史记录回溯（输入框只回填用户的自然输入）
 */
export function parseAttachmentEnvelope(content: string): ParsedAttachmentEnvelope {
  if (!content) return { files: [], cleanText: "", hasEnvelope: false };

  // 1. 尝试解析内联内容信封（Web 环境产生）
  const inlineEnvelopeMatch = content.match(ATTACHED_FILES_ENVELOPE_RE);
  if (inlineEnvelopeMatch) {
    const [, fileBlock, bodyText] = inlineEnvelopeMatch;
    // 只有包含 <content> 标签才视为内联信封（与路径信封区分）
    if (INLINE_FILE_TAG_RE.test(fileBlock)) {
      const files: ParsedAttachmentFile[] = [];
      INLINE_FILE_TAG_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = INLINE_FILE_TAG_RE.exec(fileBlock)) !== null) {
        const [, name, sizeStr, linesStr, inlineContent] = m;
        const fileName = name || "attachment";
        files.push({
          id: `inline-${fileName}`,
          name: fileName,
          inlineContent: inlineContent?.trim(),
          size: sizeStr ? parseInt(sizeStr, 10) : undefined,
          lineCount: linesStr ? parseInt(linesStr, 10) : undefined,
        });
      }
      if (files.length > 0) {
        return { files, cleanText: (bodyText ?? "").trim(), hasEnvelope: true };
      }
    }
  }

  // 2. 尝试解析路径引用信封（Tauri 环境产生）
  const pathEnvelopeMatch = content.match(ATTACHED_FILES_ENVELOPE_RE);
  if (pathEnvelopeMatch) {
    const [, fileBlock, bodyText] = pathEnvelopeMatch;
    if (/<file\s+path=/.test(fileBlock)) {
      const files: ParsedAttachmentFile[] = [];
      PATH_FILE_TAG_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = PATH_FILE_TAG_RE.exec(fileBlock)) !== null) {
        const [, filePath, name, sizeStr, linesStr] = m;
        const fileName = name || filePath.split("/").pop() || "file";
        files.push({
          id: `${fileName}-${filePath}`,
          name: fileName,
          path: filePath,
          size: sizeStr ? parseInt(sizeStr, 10) : undefined,
          lineCount: linesStr ? parseInt(linesStr, 10) : undefined,
        });
      }
      if (files.length > 0) {
        return { files, cleanText: (bodyText ?? "").trim(), hasEnvelope: true };
      }
    }
  }

  // 3. 兼容旧版 [Attached File: ...] 格式
  const legacyMatch = content.match(LEGACY_ATTACHMENT_RE);
  if (legacyMatch) {
    const [, , bodyText] = legacyMatch;
    const files: ParsedAttachmentFile[] = [];
    LEGACY_SINGLE_FILE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LEGACY_SINGLE_FILE_RE.exec(content)) !== null) {
      const [, filePath] = m;
      const fileName = filePath.split("/").pop() || "file";
      files.push({ id: `${fileName}-${filePath}`, name: fileName, path: filePath });
    }
    if (files.length > 0) {
      return { files, cleanText: (bodyText ?? "").trim(), hasEnvelope: true };
    }
  }

  return { files: [], cleanText: content, hasEnvelope: false };
}

/**
 * 提取纯净的用户自然语言文本（用于输入框回填、消息编辑、复制文本）
 */
export function extractCleanUserText(content: string): string {
  return parseAttachmentEnvelope(content).cleanText;
}

function escapeXmlAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
