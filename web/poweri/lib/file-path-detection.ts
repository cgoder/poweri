/**
 * PowerI 产品层：文件路径检测
 *
 * 检测字符串是否看起来像文件路径（用于自动链接 inline code）。
 * 要求文件扩展名，拒绝版本号、IP 地址和 CLI 参数。
 */

/**
 * 检测字符串是否看起来像文件路径
 */
export function looksLikeFilePath(text: string): boolean {
  // 拒绝 CLI 参数
  if (text.startsWith("-")) return false;
  // 拒绝包含空格的文本
  if (text.includes(" ")) return false;
  // 拒绝版本号（如 v0.2, 1.0.0）
  if (/^\d+\.\d+(\.\d+)*$/.test(text)) return false;
  // 拒绝 IP 地址
  if (/^\d+\.\d+\.\d+\.\d+$/.test(text)) return false;
  // 拒绝 URL 协议（http:, https:, file: 等）
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)) return false;

  // 包含路径分隔符时，要求以字母开头的扩展名结尾
  if (text.includes("/")) return /\.[a-zA-Z][a-zA-Z0-9]*$/.test(text);

  // 简单文件名：要求以字母开头的扩展名
  return /^[^/]+\.[a-zA-Z][a-zA-Z0-9]*$/.test(text);
}
