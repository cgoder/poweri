// PowerI 附件持久化与磁盘存储服务 (保存用户附加的文件并生成真实物理路径供 Agent 工具访问)
import fs from "fs";
import path from "path";
import os from "os";

export interface SaveAttachmentOptions {
  name: string;
  content: string;
  cwd?: string | null;
}

export interface SavedAttachmentResult {
  name: string;
  /** 磁盘绝对路径（UI 展示或非工作区场景使用） */
  savedPath: string;
  /** 相对于 cwd 的路径（传给 Agent，使模型可通过 read 工具直接访问） */
  relativePath: string;
  size: number;
  lineCount: number;
}

/**
 * cwd 准入判定结果：ok=false 表示调用方提供了 cwd 但未过白名单（路由层应返回 403）。
 */
export type AttachmentCwdDecision =
  | { ok: true; cwd: string | null }
  | { ok: false; reason: "cwd-not-allowed" };

/**
 * 纯函数：判定附件上传的 cwd 是否可接受（traps.md「File access allow-list」安全边界）。
 * - 未提供 cwd → ok，落盘走 ~/.pi/agent/attachments/ 应用私有回退
 * - 提供 cwd 但未通过白名单谓词 → 不 ok，绝不向白名单外目录写盘
 * 白名单谓词由调用方注入（路由层用 lib/file-access 的 getAllowedFileRoots + isFilePathAllowed），
 * 本模块保持零上游依赖，保证 node --test 可直跑。
 */
export function decideAttachmentCwd(
  cwd: string | null | undefined,
  isAllowed: (candidate: string) => boolean,
): AttachmentCwdDecision {
  if (!cwd) return { ok: true, cwd: null };
  if (!isAllowed(cwd)) return { ok: false, reason: "cwd-not-allowed" };
  return { ok: true, cwd };
}

/**
 * 获取附件存储目录
 * - 有工作区时：存到 cwd/.pi/attachments/（在工作区内，Agent 可直接用相对路径访问）
 * - 无工作区时：回退到 ~/.pi/agent/attachments/
 *
 * 注意：本函数只负责布局，不做安全判定；cwd 必须先经 decideAttachmentCwd 白名单校验。
 */
export function getAttachmentsDirectory(cwd?: string | null): string {
  let dir: string;
  if (cwd && fs.existsSync(cwd)) {
    dir = path.join(cwd, ".pi", "attachments");
  } else {
    dir = path.join(os.homedir(), ".pi", "agent", "attachments");
  }

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * 将用户上传的文本附件内容保存到磁盘，并返回物理绝对路径
 */
export function saveTextAttachment({
  name,
  content,
  cwd,
}: SaveAttachmentOptions): SavedAttachmentResult {
  const dir = getAttachmentsDirectory(cwd);

  // 清理文件名中的非法字符
  const sanitized = name.replace(/[/\\]/g, "_");
  const ext = path.extname(sanitized);
  const base = path.basename(sanitized, ext);
  const timestamp = Date.now();
  const fileName = `${base}-${timestamp}${ext}`;
  const filePath = path.join(dir, fileName);

  fs.writeFileSync(filePath, content, "utf-8");

  const stat = fs.statSync(filePath);
  const lineCount = content ? content.split("\n").length : 0;

  // 计算相对路径：如果 cwd 存在，给模型提供 cwd 相对路径（Agent 能直接用 read 工具访问）
  let relativePath: string;
  if (cwd && fs.existsSync(cwd)) {
    relativePath = path.relative(cwd, filePath);
  } else {
    relativePath = filePath;
  }

  return {
    name: sanitized,
    savedPath: filePath,
    relativePath,
    size: stat.size,
    lineCount,
  };
}
