// PowerI Skills 市场目录 — 实时请求 skills.sh 官方 API
// 无任何硬编码技能数据；所有结果来自网络请求，失败时返回空列表并抛出错误供调用方处理。
// 注意：本文件必须保持纯类型依赖（客户端组件会 import matchesSkillQuery），
// 任何 Node 运行时依赖（fs/path/SDK）请放 discover-cache.ts（server-only）。

import type { MarketSkillItem, SkillCategory } from "./skill-subscriptions";

// ─── skills.sh API 响应类型 ──────────────────────────────────────────────────

interface SkillsShResult {
  id: string;        // e.g. "mattpocock/skills/tdd"
  skillId: string;   // e.g. "tdd"
  name: string;
  installs: number;
  source: string;    // e.g. "mattpocock/skills"
}

interface SkillsShSearchResponse {
  query: string;
  skills: SkillsShResult[];
  count: number;
  duration_ms: number;
}

// skills.sh 搜索 API base URL
const SKILLS_SH_API = "https://skills.sh/api/search";

/**
 * skills.sh 官方 API 限制 query 必须至少 2 个字符（否则返回 HTTP 400）。
 * 用于 Discover 市场在无搜索词（浏览模式）时并发查询的高频关键词集合，覆盖热门技能。
 */
export const SKILLS_SH_MIN_QUERY_LENGTH = 2;
export const BROWSE_DISCOVERY_KEYWORDS = ["code", "test", "git", "doc", "ai", "debug", "re"] as const;

/**
 * 统一技能模糊搜索与关键词匹配逻辑（支持 name, description, author, tags 多维匹配）
 */
export function matchesSkillQuery(
  skill: { name: string; description?: string; author?: string; tags?: string[]; sourceLabel?: string },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (skill.name.toLowerCase().includes(q)) return true;
  if (skill.description?.toLowerCase().includes(q)) return true;
  if (skill.author?.toLowerCase().includes(q)) return true;
  if (skill.sourceLabel?.toLowerCase().includes(q)) return true;
  if (skill.tags?.some((t) => t.toLowerCase().includes(q))) return true;
  return false;
}

/**
 * 将 skills.sh API 返回的条目规整为 MarketSkillItem
 */
function toMarketSkillItem(s: SkillsShResult): MarketSkillItem {
  // source 格式: "owner/repo" 或 "owner/repo/path"
  const parts = s.source.split("/");
  const author = parts[0] ?? "unknown";
  const repoUrl = `https://github.com/${parts[0]}/${parts[1] ?? ""}`;

  return {
    id: `skills-sh-${s.id.replace(/\//g, "-")}`,
    name: s.name,
    description: "",          // skills.sh search API 不返回描述，detail 弹窗直接查阅源码 SKILL.md
    author,
    tags: [],
    version: "",
    category: "public" as SkillCategory,
    sourceLabel: "skills.sh",
    subscriptionId: "sub-skills-sh",
    subscriptionUrl: repoUrl,
    sourceType: "skills.sh",
    installed: false,
    enabled: false,
    installs: formatInstalls(s.installs),
  };
}

function formatInstalls(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

/**
 * 向 skills.sh API 发起单次搜索请求
 * @throws 网络错误或非 200 响应时抛出
 */
async function fetchSkillsShSearch(query: string, limit = 30, timeoutMs = 15000): Promise<SkillsShResult[]> {
  const url = `${SKILLS_SH_API}?q=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url, {
    headers: { "Accept": "application/json", "User-Agent": "PowerI/0.2.0" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`skills.sh API error ${res.status}: ${body}`);
  }
  const data = (await res.json()) as SkillsShSearchResponse;
  return data.skills ?? [];
}

/**
 * 实时搜索 skills.sh 市场技能
 *
 * - 有 query（≥2字符）：直接调用 API 搜索
 * - 无 query（浏览模式）：并发请求多个高频关键词，合并去重，按 installs 降序排列
 *
 * @throws 所有请求均失败时抛出，调用方应处理并向用户展示错误状态
 */
export async function queryMarketSkills(
  query = "",
  categoryFilter: SkillCategory | "all" = "all",
): Promise<MarketSkillItem[]> {
  const q = query.trim();
  // skills.sh 全部为 public，business 过滤恒为空且无需请求网络
  if (categoryFilter === "business") {
    return [];
  }

  let rawResults: SkillsShResult[];

  if (q.length >= SKILLS_SH_MIN_QUERY_LENGTH) {
    // 有查询词：直接搜索
    rawResults = await fetchSkillsShSearch(q, 50);
  } else {
    // 浏览模式：并发请求多个短词，合并去重；skills.sh 波动大，用更短的超时快速失败
    const results = await Promise.allSettled(
      BROWSE_DISCOVERY_KEYWORDS.map((kw) => fetchSkillsShSearch(kw, 20, 8000)),
    );

    const seen = new Set<string>();
    rawResults = [];
    for (const r of results) {
      if (r.status === "fulfilled") {
        for (const item of r.value) {
          if (!seen.has(item.id)) {
            seen.add(item.id);
            rawResults.push(item);
          }
        }
      }
    }

    if (rawResults.length === 0) {
      throw new Error("无法连接 skills.sh，请检查网络连接后重试");
    }

    // 按安装量降序
    rawResults.sort((a, b) => b.installs - a.installs);
  }

  const items = rawResults.map(toMarketSkillItem);

  return items;
}
