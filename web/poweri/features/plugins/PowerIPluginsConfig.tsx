// PowerI Plugins 插件管理中心 (双 Tab 模式: Installed vs Discover + 多维排序 + 复合标签 + 待重载感知 + 键盘无障碍)
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { sendAgentCommand } from "@/lib/agent-client";
import type { PluginPackageInfo, PluginsResponse } from "@/lib/api-types";
import { tp } from "@/poweri/lib/i18n";
import {
  getPiDevWebUrl,
  findPackageMetadata,
  isSamePackage,
  type MarketPackageItem,
  type PackageQueryResult,
} from "@/poweri/lib/packages-catalog";
// 检测纯函数(客户端安全):isPackageUpdateAvailable/类型在 package-update-shared(零 SDK 依赖);
// SDK 调用与 TTL 缓存在 package-update-service(服务端 only),经 /poweri/api/plugins/updates 访问
import { isPackageUpdateAvailable, type PackageUpdatesResult, PACKAGE_UPDATES_CHANGED_EVENT } from "@/poweri/lib/package-update-shared";

interface Props {
  cwd?: string | null;
  sessionId?: string | null;
  onReloaded?: () => void;
  /** 插件包可更新计数上报,供 SettingsPanel tab 角标与顶栏全局徽标 */
  onUpdateCount?: (n: number) => void;
}

type PluginAction = "install" | "remove" | "update" | "disable" | "enable";
type SortOption = "downloads" | "recent" | "name";

interface ActiveAction {
  action: PluginAction;
  scope: PluginPackageInfo["scope"];
  source: string;
}

function normalizePluginSourceInput(value: string): string {
  const match = value.trim().match(/^\$?\s*pi\s+install\s+(\S+)\s*$/);
  return match?.[1] ?? value;
}

function packageKey(pkg: Pick<PluginPackageInfo, "source" | "scope">): string {
  return `${pkg.scope}\0${pkg.source}`;
}

