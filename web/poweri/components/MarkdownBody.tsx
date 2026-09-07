"use client";

import { useMemo, useState, type MouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { resolveLocalFileHref } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { markdownRehypePlugins, markdownRemarkPlugins, normalizeDisplayMath } from "@/lib/markdown";
import { MermaidBlock, CodeBlock } from "@/poweri/components/MermaidBlock";
import type { WrittenFile } from "@/lib/turn-written-files";
import { linkifyInlineFilePaths } from "../lib/file-path-linking";
import { escapeUnbalancedHtml } from "../lib/html-balance";
import { FileContextMenu } from "./FileContextMenu";
import "../styles/file-link.css";

interface PowerIMarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  writtenFiles?: WrittenFile[];
  sourceSessionId?: string | null;
}

export function MarkdownBody({
  children,
  className,
  isStreaming,
  cwd,
  onOpenFile,
  writtenFiles,
  sourceSessionId,
}: PowerIMarkdownBodyProps) {
  const enhancedMarkdown = useMemo(() => {
    return linkifyInlineFilePaths(children, { writtenFiles });
  }, [children, writtenFiles]);

  const normalizedMarkdown = useMemo(
    () => normalizeDisplayMath(escapeUnbalancedHtml(enhancedMarkdown)),
    [enhancedMarkdown],
  );

  const [contextMenu, setContextMenu] = useState<{ filePath: string; x: number; y: number } | null>(null);

  const components = useMemo<Components>(() => ({
    code({ className, children, ...props }) {
      const lang = className?.replace("language-", "").toLowerCase() ?? "";
      const raw = String(children);
      const isBlock = className?.includes("language-") || raw.includes("\n");
      if (isBlock) {
        if (lang === "mermaid") {
          return <MermaidBlock code={raw.replace(/\n$/, "")} isStreaming={isStreaming} />;
        }
        return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} isStreaming={isStreaming} />;
      }
      return (
        <code className="markdown-inline-code" {...props}>
          {children}
        </code>
      );
    },
    pre({ children }) {
      return <>{children}</>;
    },
    a({ href, children, ...props }) {
      delete (props as Record<string, unknown>).node;
      const filePath = onOpenFile ? resolveLocalFileHref(href, cwd) : null;
      const openFile = onOpenFile;
      if (!filePath || !openFile) {
        return (
          <a href={href} {...props} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      }

      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = event.currentTarget.getAttribute("target");
        if (target && target !== "_self") return;
        event.preventDefault();
        // 通过 AppShell 的兜底逻辑（resolve-file API）打开，支持 basename 唯一命中
        openFile(filePath);
      };

      const handleContextMenu = (event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        setContextMenu({ filePath, x: event.clientX, y: event.clientY });
      };

      // 关键修复：href 改为 API 的 read URL，使“复制链接地址”得到正确的可下载链接
      // 点击仍由 onClick 拦截在文件预览器中打开，不会导航到 API
      const apiHref = `/api/files/${encodeFilePathForApi(filePath)}?type=read${sourceSessionId ? `&sessionId=${encodeURIComponent(sourceSessionId)}` : ""}`;

      return (
        <a href={apiHref} {...props} onClick={handleClick} onContextMenu={handleContextMenu}>
          {children}
        </a>
      );
    },
    img({ src, alt, ...props }) {
      delete (props as Record<string, unknown>).node;
      const filePath = typeof src === "string" ? resolveLocalFileHref(src, cwd) : null;
      const imageSrc = filePath ? `/api/files/${encodeFilePathForApi(filePath)}?type=read` : src;
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
    },
    table({ children }) {
      return (
        <div className="markdown-table-wrap">
          <table>{children}</table>
        </div>
      );
    },
  }), [cwd, isStreaming, onOpenFile, sourceSessionId]);

  return (
    <>
      <div className={["markdown-body", className].filter(Boolean).join(" ")}>
        <ReactMarkdown
          remarkPlugins={markdownRemarkPlugins}
          rehypePlugins={markdownRehypePlugins}
          components={components}
        >
          {normalizedMarkdown}
        </ReactMarkdown>
      </div>
      {contextMenu && (
        <FileContextMenu
          filePath={contextMenu.filePath}
          cwd={cwd}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          sourceSessionId={sourceSessionId}
        />
      )}
    </>
  );
}
