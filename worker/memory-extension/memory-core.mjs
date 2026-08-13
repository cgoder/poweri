// memory-core.mjs — User Memory 纯逻辑（可单测）：三节结构、remember 增改、注入截断
// 设计见 docs/design/08-user-memory.md
import * as fs from "node:fs";

export const SECTION_HEADERS = { profile: "## 画像", facts: "## 事实", preferences: "## 偏好" };
const EMPTY_LINE = "- （暂无）";
export const TEMPLATE = `# User Memory

${SECTION_HEADERS.profile}
${EMPTY_LINE}

${SECTION_HEADERS.facts}
${EMPTY_LINE}

${SECTION_HEADERS.preferences}
${EMPTY_LINE}
`;

/** 估算 token 数（chars≈tokens×4 的粗略换算，预算仅为注入上限控制） */
export const estimateTokens = (text) => Math.ceil((text?.length ?? 0) / 4);

/** 创建记忆文件（含父目录），已存在则不覆盖；返回文件路径 */
export function ensureMemoryFile(dir) {
  const file = join(dir, "memory.md");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(join(dir, "history"), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, TEMPLATE);
  return file;
}

/** 解析 memory.md → { profile: string[], facts: string[], preferences: string[] }（不含表头） */
export function parseSections(content) {
  const out = { profile: [], facts: [], preferences: [] };
  let current = null;
  const headerOf = Object.fromEntries(Object.entries(SECTION_HEADERS).map(([k, v]) => [v, k]));
  for (const line of String(content ?? "").split("\n")) {
    const key = headerOf[line.trim()];
    if (key) { current = key; continue; }
    const t = line.trim();
    if (t && !t.startsWith("#") && current && t !== EMPTY_LINE) out[current].push(line);
  }
  return out;
}

/** 重建 memory.md 内容 */
export function renderMemory(sections) {
  const lines = ["# User Memory", ""];
  for (const [key, header] of Object.entries(SECTION_HEADERS)) {
    lines.push(header);
    const items = (sections[key] ?? []).map((l) => l.trim());
    lines.push(...(items.length ? items.map((l) => (l.startsWith("-") ? l : `- ${l}`)) : [EMPTY_LINE]), "");
  }
  return lines.join("\n").replace(/\n+$/, "\n");
}

const stripDate = (s) => s.replace(/^(?:-\s*)?\[?\d{4}-\d{2}-\d{2}\]?\s*/, "").trim();
const norm = (s) => stripDate(s).replace(/^-/, "").trim();

/** 应用一次 remember：追加/替换某节的一行。返回 { content, changed, reason, replaced? }（replaced=覆盖发生时被替换的旧行，供写 recovery 记录） */
export function applyRemember(content, { section, fact, replace = false }, date) {
  const key = SECTION_HEADERS[section];
  if (!key) return { content, changed: false, reason: `unknown section: ${section}` };
  const sections = parseSections(content);
  let line = String(fact ?? "").trim();
  if (!line) return { content, changed: false, reason: "empty fact" };
  if (section === "facts") line = `[${date}] ${line}`;

  const items = sections[section];
  const bare = norm(line);
  if (!replace && items.some((l) => norm(l) === bare)) return { content, changed: false, reason: "duplicate" };

  let replaced;
  if (replace) {
    // 替换同内容行（忽略日期前缀与行首符号）
    const idx = items.findIndex((l) => norm(l) === bare);
    if (idx >= 0) {
      replaced = { section, oldLine: items[idx], newLine: line };
      items[idx] = line;
    } else {
      items.push(line);
    }
  } else {
    items.push(line);
  }
  // 有真实内容后清掉占位行
  const cleaned = items.filter((l) => l.trim() !== EMPTY_LINE);
  return { content: renderMemory({ ...sections, [section]: cleaned }), changed: true, reason: "ok", replaced };
}

/** 恢复被覆盖/删除的旧行（recovery 记录）。entry: { section, oldLine }。返回 { content, changed, reason } */
export function applyRecover(content, entry) {
  const key = SECTION_HEADERS[entry?.section];
  if (!key) return { content, changed: false, reason: `unknown section: ${entry?.section}` };
  const oldLine = String(entry.oldLine ?? "").trim();
  if (!oldLine) return { content, changed: false, reason: "empty oldLine" };
  const sections = parseSections(content);
  const items = sections[entry.section];
  if (items.some((l) => l.trim() === oldLine.trim())) return { content, changed: false, reason: "already present" };
  items.push(oldLine);
  const cleaned = items.filter((l) => l.trim() !== EMPTY_LINE);
  return { content: renderMemory({ ...sections, [entry.section]: cleaned }), changed: true, reason: "ok" };
}

/**
 * 注入截断：预算内全文；超预算保留「画像」全部 + 事实/偏好各取最近条目。
 * budgetChars 为注入内容字符上限。
 */
export function truncateInjection(content, budgetChars) {
  const sections = parseSections(content);
  if (estimateTokens(content) * 4 <= budgetChars || budgetChars <= 0) return content;

  const keepRecent = (arr, maxLines) => arr.slice(-maxLines);
  // 画像全文、事实/偏好各留一半预算，逐轮缩减直到放得下
  let factsN = sections.facts.length;
  let prefsN = sections.preferences.length;
  const shrink = () => {
    // 优先裁更多条目的那一节
    if (factsN > prefsN) factsN = Math.max(0, Math.ceil(factsN / 2));
    else prefsN = Math.max(0, Math.ceil(prefsN / 2));
  };
  let candidate = null;
  for (let i = 0; i < 20 && factsN + prefsN > 0; i++) {
    candidate = renderMemory({
      profile: sections.profile,
      facts: keepRecent(sections.facts, factsN),
      preferences: keepRecent(sections.preferences, prefsN),
    });
    if (candidate.length <= budgetChars) return candidate;
    shrink();
  }
  // 兜底：只留画像
  return renderMemory({ profile: sections.profile, facts: [], preferences: [] });
}

/** 注入块：记忆 + 使用规则 */
export function buildInjection(memoryContent, empty = false) {
  const mem = empty
    ? "# User Memory\n\n（暂无记忆内容——新的用户信息会通过 remember 工具累积。）"
    : memoryContent;
  return [
    "## User Memory（持久记忆，跨会话保留；来自用户自己的记忆文件）",
    mem,
    "",
    "## 记忆使用规则",
    "- 用户透露持续性信息（身份/偏好/决定/项目进展/禁忌）时，调用 remember 工具写入对应节：profile=画像 / facts=事实 / preferences=偏好。",
    "- 寒暄、瞬时指令、已回答的问题、显而易见的上下文不要写入。",
    "- 同义更新用 replace=true 替换旧行，不要重复追加。",
  ].join("\n");
}

function join(a, b) { return a.endsWith("/") ? a + b : `${a}/${b}`; }
