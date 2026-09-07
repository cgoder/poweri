// PowerI Discover 缓存 — server-only（依赖 Node fs 与 Agent SDK，绝不能进入客户端 bundle）。
// skills.sh 单请求波动 1~4s、浏览模式并发 7 请求可达 7s，若每次打开面板都实时拉取
// 会显著拖慢页面。两级缓存：内存 TTL（进程内反复打开秒回）+ 磁盘持久化
// （~/.pi/agent/poweri-discover-cache.json，重启应用后首次打开也命中）。
// 公共市场目录一天才变几次，30 分钟 TTL 足够。

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";
import type { MarketSkillItem } from "./skill-subscriptions";

export const DISCOVER_TTL_MS = 30 * 60 * 1000;

const memoryCache = new Map<string, { items: MarketSkillItem[]; at: number }>();

function cacheFilePath(): string {
  return path.join(getAgentDir(), "poweri-discover-cache.json");
}

/**
 * 读取缓存：每次调用都读盘并以磁盘为权威（避免跨进程/环境切换时内存状态失配）。
 * 命中且未过期返回条目；过期、缺失或损坏返回 null（调用方走网络）。
 */
export function getCachedDiscover(key: string): MarketSkillItem[] | null {
  try {
    const file = cacheFilePath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
        entries: Array<{ key: string; items: MarketSkillItem[]; at: number }>;
      };
      for (const e of data.entries ?? []) {
        memoryCache.set(e.key, { items: e.items, at: e.at });
      }
    }
  } catch {
    // 损坏或版本不符：忽略，走网络拉取
  }
  const hit = memoryCache.get(key);
  if (hit && Date.now() - hit.at < DISCOVER_TTL_MS) {
    return hit.items;
  }
  return null;
}

/** 写入缓存（内存 + 磁盘回写；回写失败静默——缓存只是加速不是功能） */
export function setCachedDiscover(key: string, items: MarketSkillItem[]): void {
  memoryCache.set(key, { items, at: Date.now() });
  try {
    const file = cacheFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const entries = [...memoryCache.entries()].map(([k, v]) => ({ key: k, items: v.items, at: v.at }));
    fs.writeFileSync(file, JSON.stringify({ version: 1, entries }));
  } catch {
    // 静默
  }
}

/** 清空内存与磁盘缓存（测试与调试用） */
export function clearMarketSkillsCache(): void {
  memoryCache.clear();
  try {
    fs.rmSync(cacheFilePath(), { force: true });
  } catch {
    // 静默
  }
}
