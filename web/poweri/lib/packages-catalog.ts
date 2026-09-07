// PowerI Packages 官方目录与搜索服务 (实时请求 pi.dev/packages 官方页面 HTML)
// 无任何硬编码包数据；所有结果均来自网络实时解析，失败时返回空列表供前端展示无结果状态。

export interface MarketPackageItem {
  name: string;
  version: string;
  category: "extension" | "skill" | "prompt" | "theme" | "package";
  categories: ("extension" | "skill" | "prompt" | "theme" | "package")[];
  description: string;
  author: string;
  downloads?: string;
  downloadNum?: number;
  updated?: string;
  npmUrl?: string;
  repoUrl?: string;
  webUrl: string; // 直达 pi.dev/packages/<name> 的官方页面链接
  installCommand: string;
}

export interface PackageQueryResult {
  packages: MarketPackageItem[];
  total: number;
  hasMore: boolean;
  page: number;
  sortBy: "downloads" | "recent" | "name";
}

/**
 * 规范化包名/源字符串（用于精确比对，严格区分 scope，如 pi-subagents vs @tintinweb/pi-subagents）
 */
export function normalizePackageSource(source: string): string {
  let s = source.trim().toLowerCase();
  s = s.replace(/^\$?\s*pi\s+install\s+/, "");
  s = s.replace(/^npm:/, "");
  s = s.replace(/^git:/, "");
  // 如果以 https:// 或 git@ 开头，去除协议前缀和末尾 .git
  s = s.replace(/^https?:\/\//, "").replace(/^git@/, "").replace(/\.git$/, "");
  // 去除版本锁定后缀（如 @1.2.3 或 @v1.0.0），注意不要破坏 scoped package 开头的 @scope
  if (s.includes("@")) {
    const atIndex = s.lastIndexOf("@");
    if (atIndex > 0) {
      s = s.slice(0, atIndex);
    }
  }
  return s.trim();
}

/**
 * 精准判定两个包源是否为同一个包
 */
export function isSamePackage(sourceA: string, sourceB: string): boolean {
  if (!sourceA || !sourceB) return false;
  return normalizePackageSource(sourceA) === normalizePackageSource(sourceB);
}

/**
 * 将任意包名规整为在 pi.dev 上展示的标准 Web URL
 */
export function getPiDevWebUrl(sourceOrName: string): string {
  const clean = sourceOrName
    .replace(/^\$?\s*pi\s+install\s+/, "")
    .replace(/^npm:/, "")
    .replace(/^git:/, "")
    .trim();
  return `https://pi.dev/packages/${clean}`;
}

// 内存缓存已拉取的页面数据，提升连续翻页与搜索体验
const pageCache: Record<string, { items: MarketPackageItem[]; total: number; time: number }> = {};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟有效

/**
 * 查找指定包的元数据（优先从内存缓存中检索；若缓存未命中，基于包名生成确定的结构化元数据）
 */
export function findPackageMetadata(sourceOrName: string): Partial<MarketPackageItem> | undefined {
  if (!sourceOrName) return undefined;
  for (const entry of Object.values(pageCache)) {
    const found = entry.items.find((p) => isSamePackage(p.name, sourceOrName));
    if (found) return found;
  }

  // 冷启动保底：根据真实包名规整基础元数据（无虚假指标数据）
  const cleanName = normalizePackageSource(sourceOrName);
  if (!cleanName) return undefined;

  let author: string | undefined = undefined;
  if (cleanName.startsWith("@") && cleanName.includes("/")) {
    author = cleanName.slice(1, cleanName.indexOf("/"));
  }

  return {
    name: cleanName,
    author,
    webUrl: getPiDevWebUrl(cleanName),
    installCommand: `npm:${cleanName}`,
  };
}

/**
 * 解析 pi.dev 官方 HTML 页面中的 packages 卡片与总数
 */
export function parsePiDevPackagesHtmlWithTotal(html: string): { items: MarketPackageItem[]; total: number } {
  const items: MarketPackageItem[] = [];

  // 解析总数 (例如: <span class="packages-count">1-50 / 5387</span>)
  let total = 0;
  const countMatch = html.match(/class="packages-count"[^>]*>[\s\S]*?\/\s*([\d,]+)/i);
  if (countMatch) {
    total = parseInt(countMatch[1].replace(/,/g, ""), 10) || 0;
  }

  const articleRegex = /<article([^>]*)>([\s\S]*?)<\/article>/gi;
  let match: RegExpExecArray | null;

  while ((match = articleRegex.exec(html)) !== null) {
    const attrs = match[1];
    const body = match[2];

    if (!attrs.includes('data-package-card="true"')) continue;

    const nameMatch = attrs.match(/data-package-name="([^"]+)"/) ||
      body.match(/<h3[^>]*class="packages-name"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
    const name = nameMatch?.[1]?.trim();
    if (!name) continue;

    const typeMatch = attrs.match(/data-package-types="([^"]*)"/) ||
      body.match(/data-package-types="([^"]*)"/) ||
      body.match(/<span[^>]*class="[^"]*packages-badge"[^>]*>([^<]+)<\/span>/i);

    const rawType = typeMatch?.[1]?.toLowerCase() || "";
    const categories: MarketPackageItem["categories"] = [];
    if (rawType.includes("extension")) categories.push("extension");
    if (rawType.includes("skill")) categories.push("skill");
    if (rawType.includes("prompt")) categories.push("prompt");
    if (rawType.includes("theme")) categories.push("theme");
    if (categories.length === 0) categories.push("package");

    const category = categories[0];

    const descMatch = body.match(/<p[^>]*class="packages-desc"[^>]*>([\s\S]*?)<\/p>/i);
    const description = descMatch?.[1]?.replace(/<[^>]+>/g, "").trim() || "No description provided.";

    const metaMatch = body.match(/<div[^>]*class="packages-meta"[^>]*>([\s\S]*?)<\/div>/i);
    let author = "";
    let downloads = "";
    let updated = "";
    if (metaMatch) {
      const spans = [...metaMatch[1].matchAll(/<span[^>]*>([^<]+)<\/span>/gi)].map((m) => m[1].trim());
      author = spans[0] || "";
      downloads = spans[1] || "";
      updated = spans[2] || "";
    }

    const npmMatch = body.match(/href="(https:\/\/www\.npmjs\.com\/package\/[^"]+)"/i);
    const repoMatch = body.match(/href="(https:\/\/github\.com\/[^"]+)"/i);

    // 解析下载数字
    const rawDownloads = attrs.match(/data-package-downloads="(\d+)"/);
    const downloadNum = rawDownloads ? parseInt(rawDownloads[1], 10) : 0;

    items.push({
      name,
      version: "latest",
      category,
      categories,
      description,
      author,
      downloads,
      downloadNum,
      updated,
      npmUrl: npmMatch?.[1] || `https://www.npmjs.com/package/${name}`,
      repoUrl: repoMatch?.[1],
      webUrl: `https://pi.dev/packages/${name}`,
      installCommand: `npm:${name}`,
    });
  }

  if (total === 0) {
    total = items.length;
  }

  return { items, total };
}

