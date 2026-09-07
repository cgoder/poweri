import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);

export const REGISTRY_VERSION = 1;
export const REGISTRY_FILE_NAME = "poweri-skill-installs.json";

export interface SkillInstallRecord {
  /** 已安装目录名（~/.pi/agent/skills/<folder>），登记表唯一键，与订阅 id 无关（id 含时间戳，删源重加即变）。 */
  folder: string;
  /** 来源凭证：安装时登记 / 事后按目录名反查命中 / 判定不了。unknown 一律不给更新入口。 */
  origin: "verified" | "inferred" | "unknown";
  subscriptionId?: string;
  repoUrl?: string;
  /** 仓库内相对路径，如 "skills/enterprise-semantic"。 */
  skillPath?: string;
  /** 安装/上次升级时源仓库里该目录的 git tree hash。 */
  sourceTreeHash?: string;
  /** 同时刻本地目录内容摘要（"sha256:<hex>"，剔除 disable-model-invocation 行后）。 */
  baselineLocalHash?: string;
  /** 预留：将来做 ref 锁定（pin / tag）用，当前不读不写语义。 */
  ref?: string;
  /** 上次已知休眠开关状态，供升级后回写。 */
  disabled?: boolean;
  installedAt: number;
  updatedAt: number;
}

export interface SkillInstallRegistry {
  version: number;
  installs: Record<string, SkillInstallRecord>;
}

/** 登记表文件路径；agentDir 缺省时取 SDK getAgentDir()（支持 PI_CODING_AGENT_DIR 覆盖）。 */
export function getRegistryFilePath(agentDir?: string): string {
  const dir = agentDir ?? getAgentDir();
  return path.join(dir, REGISTRY_FILE_NAME);
}

/** 空 installs 容器：null 原型，防 folder 名为 `__proto__` 时触发原型 setter 导致记录静默丢失。 */
function emptyInstalls(): Record<string, SkillInstallRecord> {
  return Object.create(null);
}

/** 读登记表。文件缺失 → 空表；JSON 损坏 → 空表且保留原文件（绝不静默清空用户账本）。 */
export function readRegistry(agentDir?: string): SkillInstallRegistry {
  const file = getRegistryFilePath(agentDir);
  if (!fs.existsSync(file)) {
    return { version: REGISTRY_VERSION, installs: emptyInstalls() };
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const installs =
      data && typeof data === "object" && data.installs && typeof data.installs === "object" && !Array.isArray(data.installs)
        ? Object.assign(emptyInstalls(), data.installs)
        : emptyInstalls();
    const version = typeof data?.version === "number" ? data.version : REGISTRY_VERSION;
    return { version, installs };
  } catch {
    return { version: REGISTRY_VERSION, installs: emptyInstalls() };
  }
}

/**
 * 原子落盘：先写同目录 tmp 再 rename，避免半截 JSON 被读走。
 * 目标文件已损坏时拒绝写入（响亮失败）——否则 readRegistry 容错出的空表会把账本静默覆盖掉。
 */
