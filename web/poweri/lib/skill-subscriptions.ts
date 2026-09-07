import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { queryMarketSkills, matchesSkillQuery } from "./skills-catalog";
import { getCachedDiscover, setCachedDiscover } from "./discover-cache";
import { setDisableModelInvocation } from "@/lib/skill-frontmatter";
export { queryMarketSkills };
import { parseFrontmatter } from "@/lib/frontmatter";
import { loadSkillsWithInstallInfo } from "@/lib/skills-service";
import {
  getInstall,
  localDirHash,
  remoteTreeHash,
  resolveCacheDir,
  upsertInstall,
  type SkillInstallRecord,
} from "./skill-install-registry";

const execFileAsync = promisify(execFile);

export type SkillCategory = "public" | "business";

export interface SkillSubscription {
  id: string;
  url: string;
  name?: string;
  category: SkillCategory;
  type: "git" | "manifest" | "url";
  authType?: "none" | "token";
  token?: string;
  addedAt: number;
  lastSyncedAt?: number;
  error?: string;
  isDefault?: boolean;
}

export interface MarketSkillItem {
  id: string;
  name: string;
  description: string;
  version?: string;
  tags?: string[];
  author?: string;
  category: SkillCategory;
  sourceLabel?: string;
  subscriptionId: string;
  subscriptionUrl: string;
  sourceType: "git" | "manifest" | "builtin" | "local" | "skills.sh";
  installed: boolean;
  enabled: boolean;
  localPath?: string;
  rawContent?: string;
  installs?: string;
  /** 更新状态：up-to-date / update-available / conflict / unknown-origin（未知来源永不给更新入口） */
  updateState?: "up-to-date" | "update-available" | "conflict" | "unknown-origin";
  /** 登记时的 sourceTreeHash */
  installedVersion?: string;
  /** 当前远端 tree hash */
  latestVersion?: string;
  /** 技能所属的插件包 source(如 npm:pi-mcp-adapter;仅 plugin/local 来源技能携带)。
   *  用于把包更新检测结果映射为技能卡片提示(包有新版本 → 其携带的技能可随包更新)。 */
  packageSource?: string;
}

export interface MarketSourceStat {
  subscriptionId: string;
  name: string;
  total: number;
  outdated: number;
  conflict: number;
  error?: string;
  lastSyncedAt?: number;
}

export interface MarketManifest {
  name?: string;
  description?: string;
  version?: string;
  category?: SkillCategory;
  skills: Array<{
    id: string;
    name: string;
    description: string;
    version?: string;
    tags?: string[];
    author?: string;
    category?: SkillCategory;
    source?: string;
    path?: string;
    content?: string;
  }>;
}

/**
 * 默认订阅源（2026-09 拍板：只保留 skills.sh 官方源，服务于用户搜索/发现；
 * 业务/精选源一律由用户手动配置，不再预置）。
 */
export const DEFAULT_SUBSCRIPTIONS: SkillSubscription[] = [
  {
    id: "sub-skills-sh",
    url: "https://github.com/vercel-labs/skills.git",
    name: "skills.sh 官方源",
    category: "public",
    type: "git",
    addedAt: 1700000000000,
    isDefault: true,
  },
];

function getSubscriptionsFilePath(): string {
  const dir = getAgentDir();
  return path.join(dir, "poweri-subscriptions.json");
}

