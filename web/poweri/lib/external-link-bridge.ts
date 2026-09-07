/**
 * 外部链接桥（Tauri 壳专用）
 *
 * poweri 在 Tauri 壳里运行于跨源 iframe（http://127.0.0.1:PORT/poweri），
 * webview 没有"新建窗口"能力，`target="_blank"` 链接点击会被静默丢弃。
 * 这里的桥把这类点击转成 postMessage 交给壳（shell/main.ts），由壳调用
 * Rust `open_url` 命令在系统默认浏览器中打开。
 *
 * 仅在 iframe 环境（Tauri 壳）安装；浏览器直开 /poweri 时不安装，
 * 保持原生新标签页行为。
 */

const SHELL_SOURCE = "poweri-shell";

let installed = false;
let shellBridgeReady = false;

/** 是否在 iframe 中（Tauri 壳的唯一形态；浏览器直开时 self === top）。 */
function inShellIframe(): boolean {
  return typeof window !== "undefined" && window.self !== window.top;
}

/** 只桥接"显式新窗口意图"的链接：target="_blank" 且协议安全。 */
function isBridgeableAnchor(anchor: HTMLAnchorElement): boolean {
  if (anchor.getAttribute("target") !== "_blank") return false;
  const href = anchor.getAttribute("href");
  if (!href) return false;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return false;
  if (/^(javascript|data|vbscript):/i.test(trimmed)) return false;
  // http(s)、mailto、或站内相对链接（系统浏览器可访问 127.0.0.1 服务）
  return /^(https?:)?\/\//i.test(trimmed) || /^mailto:/i.test(trimmed) || trimmed.startsWith("/");
}

/** 打开外部链接：壳内走 postMessage 桥，浏览器模式走原生新窗口。 */
export function openExternalUrl(url: string): void {
  if (installed && inShellIframe()) {
    window.parent.postMessage({ source: "poweri", type: "open-external", url }, "*");
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/**
 * 安装桥（幂等）。在 AppShell 挂载时调用一次。
 * 返回是否实际安装（false = 浏览器模式，无需桥）。
 */
export function installExternalLinkBridge(): boolean {
  if (installed) return true;
  if (!inShellIframe()) return false;
  installed = true;

  // 握手：让壳确认桥已就绪，首次点击就走 postMessage 而非兜底。
  window.parent.postMessage({ source: "poweri", type: "bridge-ping" }, "*");
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data as { source?: string; type?: string } | null;
    if (!data || data.source !== SHELL_SOURCE) return;
    if (data.type === "open-external-ack") shellBridgeReady = true;
  });

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      const anchor = target?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (!isBridgeableAnchor(anchor)) return;

      event.preventDefault();
      event.stopPropagation();
      const url = new URL(anchor.href, window.location.href).toString();
      if (shellBridgeReady) {
        window.parent.postMessage({ source: "poweri", type: "open-external", url }, "*");
      } else {
        // 壳未握手（极端时序）：尽力兜底，浏览器语义下仍可开新窗口。
        window.open(url, "_blank", "noopener,noreferrer");
      }
    },
    true, // capture：在 webview 尝试新窗口之前拦截
  );
  return true;
}
