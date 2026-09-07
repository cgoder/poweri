/**
 * 订阅源 URL 类型判定（纯函数，客户端安全）。
 *
 * 独立成模块的原因：skill-subscriptions.ts 内部依赖 pi SDK（进而拉入
 * child_process 等 Node 内建模块），客户端组件一旦运行时 import 它，
 * Next.js 客户端打包即失败（Module not found: Can't resolve 'child_process'）。
 * 客户端（SkillsMarketView 添加源入口）只需要的纯字符串判定放在这里。
 */

export function detectSubscriptionType(url: string): "git" | "manifest" | "url" {
  const trimmed = url.trim();
  if (trimmed.endsWith(".json")) return "manifest";
  if (trimmed.endsWith(".git") || trimmed.includes("github.com") || trimmed.includes("gitlab")) return "git";
  return "url";
}