function getSubscriptionsCacheDir(): string {
  const dir = path.join(getAgentDir(), "git-subscriptions");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getUserSkillsDir(): string {
  const dir = path.join(getAgentDir(), "skills");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function readSubscriptions(): SkillSubscription[] {
  const file = getSubscriptionsFilePath();
  if (!fs.existsSync(file)) {
    try {
      writeSubscriptions(DEFAULT_SUBSCRIPTIONS);
    } catch {
      // ignore
    }
    return DEFAULT_SUBSCRIPTIONS;
  }
  try {
    const raw = fs.readFileSync(file, "utf8");
    const data = JSON.parse(raw);
    return migrateRemovedDefaults(Array.isArray(data) ? data : DEFAULT_SUBSCRIPTIONS);
  } catch {
    return DEFAULT_SUBSCRIPTIONS;
  }
}

/**
 * 默认源收敛迁移（2026-09 拍板）：旧版本预置的默认源（isDefault 标记）若已不在
 * DEFAULT_SUBSCRIPTIONS 白名单内（如 LITTA 团队源、404 的 Pi 精选源），读取时移除
 * 并写回文件、清理其缓存克隆目录；用户手动添加的源（无 isDefault）不受影响。
 * 已安装技能的本地文件与登记表不动（与 removeSubscription 语义一致）。
 * 迁移幂等：过滤后集合满足白名单，不会重复触发写。
 */
function migrateRemovedDefaults(subs: SkillSubscription[]): SkillSubscription[] {
  const defaultIds = new Set(DEFAULT_SUBSCRIPTIONS.map((d) => d.id));
  const stale = subs.filter((s) => s.isDefault && !defaultIds.has(s.id));
  if (stale.length === 0) return subs;
  const next = subs.filter((s) => !stale.some((r) => r.id === s.id));
  try {
    writeSubscriptions(next);
    for (const s of stale) {
      const cacheDir = resolveCacheDir(s.id);
      if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
      }
    }
  } catch {
    // 迁移写回失败不影响本次读取（内存中已过滤；下次读取重试）
  }
  return next;
}

export function writeSubscriptions(subs: SkillSubscription[]): void {
  const file = getSubscriptionsFilePath();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // 凭据零泄露：订阅文件含 token，权限收紧到 0600（新建与已存在文件都收）
  fs.writeFileSync(file, JSON.stringify(subs, null, 2), { mode: 0o600, encoding: "utf8" });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows 上 chmod 语义有限，忽略
  }
}