/**
 * 实时从 pi.dev 官方翻页抓取真实数据（完全无硬编码）
 */
export async function fetchFromPiDevPaged(params: {
  query?: string;
  category?: string;
  page?: number;
  sort?: "downloads" | "recent" | "name";
}): Promise<{ items: MarketPackageItem[]; total: number }> {
  const q = (params.query || "").trim();
  const cat = params.category || "all";
  const page = Math.max(1, params.page || 1);
  const sort = params.sort || "downloads";

  const cacheKey = `${cat}:${page}:${sort}:${q}`;
  const cached = pageCache[cacheKey];
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
    return { items: cached.items, total: cached.total };
  }

  try {
    const searchParams = new URLSearchParams();
    if (q) searchParams.set("name", q);
    if (cat !== "all") searchParams.set("type", cat);
    if (page > 1) searchParams.set("page", String(page));
    if (sort) searchParams.set("sort", sort);

    const url = `https://pi.dev/packages?${searchParams.toString()}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PowerI-Desktop/0.2.0; +https://github.com/cgoder/pi-web)",
        Accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) {
      const html = await res.text();
      const { items, total } = parsePiDevPackagesHtmlWithTotal(html);
      pageCache[cacheKey] = { items, total, time: Date.now() };
      return { items, total };
    }
  } catch (err) {
    console.warn("[fetchFromPiDevPaged] failed to fetch from pi.dev:", err instanceof Error ? err.message : err);
  }

  return { items: [], total: 0 };
}

/**
 * 统一搜索与分页获取 packages 目录（纯实时请求，无假数据）
 */
export async function searchPiPackages(params: {
  query?: string;
  category?: string;
  page?: number;
  sort?: "downloads" | "recent" | "name";
}): Promise<PackageQueryResult> {
  const q = (params.query || "").trim();
  const cat = params.category || "all";
  const page = Math.max(1, params.page || 1);
  const sort = params.sort || "downloads";

  const { items, total } = await fetchFromPiDevPaged({
    query: q,
    category: cat,
    page,
    sort,
  });

  const hasMore = page * 50 < total;

  return {
    packages: items,
    total,
    hasMore,
    page,
    sortBy: sort,
  };
}