export function PowerIPluginsConfig({ cwd, sessionId, onReloaded, onUpdateCount }: Props) {
  const { locale } = useI18n();
  const [activeTab, setActiveTab] = useState<"installed" | "discover">("installed");
  const [pluginsData, setPluginsData] = useState<PluginsResponse | null>(null);
  const [marketPackages, setMarketPackages] = useState<MarketPackageItem[]>([]);
  const [totalMarketCount, setTotalMarketCount] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortOption>("downloads");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [marketLoading, setMarketLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [activeActions, setActiveActions] = useState<ActiveAction[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [expandedPkgKey, setExpandedPkgKey] = useState<string | null>(null);
  const [confirmDeletePkg, setConfirmDeletePkg] = useState<PluginPackageInfo | null>(null);
  // 包更新检测(与 pi TUI 启动横幅同链路,服务端 TTL 缓存):installed tab 挂载即拉,
  // 不再依赖 Discover tab 的市场数据(旧实现 marketPackages 空数组 + pi.dev 解析 version
  // 恒为 "latest",hasUpdate 双通道均失效——2026-09 修复)
  const [pkgUpdates, setPkgUpdates] = useState<PackageUpdatesResult | null>(null);
  const [updatingAll, setUpdatingAll] = useState(false);

  const t = useCallback((key: string, params?: Record<string, string | number>) => {
    return tp(locale, key, params);
  }, [locale]);

  // 辅助函数：判断某个包及动作是否处于执行中
  const isActionPending = useCallback((action: PluginAction, source: string, scope?: PluginPackageInfo["scope"]) => {
    return activeActions.some(
      (a) => a.action === action && isSamePackage(a.source, source) && (!scope || a.scope === scope)
    );
  }, [activeActions]);

  const isPackageBusy = useCallback((source: string, scope?: PluginPackageInfo["scope"]) => {
    return activeActions.some(
      (a) => isSamePackage(a.source, source) && (!scope || a.scope === scope)
    );
  }, [activeActions]);

  // 搜索防抖 (250ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // 分类与排序改变时重置分页
  const handleCategoryChange = (catId: string) => {
    setSelectedCategory(catId);
    setPage(1);
  };

  const handleSortChange = (newSort: SortOption) => {
    setSortBy(newSort);
    setPage(1);
  };

  // 0. 包更新检测(installed tab 挂载即查;服务端 TTL 缓存命中时零网络)
  const loadPkgUpdates = useCallback(async (force = false) => {
    try {
      const params = new URLSearchParams();
      if (cwd) params.set("cwd", cwd);
      if (force) params.set("force", "1");
      const res = await fetch(`/poweri/api/plugins/updates?${params.toString()}`);
      const data = (await res.json()) as PackageUpdatesResult & { error?: string };
      if (res.ok && !data.error) {
        setPkgUpdates(data);
        // force 重拉会刷新服务端 TTL 缓存,通知全局消费者(AppShell 顶栏徽标等)
        // 用普通 fetch 重查(命中新缓存,零网络)。
        if (force) window.dispatchEvent(new CustomEvent(PACKAGE_UPDATES_CHANGED_EVENT));
      } else setPkgUpdates({ updates: [], summary: { outdated: 0 }, checkedAt: 0, error: data.error ?? `HTTP ${res.status}` });
    } catch (err) {
      setPkgUpdates({ updates: [], summary: { outdated: 0 }, checkedAt: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }, [cwd]);

  useEffect(() => {
    // force: 打开面板即重新检测(badge 稍后出现但保证新鲜,包列表渲染不受影响),
    // 同时刷新服务端 TTL 缓存,顶栏徽标/技能映射随后读到新状态。
    void loadPkgUpdates(true);
  }, [loadPkgUpdates]);

  // 插件包可更新计数上报 → SettingsPanel 的 plugins tab 角标 + 顶栏全局徽标
  useEffect(() => {
    onUpdateCount?.(pkgUpdates?.summary.outdated ?? 0);
  }, [onUpdateCount, pkgUpdates]);

  // 1. 加载本地已安装插件
  const loadInstalledPlugins = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    try {
      const url = cwd ? `/api/plugins?cwd=${encodeURIComponent(cwd)}` : "/api/plugins";
      const res = await fetch(url);
      const data = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPluginsData(data);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  // 2. 搜索/加载 pi.dev 官方市场 packages (支持排序与真实追加)
  const loadMarketPackages = useCallback(async (query = "", category = "all", targetPage = 1, currentSort = "downloads") => {
    const isAppend = targetPage > 1;
    if (isAppend) {
      setLoadingMore(true);
    } else {
      setMarketLoading(true);
    }

    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (category !== "all") params.set("category", category);
      params.set("page", String(targetPage));
      params.set("sort", currentSort);

      const res = await fetch(`/poweri/api/plugins/packages?${params.toString()}`);
      const data = (await res.json()) as PackageQueryResult & { error?: string };
      if (res.ok && Array.isArray(data.packages)) {
        if (isAppend) {
          setMarketPackages((prev) => {
            const existingNames = new Set(prev.map((p) => p.name));
            const newUnique = data.packages.filter((p) => !existingNames.has(p.name));
            return [...prev, ...newUnique];
          });
        } else {
          setMarketPackages(data.packages);
        }
        setTotalMarketCount(data.total || data.packages.length);
        setHasMore(Boolean(data.hasMore));
      }
    } catch {
      // ignore
    } finally {
      setMarketLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void loadInstalledPlugins();
  }, [loadInstalledPlugins]);

  useEffect(() => {
    if (activeTab === "discover") {
      void loadMarketPackages(debouncedQuery, selectedCategory, page, sortBy);
    }
  }, [activeTab, debouncedQuery, selectedCategory, page, sortBy, loadMarketPackages]);

  // 3. 执行插件运维动作 (enable / disable / update / remove)
  const runPackageAction = useCallback(async (
    action: PluginAction,
    source: string,
    scope: PluginPackageInfo["scope"],
    opts?: { refreshUpdates?: boolean }
  ) => {
    const refreshUpdates = opts?.refreshUpdates ?? true;
    const actionItem: ActiveAction = { action, source, scope };
    setActiveActions((prev) => [...prev, actionItem]);    setActionError(null);
    setActionMessage(null);

    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, source, scope, cwd: cwd || undefined }),
      });
      const data = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPluginsData(data);
      setHasPendingChanges(true); // 标记有待生效的变更
      setActionMessage(
        action === "remove"
          ? t("plugins.packageRemoved")
          : action === "update"
          ? t("plugins.packageUpdated")
          : action === "enable"
          ? t("plugins.packageEnabled")
          : action === "disable"
          ? t("plugins.packageDisabled")
          : t("plugins.packageInstalled")
      );
      setTimeout(() => setActionMessage(null), 3000);
      // 写动作改变已装集合 → 立即 force 重拉检测(顺带刷新服务端 TTL 缓存,
      // 使页面重载后的普通 fetch 也读到新状态)。批量路径跳过,由调用方尾部统一拉。
      if (refreshUpdates && (action === "update" || action === "install" || action === "remove")) {
        void loadPkgUpdates(true);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setActiveActions((prev) =>
        prev.filter((a) => !(a.action === action && a.scope === scope && isSamePackage(a.source, source)))
      );
    }
  }, [cwd, t, loadPkgUpdates]);

  // 快捷键支持: Esc 取消, Enter 确认卸载（放在 runPackageAction 声明之后，避免 TDZ）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (confirmDeletePkg) {
        if (e.key === "Escape") {
          e.preventDefault();
          setConfirmDeletePkg(null);
        } else if (e.key === "Enter") {
          e.preventDefault();
          const target = confirmDeletePkg;
          setConfirmDeletePkg(null);
          void runPackageAction("remove", target.source, target.scope);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmDeletePkg, runPackageAction]);

  // 4. 从市场安装 package
  const handleInstallFromMarket = useCallback(async (
    pkgName: string,
    scope: "global" | "project" = "global"
  ) => {
    const source = normalizePluginSourceInput(pkgName).trim();
    if (!source) return;
    const finalSource = source.startsWith("npm:") || source.startsWith("git:") || source.startsWith("http") ? source : `npm:${source}`;
    await runPackageAction("install", finalSource, scope);
  }, [runPackageAction]);

  // 5. 会话热重载
  const handleReloadSession = useCallback(async () => {
    if (!sessionId) return;
    setReloading(true);
    setActionError(null);
    setActionMessage(null);
    try {
      await sendAgentCommand(sessionId, { type: "reload" });
      onReloaded?.();
      setHasPendingChanges(false);
      setActionMessage(t("plugins.sessionReloadSuccess"));
      setTimeout(() => setActionMessage(null), 2500);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setReloading(false);
    }
  }, [sessionId, onReloaded, t]);

  // 6. 批量更新全部可更新包(串行逐个执行,复用单包动作与 busy 状态;完成后强制重拉检测)——
  //    依赖 installedPackages,定义在其 useMemo 之后

  const installedPackages = useMemo(() => pluginsData?.packages ?? [], [pluginsData]);

  // 批量更新全部可更新包(串行逐个执行,复用单包动作与 busy 状态;完成后强制重拉检测)
  const handleUpdateAll = useCallback(async () => {
    const targets = installedPackages.filter((p: PluginPackageInfo) =>
      isPackageUpdateAvailable(p.source, pkgUpdates?.updates ?? [], isSamePackage),
    );
    if (targets.length === 0) return;
    setUpdatingAll(true);
    setActionError(null);
    try {
      for (const target of targets) {
        await runPackageAction("update", target.source, target.scope, { refreshUpdates: false });
      }
      await loadPkgUpdates(true);
    } finally {
      setUpdatingAll(false);
    }
  }, [installedPackages, pkgUpdates, runPackageAction, loadPkgUpdates]);

  // 精准判断某个市场 package 是否已安装 (严格区分 scope，如 pi-subagents vs @tintinweb/pi-subagents)
  const isMarketPkgInstalled = useCallback((pkgName: string) => {
    return installedPackages.some((p: PluginPackageInfo) => isSamePackage(p.source, pkgName));
  }, [installedPackages]);

  // 获取已安装包的完整元数据（镜像对称 + 严格类型推导）
  const getInstalledPackageMetadata = useCallback((pkg: PluginPackageInfo) => {
    const match = marketPackages.find((m) => isSamePackage(m.name, pkg.source)) ||
      findPackageMetadata(pkg.source);

    const description = match?.description || (() => {
      const parts = [];
      if (pkg.counts.extensions) parts.push(`${pkg.counts.extensions} extension(s)`);
      if (pkg.counts.skills) parts.push(`${pkg.counts.skills} skill(s)`);
      if (pkg.counts.prompts) parts.push(`${pkg.counts.prompts} prompt(s)`);
      if (pkg.counts.themes) parts.push(`${pkg.counts.themes} theme(s)`);
      return parts.length > 0 ? parts.join(" · ") : "Pi coding agent package extension.";
    })();

    const author = match?.author || "npm";
    const downloads = match?.downloads || (match?.downloadNum ? `${Math.round(match.downloadNum / 1000)}K/mo` : "active");

    // 严格类型推导：根据包内真实包含的各类资源数量推导复合 categories 数组
    const categories: ("extension" | "skill" | "prompt" | "theme" | "package")[] =
      match?.categories && match.categories.length > 0
        ? match.categories
        : (() => {
            const cats: ("extension" | "skill" | "prompt" | "theme" | "package")[] = [];
            if (pkg.counts.skills) cats.push("skill");
            if (pkg.counts.extensions) cats.push("extension");
            if (pkg.counts.prompts) cats.push("prompt");
            if (pkg.counts.themes) cats.push("theme");
            if (cats.length === 0) cats.push("package");
            return cats;
          })();

    return {
      description,
      author,
      downloads,
      categories,
    };
  }, [marketPackages]);

  // 过滤已安装列表
  const filteredInstalled = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return installedPackages;
    return installedPackages.filter((p: PluginPackageInfo) => {
      const meta = getInstalledPackageMetadata(p);
      return (
        p.source.toLowerCase().includes(q) ||
        meta.description.toLowerCase().includes(q) ||
        meta.author.toLowerCase().includes(q) ||
        p.resources.some((r: { name: string }) => r.name.toLowerCase().includes(q))
      );
    });
  }, [installedPackages, debouncedQuery, getInstalledPackageMetadata]);

  // 分类标签列表
  const categoryFilters = [
    { id: "all", label: t("plugins.categoryAll") },
    { id: "extension", label: t("plugins.categoryExtension") },
    { id: "skill", label: t("plugins.categorySkill") },
    { id: "prompt", label: t("plugins.categoryPrompt") },
    { id: "theme", label: t("plugins.categoryTheme") },
    { id: "package", label: t("plugins.categoryPackage") },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)", color: "var(--text)", position: "relative" }}>
      {/* 顶部工具栏: 双 Tab 胶囊 + 搜索框 + 排序选择器 + 重载按钮 */}
      <div
        style={{
          padding: "12px 18px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        {/* 双 Tab 胶囊选择器: Installed / Discover */}
        <div
          style={{
            display: "flex",
            background: "var(--bg)",
            padding: 3,
            borderRadius: 7,
            border: "1px solid var(--border)",
          }}
        >
          <button
            onClick={() => setActiveTab("installed")}
            style={{
              padding: "5px 14px",
              fontSize: 12,
              fontWeight: activeTab === "installed" ? 600 : 400,
              background: activeTab === "installed" ? "var(--bg-panel)" : "transparent",
              color: activeTab === "installed" ? "var(--accent)" : "var(--text-dim)",
              border: "none",
              borderRadius: 5,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              transition: "all 0.12s",
            }}
          >
            <span>{t("plugins.installedTab")}</span>
            <span style={{ fontSize: 10, background: "var(--bg-hover)", padding: "1px 5px", borderRadius: 8 }}>
              {installedPackages.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("discover")}
            style={{
              padding: "5px 14px",
              fontSize: 12,
              fontWeight: activeTab === "discover" ? 600 : 400,
              background: activeTab === "discover" ? "var(--bg-panel)" : "transparent",
              color: activeTab === "discover" ? "var(--accent)" : "var(--text-dim)",
              border: "none",
              borderRadius: 5,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              transition: "all 0.12s",
            }}
          >
            <span>{t("plugins.discoverTab")}</span>
          </button>
        </div>

        {/* 搜索框 */}
        <div style={{ flex: 1, minWidth: 200, position: "relative" }}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-dim)" }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder={t("plugins.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "6px 10px 6px 30px",
              fontSize: 12,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text)",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 12 }}
            >
              ✕
            </button>
          )}
        </div>

        {/* 排序选择器 (在 Discover Tab 下呈现) */}
        {activeTab === "discover" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("plugins.sortBy")}:</span>
            <select
              value={sortBy}
              onChange={(e) => handleSortChange(e.target.value as SortOption)}
              style={{
                padding: "5px 8px",
                fontSize: 11,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text)",
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value="downloads">{t("plugins.sortDownloads")}</option>
              <option value="recent">{t("plugins.sortRecent")}</option>
              <option value="name">{t("plugins.sortName")}</option>
            </select>
          </div>
        )}

        {/* 重载按钮 (带变更呼吸高亮灯) */}
        {sessionId && (
          <button
            onClick={handleReloadSession}
            disabled={reloading}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: hasPendingChanges ? 600 : 500,
              background: hasPendingChanges ? "rgba(245, 158, 11, 0.15)" : "var(--bg)",
              border: `1px solid ${hasPendingChanges ? "#f59e0b" : "var(--border)"}`,
              borderRadius: 6,
              color: hasPendingChanges ? "#f59e0b" : "var(--text)",
              cursor: "pointer",
              position: "relative",
              transition: "all 0.2s",
            }}
            title={hasPendingChanges ? t("plugins.pendingReloadNotice") : t("plugins.reloadSession")}
          >
            {hasPendingChanges && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#f59e0b",
                  boxShadow: "0 0 6px #f59e0b",
                }}
              />
            )}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ transform: reloading ? "rotate(360deg)" : "none", transition: "transform 0.8s ease" }}
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            <span>{reloading ? t("plugins.reloading") : hasPendingChanges ? t("plugins.reloadToApply") : t("plugins.reloadSession")}</span>
          </button>
        )}
      </div>

      {/* 包更新汇总条(与 TUI 启动横幅同链路的检测结果;失败静默降级为可重试提示) */}
      {pkgUpdates && !loading && (
        pkgUpdates.summary.outdated > 0 ? (
          <div style={{ padding: "6px 18px", background: "rgba(59, 130, 246, 0.12)", borderBottom: "1px solid rgba(59, 130, 246, 0.25)", color: "#3b82f6", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span>⤴ {t("plugins.updatesAvailableSummary", { n: pkgUpdates.summary.outdated })}</span>
            <button
              onClick={() => void handleUpdateAll()}
              disabled={updatingAll}
              style={{ background: "none", border: "none", color: "#3b82f6", textDecoration: "underline", fontSize: 11, cursor: updatingAll ? "default" : "pointer", fontWeight: 600, whiteSpace: "nowrap", opacity: updatingAll ? 0.6 : 1 }}
            >
              {updatingAll ? t("plugins.updatingAll") : t("plugins.updateAll")}
            </button>
          </div>
        ) : pkgUpdates.error ? (
          <div
            title={pkgUpdates.error}
            style={{ padding: "6px 18px", background: "rgba(239, 68, 68, 0.08)", borderBottom: "1px solid rgba(239, 68, 68, 0.2)", color: "var(--text-dim)", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
          >
            <span>⚠ {t("plugins.updatesCheckFailed")}</span>
            <button onClick={() => void loadPkgUpdates(true)} style={{ background: "none", border: "none", color: "var(--text-dim)", textDecoration: "underline", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>
              {t("plugins.reloadSession")}
            </button>
          </div>
        ) : null
      )}

      {/* 待重载黄色提示条:有会话时引导 Reload Now(点击有效);无会话时变更随新会话自动生效,仅提示不引导 */}
      {hasPendingChanges && (
        <div style={{ padding: "6px 18px", background: "rgba(245, 158, 11, 0.12)", borderBottom: "1px solid rgba(245, 158, 11, 0.25)", color: "#f59e0b", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>⚠️ {sessionId ? t("plugins.pendingReloadNotice") : t("plugins.pendingReloadNoSession")}</span>
          {sessionId && (
            <button onClick={handleReloadSession} style={{ background: "none", border: "none", color: "#f59e0b", textDecoration: "underline", fontSize: 11, cursor: "pointer" }}>{t("plugins.reloadNow")}</button>
          )}
        </div>
      )}

      {/* 提示条 */}
      {actionMessage && (
        <div style={{ padding: "6px 18px", background: "rgba(16, 185, 129, 0.15)", borderBottom: "1px solid rgba(16, 185, 129, 0.3)", color: "#10b981", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <span>✓</span> {actionMessage}
        </div>
      )}
      {actionError && (
        <div style={{ padding: "6px 18px", background: "rgba(239, 68, 68, 0.15)", borderBottom: "1px solid rgba(239, 68, 68, 0.3)", color: "#f87171", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <span>✕</span> {actionError}
        </div>
      )}

      {/* 主视口内容 */}
      <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>

        {/* ========================================================================= */}
        {/* TAB 1: 已安装 (Installed Packages) — 100% 镜像对称 + 复合标签               */}
        {/* ========================================================================= */}
        {activeTab === "installed" && (
          <div>
            {loading ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>
                {t("plugins.loadingPackages")}
              </div>
            ) : filteredInstalled.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", border: "1px dashed var(--border)", borderRadius: 8, color: "var(--text-dim)" }}>
                <div style={{ fontSize: 13, marginBottom: 8 }}>{t("plugins.noInstalled")}</div>
                <button
                  onClick={() => setActiveTab("discover")}
                  style={{ padding: "6px 14px", fontSize: 12, background: "var(--accent)", color: "var(--bg)", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 500 }}
                >
                  {t("plugins.goToDiscover")}
                </button>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
                {filteredInstalled.map((pkg: PluginPackageInfo) => {
                  const key = packageKey(pkg);
                  const isExpanded = expandedPkgKey === key;
                  const meta = getInstalledPackageMetadata(pkg);
                  const webUrl = getPiDevWebUrl(pkg.source);

                  // 检查是否有新版本可用:
                  // 主通道 = 包更新检测(与 pi TUI 启动横幅同链路:registry latest vs 已装版 semver);
                  // 次通道 = configuredVersion 漂移(配置锁版本 ≠ 实际安装版本,保留旧判定兑底)。
                  // 旧实现依赖 Discover tab 才拉取的 marketPackages + pi.dev 解析出的恒定 "latest",
                  // 两通道均失效,检测从未生效(2026-09 修复)
                  const hasUpdate =
                    isPackageUpdateAvailable(pkg.source, pkgUpdates?.updates ?? [], isSamePackage) ||
                    Boolean(pkg.configuredVersion && pkg.version && pkg.configuredVersion !== pkg.version);

                  const isBusyEnable = isActionPending("enable", pkg.source, pkg.scope);
                  const isBusyDisable = isActionPending("disable", pkg.source, pkg.scope);
                  const isBusyUpdate = isActionPending("update", pkg.source, pkg.scope);
                  const isBusyRemove = isActionPending("remove", pkg.source, pkg.scope);
                  const isBusy = isPackageBusy(pkg.source, pkg.scope);

                  return (
                    <div
                      key={key}
                      style={{
                        padding: 14,
                        background: pkg.disabled ? "var(--bg)" : "var(--bg-panel)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        gap: 10,
                        opacity: pkg.disabled ? 0.75 : 1,
                        transition: "all 0.12s",
                      }}
                    >
                      <div>
                        {/* Title & Scope Badge + Multi Category Badges + 直达 Web 链接 */}
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6, marginBottom: 4 }}>
                          <a
                            href={webUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: "var(--text)",
                              wordBreak: "break-all",
                              textDecoration: "none",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                            title={t("plugins.viewOnWeb")}
                            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                          >
                            <span>{pkg.source}</span>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, flexShrink: 0 }}>
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                              <polyline points="15 3 21 3 21 9" />
                              <line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                          </a>

                          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                            <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 4, background: "var(--bg)", color: "var(--accent)", border: "1px solid var(--border)" }}>
                              {pkg.scope === "global" ? t("plugins.scopeGlobal") : t("plugins.scopeProject")}
                            </span>
                            {meta.categories.map((cat, i) => (
                              <span key={i} style={{ fontSize: 10, padding: "1px 4px", borderRadius: 4, background: "var(--bg-hover)", color: "var(--text-dim)" }}>
                                {cat}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Functional Description */}
                        <p style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.45, margin: "4px 0 8px 0" }}>
                          {meta.description}
                        </p>

                        {/* Symmetric Metadata: Downloads + Author + Status + Resource Drawer */}
                        <div style={{ fontSize: 10, color: "var(--text-dim)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span>📥 {meta.downloads}</span>
                            <span>👤 {meta.author}</span>
                            <span style={{ color: pkg.disabled ? "#ef4444" : "#10b981", display: "inline-flex", alignItems: "center", gap: 3 }}>
                              ● {pkg.disabled ? t("plugins.disabled") : t("plugins.enabled")}
                            </span>
                          </div>

                          {pkg.resources.length > 0 && (
                            <button
                              onClick={() => setExpandedPkgKey(isExpanded ? null : key)}
                              style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 10, cursor: "pointer", padding: 0 }}
                            >
                              {isExpanded
                                ? t("plugins.collapseResources")
                                : t("plugins.resourcesCount", { count: pkg.resources.length })}
                            </button>
                          )}
                        </div>

                        {/* Expandable Resource Drawer */}
                        {isExpanded && pkg.resources.length > 0 && (
                          <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--border)", display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {pkg.resources.map((res: { kind: string; name: string }, i: number) => (
                              <span
                                key={i}
                                style={{
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  background: "var(--bg)",
                                  border: "1px solid var(--border)",
                                  fontSize: 10,
                                  color: "var(--text)",
                                }}
                              >
                                <strong style={{ color: "var(--accent)" }}>{res.kind}</strong>: {res.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Footer Actions */}
                      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                            {pkg.version ? `v${pkg.version}` : "v--"}
                          </span>
                          {hasUpdate && (
                            <span style={{ fontSize: 9, background: "#3b82f6", color: "#fff", padding: "1px 4px", borderRadius: 3, fontWeight: 600 }}>
                              {t("plugins.newVersionBadge")}
                            </span>
                          )}
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          {/* Toggle Switch */}
                          <button
                            onClick={() => runPackageAction(pkg.disabled ? "enable" : "disable", pkg.source, pkg.scope)}
                            disabled={Boolean(isBusy)}
                            style={{
                              padding: "3px 8px",
                              fontSize: 11,
                              fontWeight: 500,
                              background: pkg.disabled ? "var(--bg-hover)" : "rgba(16, 185, 129, 0.15)",
                              border: `1px solid ${pkg.disabled ? "var(--border)" : "#10b981"}`,
                              color: pkg.disabled ? "var(--text-dim)" : "#10b981",
                              borderRadius: 4,
                              cursor: "pointer",
                            }}
                          >
                            {isBusyEnable || isBusyDisable ? "..." : pkg.disabled ? t("plugins.enable") : t("plugins.enabled")}
                          </button>

                          {/* Update Button */}
                          <button
                            onClick={() => hasUpdate && runPackageAction("update", pkg.source, pkg.scope)}
                            disabled={!hasUpdate || Boolean(isBusy)}
                            style={{
                              padding: "3px 8px",
                              fontSize: 11,
                              background: hasUpdate ? "#3b82f6" : "var(--bg)",
                              border: "1px solid var(--border)",
                              color: hasUpdate ? "#fff" : "var(--text-dim)",
                              borderRadius: 4,
                              cursor: hasUpdate ? "pointer" : "not-allowed",
                              opacity: hasUpdate ? 1 : 0.45,
                              fontWeight: hasUpdate ? 600 : 400,
                            }}
                            title={hasUpdate ? t("plugins.updateToLatestTitle") : t("plugins.alreadyLatestTitle")}
                          >
                            {isBusyUpdate ? "..." : hasUpdate ? t("plugins.update") : t("plugins.isLatest")}
                          </button>

                          {/* Remove Button */}
                          <button
                            onClick={() => setConfirmDeletePkg(pkg)}
                            disabled={Boolean(isBusy)}
                            style={{
                              padding: "3px 8px",
                              fontSize: 11,
                              background: "none",
                              border: "1px solid var(--border)",
                              color: "#f87171",
                              borderRadius: 4,
                              cursor: "pointer",
                            }}
                            title={t("plugins.uninstallTitle")}
                          >
                            {isBusyRemove ? "..." : t("plugins.remove")}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: 发现市场 (Discover)                                                */}
        {/* ========================================================================= */}
        {activeTab === "discover" && (
          <div>
            {/* Category Filter Pills (纯正 i18n) */}
            <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
              {categoryFilters.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => handleCategoryChange(cat.id)}
                  style={{
                    padding: "4px 12px",
                    fontSize: 11,
                    background: selectedCategory === cat.id ? "var(--accent)" : "var(--bg-panel)",
                    color: selectedCategory === cat.id ? "var(--bg)" : "var(--text-dim)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontWeight: selectedCategory === cat.id ? 600 : 400,
                    transition: "all 0.12s",
                  }}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Market Package Cards Grid */}
            {marketLoading && marketPackages.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>
                {t("plugins.loadingPackages")}
              </div>
            ) : marketPackages.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", border: "1px dashed var(--border)", borderRadius: 8, color: "var(--text-dim)", fontSize: 13 }}>
                {t("plugins.noDiscover")}
              </div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
                  {marketPackages.map((pkg) => {
                    const installed = isMarketPkgInstalled(pkg.name);
                    const isBusyGlobal = isActionPending("install", pkg.installCommand || pkg.name, "global");
                    const isBusyProject = isActionPending("install", pkg.installCommand || pkg.name, "project");
                    const isBusy = isPackageBusy(pkg.installCommand || pkg.name);
                    const webUrl = pkg.webUrl || getPiDevWebUrl(pkg.name);

                    return (
                      <div
                        key={pkg.name}
                        style={{
                          padding: 14,
                          background: "var(--bg-panel)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                          gap: 10,
                        }}
                      >
                        <div>
                          {/* Title & Multi Category Badges + 直达 pi.dev 链接 */}
                          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6, marginBottom: 4 }}>
                            <a
                              href={webUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: "var(--text)",
                                wordBreak: "break-all",
                                textDecoration: "none",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                              title={t("plugins.viewOnWeb")}
                              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                            >
                              <span>{pkg.name}</span>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, flexShrink: 0 }}>
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                <polyline points="15 3 21 3 21 9" />
                                <line x1="10" y1="14" x2="21" y2="3" />
                              </svg>
                            </a>

                            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                              {(pkg.categories || [pkg.category]).map((cat, i) => (
                                <span key={i} style={{ fontSize: 10, padding: "1px 5px", borderRadius: 4, background: "var(--bg)", color: "var(--accent)", border: "1px solid var(--border)" }}>
                                  {cat}
                                </span>
                              ))}
                            </div>
                          </div>

                          <p style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4, margin: "4px 0 8px 0" }}>
                            {pkg.description}
                          </p>

                          <div style={{ fontSize: 10, color: "var(--text-dim)", display: "flex", gap: 10, flexWrap: "wrap" }}>
                            {pkg.downloads && <span>📥 {pkg.downloads}</span>}
                            {pkg.author && <span>👤 {pkg.author}</span>}
                            {pkg.updated && <span>🕒 {pkg.updated}</span>}
                          </div>
                        </div>

                        {/* Footer Actions */}
                        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>v{pkg.version}</span>
                          {installed ? (
                            <span style={{ fontSize: 11, color: "#10b981", fontWeight: 500 }}>
                              ✓ {t("plugins.installed")}
                            </span>
                          ) : (
                            <div style={{ display: "flex", gap: 6 }}>
                              <button
                                onClick={() => handleInstallFromMarket(pkg.installCommand || pkg.name, "global")}
                                disabled={Boolean(isBusy)}
                                style={{
                                  padding: "4px 8px",
                                  fontSize: 11,
                                  fontWeight: 500,
                                  background: "var(--accent)",
                                  color: "var(--bg)",
                                  border: "none",
                                  borderRadius: 4,
                                  cursor: "pointer",
                                }}
                              >
                                {isBusyGlobal ? t("plugins.installing") : t("plugins.installGlobal")}
                              </button>
                              {cwd && (
                                <button
                                  onClick={() => handleInstallFromMarket(pkg.installCommand || pkg.name, "project")}
                                  disabled={Boolean(isBusy)}
                                  style={{
                                    padding: "4px 8px",
                                    fontSize: 11,
                                    background: "var(--bg)",
                                    color: "var(--text)",
                                    border: "1px solid var(--border)",
                                    borderRadius: 4,
                                    cursor: "pointer",
                                  }}
                                >
                                  {isBusyProject ? t("plugins.installing") : t("plugins.installProject")}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 底部加载更多 / 状态栏 */}
                <div style={{ marginTop: 20, textAlign: "center", paddingBottom: 10 }}>
                  {hasMore ? (
                    <button
                      onClick={() => setPage((prev) => prev + 1)}
                      disabled={loadingMore}
                      style={{
                        padding: "8px 24px",
                        fontSize: 12,
                        fontWeight: 500,
                        background: "var(--bg-panel)",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        color: "var(--text)",
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
                    >
                      {loadingMore ? t("plugins.loadingMore") : t("plugins.loadMore")}
                    </button>
                  ) : (
                    <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                      {t("plugins.allLoaded")} ({totalMarketCount || marketPackages.length})
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 卸载二次确认模态弹窗 (支持 Esc 退出，Enter 确认) */}
      {confirmDeletePkg && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1200,
            background: "rgba(0, 0, 0, 0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            backdropFilter: "blur(2px)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmDeletePkg(null);
          }}
        >
          <div
            style={{
              width: 420,
              maxWidth: "100%",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 20,
              boxShadow: "0 12px 36px rgba(0,0,0,0.5)",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20, color: "#f87171" }}>⚠️</span>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
                {t("plugins.confirmUninstallTitle")}
              </div>
            </div>

            <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, margin: 0 }}>
              {t("plugins.confirmUninstallDesc", { source: confirmDeletePkg.source })}
            </p>

            <div style={{ fontSize: 11, color: "var(--text-dim)", background: "var(--bg-panel)", padding: "6px 10px", borderRadius: 5 }}>
              ⌨️ {t("plugins.keyboardHint")}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
              <button
                onClick={() => setConfirmDeletePkg(null)}
                style={{
                  padding: "6px 12px",
                  fontSize: 12,
                  background: "var(--bg-panel)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: "var(--text)",
                  cursor: "pointer",
                }}
              >
                {t("plugins.cancel")}
              </button>
              <button
                onClick={() => {
                  const target = confirmDeletePkg;
                  setConfirmDeletePkg(null);
                  void runPackageAction("remove", target.source, target.scope);
                }}
                style={{
                  padding: "6px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  background: "#ef4444",
                  border: "none",
                  borderRadius: 6,
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                {t("plugins.confirmUninstallBtn")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