export function generateSubscriptionId(url?: string): string {
  if (url) {
    const clean = url.replace(/[^a-zA-Z0-9]/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
    if (clean) return `sub-${clean}-${Date.now().toString(36)}`;
  }
  return `sub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// 实现移至客户端安全模块 subscription-url.ts（原因见该文件头注释）；此处 re-export 保持既有调用方不变
export { detectSubscriptionType } from "./subscription-url";

export function addSubscription(sub: Omit<SkillSubscription, "id" | "addedAt">): SkillSubscription {
  const subs = readSubscriptions();
  const id = generateSubscriptionId();
  const newSub: SkillSubscription = {
    ...sub,
    id,
    addedAt: Date.now(),
  };
  subs.push(newSub);
  writeSubscriptions(subs);
  return newSub;
}

export function updateSubscription(id: string, updates: Partial<SkillSubscription>): SkillSubscription | null {
  const subs = readSubscriptions();
  const index = subs.findIndex((s) => s.id === id);
  if (index === -1) return null;
  const urlChanged = updates.url !== undefined && updates.url !== subs[index].url;
  subs[index] = { ...subs[index], ...updates };
  writeSubscriptions(subs);
  // url 变更 → 缓存克隆作废：删掉等下次同步重克隆，避免 .git/config 的 origin 指向旧仓库
  if (urlChanged) {
    const cacheDir = resolveCacheDir(id);
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  }
  return subs[index];
}

export function removeSubscription(id: string): boolean {
  const subs = readSubscriptions();
  const next = subs.filter((s) => s.id !== id);
  if (next.length === subs.length) return false;
  writeSubscriptions(next);
  // 清理缓存目录，避免孤儿目录堆积（id 含时间戳，重加同源会生成新 id）
  const cacheDir = resolveCacheDir(id);
  if (fs.existsSync(cacheDir)) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
  return true;
}

function parseSkillFile(filePath: string): {
  name: string;
  description: string;
  tags?: string[];
  disabled?: boolean;
  rawContent?: string;
} {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = parseFrontmatter(raw);
    const meta = (parsed.data || {}) as Record<string, unknown>;
    return {
      name: String(meta.name || ""),
      description: String(meta.description || ""),
      tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
      disabled: Boolean(meta["disable-model-invocation"]),
      rawContent: raw,
    };
  } catch {
    return { name: "", description: "", tags: [], disabled: false };
  }
}

function findSkillFilesRecursively(dir: string, depth = 0, maxDepth = 4): string[] {
  if (depth > maxDepth || !fs.existsSync(dir)) return [];
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith(".") || ent.name === "node_modules") continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        const directSkill = path.join(full, "SKILL.md");
        if (fs.existsSync(directSkill)) {
          results.push(directSkill);
        } else {
          results.push(...findSkillFilesRecursively(full, depth + 1, maxDepth));
        }
      } else if (ent.isFile() && ent.name === "SKILL.md") {
        results.push(full);
      }
    }
  } catch {
    // ignore
  }
  return results;
}

/** 同步 TTL：TTL 内重复调用跳过网络，只解析本地缓存。 */
export const SYNC_TTL_MS = 10 * 60 * 1000;

/**
 * 构造带凭据的 git URL（仅 http(s) 源；token 作为 oauth2 用户名/密码内嵌）。
 * 该 URL 只用于本次 clone/fetch 进程，绝不落盘（见 fetchGitCache）。
 */
export function buildAuthenticatedUrl(url: string, token?: string): string {
  if (token && url.startsWith("http")) {
    try {
      const u = new URL(url);
      u.username = "oauth2";
      u.password = token;
      return u.toString();
    } catch {
      // ignore
    }
  }
  return url;
}

/**
 * 错误消息脱敏：替换已知 token 与 URL 内嵌凭据形态（https://user:pass@host）。
 * 短 token（<4 字符）不替换，避免误伤普通文本。
 */
export function redactSecrets(message: string, secrets: Array<string | undefined>): string {
  let out = message;
  for (const s of secrets) {
    if (s && s.length >= 4) {
      out = out.split(s).join("***");
    }
  }
  out = out.replace(/(https?:\/\/)[^/@\s]+@/g, "$1***@");
  return out;
}

async function fetchGitCache(sub: SkillSubscription, targetDir: string): Promise<void> {
  const authenticatedUrl = buildAuthenticatedUrl(sub.url, sub.token);

  if (fs.existsSync(targetDir) && fs.existsSync(path.join(targetDir, ".git"))) {
    try {
      // 一次性注入带凭据的 URL（-c 只对本次进程生效，不写 .git/config）
      await execFileAsync("git", ["-c", `remote.origin.url=${authenticatedUrl}`, "fetch", "--depth=1", "origin"], {
        cwd: targetDir,
        timeout: 25000,
      });
      await execFileAsync("git", ["reset", "--hard", "origin/HEAD"], {
        cwd: targetDir,
        timeout: 10000,
      });
    } catch {
      try {
        await execFileAsync("git", ["-c", `remote.origin.url=${authenticatedUrl}`, "pull", "--ff-only"], {
          cwd: targetDir,
          timeout: 25000,
        });
      } catch (err) {
        throw new Error(
          `Git update failed: ${redactSecrets(err instanceof Error ? err.message : String(err), [sub.token])}`,
        );
      }
    }
  } else {
    try {
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
      await execFileAsync("git", ["clone", "--depth=1", authenticatedUrl, targetDir], {
        timeout: 45000,
      });
      // clone 会把 URL（含凭据）写进 .git/config 的 origin —— 立即清回无凭据 URL
      await execFileAsync("git", ["remote", "set-url", "origin", sub.url], {
        cwd: targetDir,
        timeout: 10000,
      });
    } catch (err) {
      throw new Error(
        `Git clone failed: ${redactSecrets(err instanceof Error ? err.message : String(err), [sub.token])}`,
      );
    }
  }
}

/**
 * 判定已安装技能的更新状态。
 * 判定表（工单 skill-repo-updates/03，规则内联防 scratch 清理后失据）：
 * - 无登记记录：内容与某源缓存一致 → 补记 inferred；跨源同名歧义 → unknown-origin
 * - origin: unknown → unknown-origin，永不给更新入口
 * - 本地摘要 ≠ 基线 → conflict（优先级最高，开关休眠行不计入哈希）
 * - 基线版本 == 远程 tree hash → up-to-date；否则 update-available
 * - 同步失败：旧缓存继续解析 = 上次已知结果；缓存也不可读 → 无状态（不误报）
 * 判定全部基于本地缓存与登记表，零网络。
 *
 * 无登记的老安装：内容比对（名字必然命中无法区分异源同名）——内容与当前远端一致才补记
 * origin: inferred；否则 unknown-origin，永不给更新入口。
 */
async function resolveUpdateState(args: {
  folderName: string;
  cacheDir: string;
  skillDir: string;
  destDir: string;
  sub: SkillSubscription;
}): Promise<{
  updateState?: MarketSkillItem["updateState"];
  installedVersion?: string;
  latestVersion?: string;
}> {
  const { folderName, cacheDir, skillDir, destDir, sub } = args;
  if (!fs.existsSync(destDir)) return {};

  const record = getInstall(folderName);

  if (!record) {
    let currentLocal: string;
    let cacheContentHash: string;
    try {
      currentLocal = localDirHash(destDir);
      cacheContentHash = localDirHash(skillDir);
    } catch {
      return { updateState: "unknown-origin" };
    }
    if (currentLocal !== cacheContentHash) {
      return { updateState: "unknown-origin" };
    }
    // 跨源同名歧义（2026-09-01 决策：歧义取 unknown，安全优先）：
    // 其他 git 源缓存中存在同名技能且内容也与本地一致时，判不出唯一来源，不补记
    const folderBasename = path.basename(skillDir);
    const ambiguous = readSubscriptions().some((candidate) => {
      if (candidate.id === sub.id || candidate.type !== "git") return false;
      const candCacheDir = resolveCacheDir(candidate.id);
      const candSkillFile = findSkillFilesRecursively(candCacheDir).find(
        (f) => path.basename(path.dirname(f)) === folderBasename,
      );
      if (!candSkillFile) return false;
      try {
        return localDirHash(path.dirname(candSkillFile)) === currentLocal;
      } catch {
        return false;
      }
    });
    if (ambiguous) {
      return { updateState: "unknown-origin" };
    }
    const skillPath = path.posix.relative(cacheDir, skillDir);
    try {
      const latest = await remoteTreeHash(cacheDir, skillPath);
      upsertInstall({
        folder: folderName,
        origin: "inferred",
        subscriptionId: sub.id,
        repoUrl: sub.url,
        skillPath,
        sourceTreeHash: latest,
        baselineLocalHash: currentLocal,
        disabled: parseSkillFile(path.join(destDir, "SKILL.md")).disabled,
        installedAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { updateState: "up-to-date", installedVersion: latest, latestVersion: latest };
    } catch {
      return { updateState: "unknown-origin" };
    }
  }

  if (record.origin === "unknown") {
    return { updateState: "unknown-origin", installedVersion: record.sourceTreeHash };
  }

  // 有登记：conflict 优先（本地偏离，优先级最高）
  let currentLocal: string;
  try {
    currentLocal = localDirHash(destDir);
  } catch {
    return {}; // 无法判定不给状态，不误报
  }
  if (record.baselineLocalHash && currentLocal !== record.baselineLocalHash) {
    return { updateState: "conflict", installedVersion: record.sourceTreeHash };
  }
  if (!record.skillPath || !record.sourceTreeHash) {
    return { updateState: "unknown-origin", installedVersion: record.sourceTreeHash };
  }
  try {
    const latest = await remoteTreeHash(cacheDir, record.skillPath);
    if (latest === record.sourceTreeHash) {
      return { updateState: "up-to-date", installedVersion: record.sourceTreeHash, latestVersion: latest };
    }
    return { updateState: "update-available", installedVersion: record.sourceTreeHash, latestVersion: latest };
  } catch {
    return {}; // 缓存不可读 = 无上次已知可依，不给状态（fail-soft，不误报 unknown-origin）
  }
}

/** 供更新服务（skill-update-service）复用：同步（含 TTL/force）与已安装技能状态判定。 */
export { syncGitSubscription, resolveUpdateState };

async function syncGitSubscription(
  sub: SkillSubscription,
  opts: { force?: boolean } = {},
): Promise<MarketSkillItem[]> {
  const cacheBase = getSubscriptionsCacheDir();
  const targetDir = path.join(cacheBase, sub.id);

  const withinTtl = !opts.force && sub.lastSyncedAt !== undefined && Date.now() - sub.lastSyncedAt < SYNC_TTL_MS;
  if (!withinTtl) {
    try {
      await fetchGitCache(sub, targetDir);
      sub.error = undefined; // 本次拉取成功，清除历史错误
      // lastSyncedAt 仅在真实网络成功时推进（内聚语义，getMarketSkills/checkUpdates 共用）；
      // TTL 内跳过网络时绝不推进，否则滑动窗口会变成永久缓存
      sub.lastSyncedAt = Date.now();
    } catch (err) {
      // 失败退避：失败也写 lastSyncedAt，同 TTL 窗内不再重试——
      // 防止死源（如仓库 404）在每次打开面板时都白烧一次网络超时。
      // sub.error 会展示在源胶囊条上；手动“更新全部/检查”走 force 不受退避影响。
      sub.lastSyncedAt = Date.now();
      // fail-soft：有旧缓存就继续解析旧内容，错误记入 sub.error，不让整个源归零
      if (!fs.existsSync(targetDir) || !fs.existsSync(path.join(targetDir, ".git"))) {
        throw err;
      }
      sub.error = redactSecrets(err instanceof Error ? err.message : String(err), [sub.token]);
    }
  }

  const skillFiles = findSkillFilesRecursively(targetDir);
  const items: MarketSkillItem[] = [];
  const userSkillsDir = getUserSkillsDir();

  for (const skillFile of skillFiles) {
    const skillDir = path.dirname(skillFile);
    const skillFolderName = path.basename(skillDir);
    const { name, description, tags, rawContent } = parseSkillFile(skillFile);

    const destDir = path.join(userSkillsDir, skillFolderName);
    const isInstalled = fs.existsSync(destDir);
    let isEnabled = true;
    if (isInstalled) {
      const localFile = path.join(destDir, "SKILL.md");
      if (fs.existsSync(localFile)) {
        const localMeta = parseSkillFile(localFile);
        isEnabled = !localMeta.disabled;
      }
    }

    const update = isInstalled
      ? await resolveUpdateState({ folderName: skillFolderName, cacheDir: targetDir, skillDir, destDir, sub })
      : {};

    const skillId = `${sub.id}-${skillFolderName}`;
    items.push({
      id: skillId,
      name: name || skillFolderName,
      description: description || (sub.category === "business" ? "来自团队业务订阅源的技能" : "来自公共精选源的技能"),
      tags,
      category: sub.category,
      sourceLabel: sub.name || (sub.category === "business" ? "业务源" : "公共源"),
      subscriptionId: sub.id,
      subscriptionUrl: sub.url,
      sourceType: "git",
      installed: isInstalled,
      enabled: isInstalled && isEnabled,
      localPath: skillFile,
      rawContent,
      updateState: update.updateState,
      installedVersion: update.installedVersion,
      latestVersion: update.latestVersion,
    });
  }

  return items;
}

async function syncManifestSubscription(sub: SkillSubscription): Promise<MarketSkillItem[]> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (sub.token) {
    headers["Authorization"] = `Bearer ${sub.token}`;
  }
  const res = await fetch(sub.url, { headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  const manifest = (await res.json()) as MarketManifest;
  if (!Array.isArray(manifest.skills)) {
    return [];
  }

  const items: MarketSkillItem[] = [];
  const userSkillsDir = getUserSkillsDir();

  for (const skill of manifest.skills) {
    const userSkillTarget = path.join(userSkillsDir, skill.id);
    const isInstalled = fs.existsSync(userSkillTarget);
    let isEnabled = true;
    if (isInstalled) {
      const localFile = path.join(userSkillTarget, "SKILL.md");
      if (fs.existsSync(localFile)) {
        const localMeta = parseSkillFile(localFile);
        isEnabled = !localMeta.disabled;
      }
    }

    items.push({
      id: skill.id,
      name: skill.name || skill.id,
      description: skill.description || "",
      version: skill.version,
      tags: skill.tags,
      author: skill.author,
      category: skill.category || manifest.category || sub.category,
      sourceLabel: sub.name || (sub.category === "business" ? "业务清单" : "公共清单"),
      subscriptionId: sub.id,
      subscriptionUrl: sub.url,
      sourceType: "manifest",
      installed: isInstalled,
      enabled: isInstalled && isEnabled,
      rawContent: skill.content,
    });
  }

  return items;
}

/**
 * 获取所有市场技能与已安装技能列表（支持分类与模糊搜索）
 * @param opts.forceSync 强制跳过 TTL 同步全部订阅源（UI“检查更新”用）
 * @param opts.discover 是否拉取 skills.sh Discover 市场数据（默认 false；前端进入 Discover tab 时才开启）
 */
export async function getMarketSkills(
  cwd: string,
  categoryFilter?: SkillCategory | "all",
  searchQuery?: string,
  opts?: { forceSync?: boolean; discover?: boolean },
): Promise<{
  skills: MarketSkillItem[];
  subscriptions: SkillSubscription[];
  sources: MarketSourceStat[];
}> {
  const subscriptions = readSubscriptions();
  const marketSkills: MarketSkillItem[] = [];
  const sourceCounts = new Map<string, { total: number; outdated: number; conflict: number }>();

  // 1. 同步并解析各订阅源（串行 fetch，互不并行：避免多个 git fetch 抢带宽）
  //    与 2. 的 Discover 拉取并行执行，避免每次打开面板都串行相加等待
  const sourceSyncPromise = (async () => {
    for (const sub of subscriptions) {
      try {
        if (sub.type === "git") {
          const items = await syncGitSubscription(sub, { force: opts?.forceSync });
          marketSkills.push(...items);
          // lastSyncedAt 推进已内聚到 syncGitSubscription（成功才推进、失败退避）
        } else if (sub.type === "manifest") {
          const items = await syncManifestSubscription(sub);
          marketSkills.push(...items);
          sub.error = undefined;
          sub.lastSyncedAt = Date.now();
        }
      } catch (err) {
        sub.error = redactSecrets(err instanceof Error ? err.message : String(err), [sub.token]);
      }
    }
    writeSubscriptions(subscriptions);
  })();

  // 2. 从 skills.sh 获取 Discover 市场技能（无硬编码数据；
  //    仅在 opts.discover 显式开启时拉取（前端懒加载：进入 Discover tab 才请求），
  //    命中 discover-cache 两级缓存时零开销，且与订阅源同步并行）
  const discoverNeeded = opts?.discover === true && categoryFilter !== "business";
  const discoverKey = `${categoryFilter || "all"}|${(searchQuery || "").trim()}`;
  const cachedDiscover = discoverNeeded ? getCachedDiscover(discoverKey) : null;
  const discoverPromise = !discoverNeeded
    ? Promise.resolve([] as MarketSkillItem[])
    : cachedDiscover !== null
      ? Promise.resolve(cachedDiscover)
      : queryMarketSkills(searchQuery || "", categoryFilter || "all")
          .then((items) => {
            setCachedDiscover(discoverKey, items);
            return items;
          })
          .catch((err) => {
            // 网络不可用时 Discover 列表为空，不影响已安装技能的展示
            console.warn("[getMarketSkills] skills.sh unreachable:", err instanceof Error ? err.message : err);
            return [] as MarketSkillItem[];
          });

  const [, marketDiscoverSkills] = await Promise.all([sourceSyncPromise, discoverPromise]);

  // 订阅源技能计数（Discover/local 不计入 sources）
  for (const item of marketSkills) {
    if (item.sourceType !== "git" && item.sourceType !== "manifest") continue;
    const counts = sourceCounts.get(item.subscriptionId) || { total: 0, outdated: 0, conflict: 0 };
    counts.total += 1;
    if (item.updateState === "update-available") counts.outdated += 1;
    if (item.updateState === "conflict") counts.conflict += 1;
    sourceCounts.set(item.subscriptionId, counts);
  }
  const sources: MarketSourceStat[] = subscriptions.map((sub) => ({
    subscriptionId: sub.id,
    name: sub.name || (sub.category === "business" ? "业务源" : "公共源"),
    total: sourceCounts.get(sub.id)?.total ?? 0,
    outdated: sourceCounts.get(sub.id)?.outdated ?? 0,
    conflict: sourceCounts.get(sub.id)?.conflict ?? 0,
    error: sub.error,
    lastSyncedAt: sub.lastSyncedAt,
  }));

  // 3. 加载本地与环境自带的已装 Skills，合并与精准归类
  try {
    const localRes = await loadSkillsWithInstallInfo(cwd);
    const localSkills = localRes.skills || [];

    for (const ls of localSkills) {
      let localRaw = "";
      if (ls.filePath && fs.existsSync(ls.filePath)) {
        try {
          localRaw = fs.readFileSync(ls.filePath, "utf8");
        } catch {
          // ignore
        }
      }

      const existing = marketSkills.find(
        (m) =>
          m.name.toLowerCase() === ls.name.toLowerCase() ||
          (m.localPath &&
            ls.filePath &&
            path.basename(path.dirname(m.localPath)) === path.basename(path.dirname(ls.filePath))),
      );

      if (existing) {
        existing.installed = true;
        existing.enabled = !ls.disableModelInvocation;
        existing.localPath = ls.filePath;
        // 订阅源技能若实际由插件包提供(如 npm 包内技能),包归属以资源加载器为准
        if (!existing.packageSource && ls.sourceInfo?.source) {
          existing.packageSource = ls.sourceInfo.source;
        }
        if (localRaw && !existing.rawContent) {
          existing.rawContent = localRaw;
        }
      } else {
        // 没有匹配到任何订阅源的本地技能，严格归入 "local"
        const isBusiness = ls.filePath?.includes("business") || ls.filePath?.includes("litta");
        marketSkills.push({
          id: `local-${ls.name}`,
          name: ls.name,
          description: ls.description || "本地创建的 Agent 技能",
          category: isBusiness ? "business" : "public",
          sourceLabel: "Local",
          subscriptionId: "local",
          subscriptionUrl: "local",
          sourceType: "local",
          installed: true,
          enabled: !ls.disableModelInvocation,
          localPath: ls.filePath,
          rawContent: localRaw,
          // 所属插件包(如 npm:pi-mcp-adapter):供前端把包更新检测结果映射到技能卡片
          packageSource: ls.sourceInfo?.source,
        });
      }
    }
  } catch (err) {
    console.error("[getMarketSkills] failed to load local skills:", err);
  }

  // 4. 合并本地/订阅源技能与实时 Discover 技能，去重后按分类与搜索词过滤
  // 本地/订阅源技能优先（installed 状态准确），市场技能仅补充未在本地出现的条目
  const allSkills = [...marketSkills];
  for (const disc of marketDiscoverSkills) {
    if (!allSkills.some((m) => m.name.toLowerCase() === disc.name.toLowerCase())) {
      allSkills.push(disc);
    }
  }

  // 分类与搜索词过滤（本地技能走简单 filter，market 技能已由 API 过滤；
  // 搜索谓词复用 skills-catalog 的 matchesSkillQuery，避免两处同名不同义）
  const cat = categoryFilter || "all";
  const filteredSkills = allSkills.filter((s) => {
    if (cat !== "all" && s.category !== cat) return false;
    return matchesSkillQuery(s, searchQuery || "");
  });

  return { skills: filteredSkills, subscriptions: subscriptions.map(toPublicSubscription), sources };
}

/**
 * 响应脱敏：subscriptions 只投影白名单字段，token 永不出现在响应里（hasToken 布尔替代）。
 */
export interface PublicSkillSubscription {
  id: string;
  url: string;
  name?: string;
  category: SkillCategory;
  type: "git" | "manifest" | "url";
  addedAt: number;
  lastSyncedAt?: number;
  error?: string;
  isDefault?: boolean;
  hasToken: boolean;
}

export function toPublicSubscription(sub: SkillSubscription): PublicSkillSubscription {
  return {
    id: sub.id,
    url: sub.url,
    name: sub.name,
    category: sub.category,
    type: sub.type,
    addedAt: sub.addedAt,
    lastSyncedAt: sub.lastSyncedAt,
    error: sub.error,
    isDefault: sub.isDefault,
    hasToken: Boolean(sub.token),
  };
}

/**
 * 安装成功后登记来源凭证（origin: verified）。
 * - git 源：skillPath 为仓库内相对路径，sourceTreeHash 为目录级 tree hash
 * - 重新启用时 target.localPath 已被本地合并覆写为安装副本路径，无法反推仓库路径，
 *   必须复用已有登记的 skillPath/sourceTreeHash（首次安装时 localPath 才是缓存副本路径）
 * - baselineLocalHash 在开关回写之后计算：disable 行不参与哈希，休眠切换不产生偏离
 */
async function recordInstallProvenance(
  target: MarketSkillItem,
  folderName: string,
  destDir: string,
): Promise<void> {
  const prev = getInstall(folderName);
  const record: SkillInstallRecord = {
    folder: folderName,
    origin: prev?.origin ?? "verified",
    subscriptionId: target.subscriptionId,
    repoUrl: target.subscriptionUrl,
    skillPath: prev?.skillPath,
    sourceTreeHash: prev?.sourceTreeHash,
    disabled: false,
    installedAt: prev?.installedAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  if (target.sourceType === "git" && !prev?.skillPath && target.localPath) {
    const cacheDir = resolveCacheDir(target.subscriptionId);
    record.skillPath = path.posix.relative(cacheDir, path.dirname(target.localPath));
    try {
      record.sourceTreeHash = await remoteTreeHash(cacheDir, record.skillPath);
    } catch {
      // 缓存异常时保留 prev hash（若有），否则留空；不影响安装主流程
    }
  }
  record.baselineLocalHash = localDirHash(destDir);
  upsertInstall(record);
}

/**
 * 切换技能开关：开启 (启用/安装) 或 关闭 (休眠)
 */
export async function toggleSkillState(params: {
  skillId: string;
  enabled: boolean;
  cwd: string;
}): Promise<{ success: boolean; error?: string }> {
  const { skillId, enabled, cwd } = params;
  const { skills } = await getMarketSkills(cwd, "all");
  const target = skills.find((s) => s.id === skillId);

  if (!target) {
    return { success: false, error: "未找到目标技能" };
  }

  const userSkillsDir = getUserSkillsDir();
  const folderName = target.localPath
    ? path.basename(path.dirname(target.localPath))
    : target.id.replace(/^sub-[^-]+-/, "").replace(/^skills-sh-/, "");
  const destDir = path.join(userSkillsDir, folderName);
  const destSkillFile = path.join(destDir, "SKILL.md");

  try {
    if (enabled) {
      // 同名目录已被其他源安装 → 拒绝（保持登记表账本一致，避免覆盖语义混乱）
      const existing = getInstall(folderName);
      if (existing?.repoUrl && existing.repoUrl !== target.subscriptionUrl) {
        return {
          success: false,
          error: `目录 ${folderName} 已由 ${existing.repoUrl} 安装，拒绝从 ${target.subscriptionUrl} 覆盖安装`,
        };
      }

      if (!fs.existsSync(destSkillFile)) {
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        if (target.localPath && fs.existsSync(target.localPath)) {
          const srcDir = path.dirname(target.localPath);
          fs.cpSync(srcDir, destDir, { recursive: true });
        } else if (target.rawContent) {
          fs.writeFileSync(destSkillFile, target.rawContent, "utf8");
        } else {
          const content = `---
name: ${target.name}
description: ${target.description}
category: ${target.category}
---

# ${target.name}

${target.description}
`;
          fs.writeFileSync(destSkillFile, content, "utf8");
        }
      }

      if (fs.existsSync(destSkillFile)) {
        const raw = fs.readFileSync(destSkillFile, "utf8");
        const updated = setDisableModelInvocation(raw, false);
        fs.writeFileSync(destSkillFile, updated, "utf8");
      }

      await recordInstallProvenance(target, folderName, destDir);
    } else {
      if (fs.existsSync(destSkillFile)) {
        const raw = fs.readFileSync(destSkillFile, "utf8");
        const updated = setDisableModelInvocation(raw, true);
        fs.writeFileSync(destSkillFile, updated, "utf8");
      } else if (target.localPath && fs.existsSync(target.localPath)) {
        const raw = fs.readFileSync(target.localPath, "utf8");
        const updated = setDisableModelInvocation(raw, true);
        fs.writeFileSync(target.localPath, updated, "utf8");
      }

      // 休眠：登记表 disabled 跟随更新（disable 行不参与哈希，基线无需重算）
      const rec = getInstall(folderName);
      if (rec) {
        upsertInstall({ ...rec, disabled: true, updatedAt: Date.now() });
      }
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