export function writeRegistry(registry: SkillInstallRegistry, agentDir?: string): void {
  const file = getRegistryFilePath(agentDir);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (fs.existsSync(file)) {
    try {
      JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      throw new Error(
        `${REGISTRY_FILE_NAME} 已损坏，拒绝覆盖；请人工修复或删除该文件后重试`,
      );
    }
  }
  const tmp = path.join(dir, `${REGISTRY_FILE_NAME}.tmp-${process.pid}-${Date.now().toString(36)}`);
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

export function upsertInstall(record: SkillInstallRecord, agentDir?: string): void {
  const registry = readRegistry(agentDir);
  registry.installs[record.folder] = record;
  writeRegistry(registry, agentDir);
}

export function getInstall(folder: string, agentDir?: string): SkillInstallRecord | undefined {
  return readRegistry(agentDir).installs[folder];
}

export function removeInstall(folder: string, agentDir?: string): boolean {
  const registry = readRegistry(agentDir);
  if (!(folder in registry.installs)) return false;
  delete registry.installs[folder];
  writeRegistry(registry, agentDir);
  return true;
}

// ---------- 路径 / 哈希原语 ----------

const DISABLE_KEY = "disable-model-invocation";
/**
 * 正则思路复用 lib/skill-frontmatter.ts 的 KEY_LINE（上游持有，只读引用、不 import）：
 * 支持裸键与 "key" / 'key' 两种引号写法，键后必须跟冒号。
 */
const DISABLE_KEY_LINE = `[ \\t]*(?:${DISABLE_KEY}|"${DISABLE_KEY}"|'${DISABLE_KEY}')[ \\t]*:`;

/** 订阅缓存目录：~/.pi/agent/git-subscriptions/<subscriptionId>。 */
export function resolveCacheDir(subscriptionId: string, agentDir?: string): string {
  return path.join(agentDir ?? getAgentDir(), "git-subscriptions", subscriptionId);
}

/**
 * 剔除 frontmatter 内 `disable-model-invocation` 行（值 true/false 或引号键均可），
 * 供本地内容摘要使用：该键由 PowerI 自身写入，休眠切换不算用户偏离。
 * 只编辑 frontmatter 块：不以 `---` 开头的内容视为无 frontmatter，原样返回。
 */
export function stripDisableLine(content: string): string {
  if (!content.startsWith("---")) return content;
  const closing = content.indexOf("\n---", 3);
  const head = closing === -1 ? content : content.slice(0, closing);
  const tail = closing === -1 ? "" : content.slice(closing);
  const keyLine = new RegExp(`\\n${DISABLE_KEY_LINE}[^\\n]*`);
  return head.replace(keyLine, "") + tail;
}

/**
 * 目录内全部相对文件路径（posix 分隔、升序），供内容比对与变更清单使用。
 */
export function listRelativeFiles(dir: string): string[] {
  const files: string[] = [];
  collectFiles(dir, dir, files);
  files.sort();
  return files;
}

/**
 * 目录内容摘要：相对路径按 posix 升序，逐条喂 `relpath\0<bytes>\0` 进 sha256。
 * - 排序消除遍历顺序差异；\0 分隔避免拼接歧义
 * - 仅 SKILL.md 先经 stripDisableLine（工单口径：该键只由 PowerI 写在 SKILL.md，
 *   其余文件里的 disable 字样属于用户内容，计入偏离）
 * - 目录缺失/文件读取失败直接抛出：基线摘要必须可对账，静默容错会掩盖漂移
 * - 符号链接不跟随（Dirent isFile/isDirectory 对链接均 false，跳过），安装副本与基线副本行为一致
 */
export function localDirHash(dir: string): string {
  const files = listRelativeFiles(dir);
  const hash = createHash("sha256");
  for (const rel of files) {
    const abs = path.join(dir, ...rel.split("/"));
    const raw = fs.readFileSync(abs, "utf8");
    hash.update(rel, "utf8");
    hash.update("\0", "utf8");
    hash.update(path.basename(abs) === "SKILL.md" ? stripDisableLine(raw) : raw);
    hash.update("\0", "utf8");
  }
  return `sha256:${hash.digest("hex")}`;
}

function collectFiles(root: string, dir: string, out: string[]): void {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (ent.isDirectory()) {
      collectFiles(root, abs, out);
    } else if (ent.isFile()) {
      out.push(rel);
    }
  }
}

/**
 * 源仓库里某目录的远程版本标识：`git rev-parse HEAD:<skillPath>` 的 tree hash。
 * 基于已同步的本地缓存 clone 计算（调用方保证已 fetch），非实时网络调用。
 * 目录级而非仓库级：同仓库别的技能改动不会误报本技能可更新。
 * 输出非 40 位 hex 视为失败（如路径不存在时 git 的报错/空输出）。
 */
export async function remoteTreeHash(cacheDir: string, skillPath: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", cacheDir, "rev-parse", `HEAD:${skillPath}`],
    { timeout: 10000, maxBuffer: 1024 * 1024 },
  );
  const hash = stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(hash)) {
    throw new Error(`remoteTreeHash: 非法 git 输出（${hash.length} 字符）: ${skillPath}`);
  }
  return hash;
}
