"use client";

import { useEffect, useRef } from "react";
import { copyFilePath, copyFileDownloadLink, downloadFile, revealInFolder } from "@/poweri/lib/file-actions";

interface FileContextMenuProps {
  filePath: string;
  cwd?: string | null;
  x: number;
  y: number;
  onClose: () => void;
  sourceSessionId?: string | null;
  /** 回退：在浏览器中打开目录（高亮文件） */
  onRevealInExplorer?: (filePath: string) => void;
}

export function FileContextMenu({
  filePath,
  cwd,
  x,
  y,
  onClose,
  sourceSessionId,
  onRevealInExplorer,
}: FileContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleScroll = () => onClose();
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  // 调整位置防止溢出视口
  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.min(x, window.innerWidth - 220),
    top: Math.min(y, window.innerHeight - 200),
    zIndex: 9999,
    minWidth: 200,
    background: "var(--bg-panel)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    padding: 4,
    fontSize: 12,
  };

  const resolveWithFallback = async (p: string): Promise<string> => {
    if (!cwd) return p;
    try {
      const params = new URLSearchParams({ cwd, path: p });
      const res = await fetch(`/poweri/api/resolve-file?${params.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as { resolvedPath: string | null };
        if (data.resolvedPath) return data.resolvedPath;
      }
    } catch {
      // ignore
    }
    return p;
  };

  const handleCopyPath = async () => {
    try {
      const resolved = await resolveWithFallback(filePath);
      await copyFilePath(resolved);
    } catch (e) {
      alert(`复制失败：${String(e)}`);
    } finally {
      onClose();
    }
  };

  const handleCopyLink = async () => {
    try {
      const resolved = await resolveWithFallback(filePath);
      await copyFileDownloadLink(resolved, sourceSessionId);
    } catch (e) {
      alert(`复制失败：${String(e)}`);
    } finally {
      onClose();
    }
  };

  const handleDownload = async () => {
    onClose();
    try {
      const resolved = await resolveWithFallback(filePath);
      await downloadFile(resolved, sourceSessionId);
    } catch (e) {
      alert(`下载失败：${String(e)}`);
    }
  };

  const handleReveal = async () => {
    onClose();
    const resolved = await resolveWithFallback(filePath);
    const result = await revealInFolder(resolved);
    if (!result.ok) {
      if (result.inTauri) {
        alert(`打开目录失败：${result.error ?? "未知错误"}\n路径：${resolved}`);
      } else if (onRevealInExplorer) {
        onRevealInExplorer(resolved);
      } else {
        console.warn("revealInFolder not available, no explorer fallback");
      }
    }
  };

  const itemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 4,
    cursor: "pointer",
    color: "var(--text)",
    whiteSpace: "nowrap",
  };

  return (
    <div ref={ref} style={style} role="menu">
      <div
        role="menuitem"
        style={itemStyle}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        onClick={handleCopyPath}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v3" />
        </svg>
        复制文件路径
      </div>
      <div
        role="menuitem"
        style={itemStyle}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        onClick={handleCopyLink}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        复制下载链接
      </div>
      <div
        role="menuitem"
        style={itemStyle}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        onClick={handleDownload}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        下载
      </div>
      <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
      <div
        role="menuitem"
        style={itemStyle}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        onClick={handleReveal}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        打开所在目录
      </div>
    </div>
  );
}
