// init-memory.mjs — 存量用户数据初始化进 User Memory（ticket 08 / ADR-0008）
// 用法: node worker/scripts/init-memory.mjs --legacy <legacy.json> [--data-dir <dir>] [--dry-run]
// legacy.json: { "<userId>": { "profile": [...], "facts": [...], "preferences": [...] } }
// 目标: <data-dir>/users/<userId>/workspace/.poweri/memory/memory.md（与 gateway 用户目录布局一致）
// 幂等: memory.md 已存在则跳过（不覆盖已累积记忆）；分批、可重试（每用户独立文件）。
import * as fs from "node:fs";
import * as path from "node:path";
import { applyRemember, TEMPLATE } from "../memory-extension/memory-core.mjs";

function parseArgs(argv) {
  const out = { legacy: null, dataDir: process.env.POWERI_DATA_DIR || path.resolve("data"), dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--legacy") out.legacy = argv[++i];
    else if (argv[i] === "--data-dir") out.dataDir = argv[++i];
    else if (argv[i] === "--dry-run") out.dryRun = true;
  }
  return out;
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function initOneUser(dataDir, userId, legacy, dryRun = false) {
  const memDir = path.join(dataDir, "users", userId, "workspace", ".poweri", "memory");
  const memFile = path.join(memDir, "memory.md");
  if (fs.existsSync(memFile)) return { userId, status: "skipped" };

  let content = TEMPLATE;
  for (const section of ["profile", "facts", "preferences"]) {
    for (const item of legacy?.[section] ?? []) {
      const res = applyRemember(content, { section, fact: item }, today());
      if (res.changed) content = res.content;
    }
  }
  if (!dryRun) {
    fs.mkdirSync(path.join(memDir, "history"), { recursive: true });
    fs.writeFileSync(memFile, content);
  }
  return { userId, status: "written", file: memFile };
}

function main() {
  const { legacy, dataDir, dryRun } = parseArgs(process.argv.slice(2));
  if (!legacy || !fs.existsSync(legacy)) {
    console.error("缺少 --legacy <json> 或文件不存在");
    process.exit(1);
  }
  const legacyData = JSON.parse(fs.readFileSync(legacy, "utf8"));
  const ids = Object.keys(legacyData);
  console.log(`存量初始化: ${ids.length} 个用户 → ${dataDir}${dryRun ? "（dry-run，不落盘）" : ""}`);
  const results = { written: 0, skipped: 0, failed: 0 };
  for (const userId of ids) {
    try {
      const r = initOneUser(dataDir, userId, legacyData[userId], dryRun);
      results[r.status === "written" ? "written" : "skipped"]++;
      console.log(`  [${r.status}] ${userId}${r.file ? " → " + r.file : ""}`);
    } catch (e) {
      results.failed++;
      console.error(`  [failed] ${userId}: ${e.message}`);
    }
  }
  console.log(`完成: written=${results.written} skipped=${results.skipped} failed=${results.failed}`);
  process.exit(results.failed ? 1 : 0);
}

if (process.argv[1] && path.basename(process.argv[1]) === "init-memory.mjs") main();
