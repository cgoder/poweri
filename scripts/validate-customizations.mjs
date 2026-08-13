#!/usr/bin/env node
// PowerI 定制清单校验（spec 硬约束机制化，ticket 06）
//
// 三类违规检出：
//   1. 侵入集合超出清单 —— web/ 相对上游被改/删的文件不在 docs/web-customizations.json 的 intrusions
//   2. 清单过期条目 —— 清单登记的文件当前与上游一致（改动已还原或重复登记）
//   3. subtree 结构异常 —— 模块目录缺失 / squash 元数据缺失 / squash 树与 split 树不一致
// dry-run：--dry-run <upstream-ref> 输出预期冲突列表（上游改动集 ∩ 侵入集），供升级前对照。
//
// 用法：
//   node scripts/validate-customizations.mjs                  # 全量校验（web + gateway）
//   node scripts/validate-customizations.mjs --module web     # 仅 web
//   node scripts/validate-customizations.mjs --dry-run <ref>  # 预期冲突输出（ref 需已 fetch 到本地对象库）
// 退出码：0 通过；1 有 error 级问题。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = path.join(REPO_ROOT, "docs/web-customizations.json");

// ── git 访问（可注入）──
export function runGitDefault(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
}

// ── 树比较 ──
/** ls-tree 输出 → Map<path, blobSha> */
export function parseLsTree(out) {
  const m = new Map();
  for (const line of out.trim().split("\n")) {
    if (!line) continue;
    const [meta, p] = line.split("\t");
    if (!p) continue;
    const sha = meta.split(" ")[2];
    m.set(p, sha);
  }
  return m;
}

/**
 * 当前模块相对上游 squash 树的差异。
 * squash commit 树 = 上游树副本（无模块前缀）；HEAD 树中模块路径带前缀。
 * 返回 rel 路径（相对模块根）。
 */
export function treeDiff(runGit, squash, prefix) {
  const upstream = parseLsTree(runGit(["ls-tree", "-r", squash]));
  const local = parseLsTree(runGit(["ls-tree", "-r", "HEAD", "--", `${prefix}/`]));
  const intrusions = []; // 上游文件被改（blob 不同）或被删（本地缺失）
  const independent = []; // 上游不存在的本地新增
  for (const [rel, sha] of upstream) {
    const key = `${prefix}/${rel}`;
    if (!local.has(key)) intrusions.push(rel);
    else if (local.get(key) !== sha) intrusions.push(rel);
  }
  for (const [key] of local) {
    const rel = key.slice(prefix.length + 1);
    if (!upstream.has(rel)) independent.push(rel);
  }
  return { intrusions, independent };
}

// ── subtree 元数据 ──
/** 从 squash commit 消息解析 git-subtree-dir / git-subtree-split */
export function findSubtreeMeta(runGit, module) {
  const msg = runGit([`log`, `--grep=git-subtree-dir: ${module}`, `--format=%B`, `-1`]);
  const dir = msg.match(/git-subtree-dir: (\S+)/)?.[1];
  const split = msg.match(/git-subtree-split: (\S+)/)?.[1];
  if (!dir || !split) throw new Error(`未找到 ${module}/ 的 subtree 元数据（git-subtree-dir/git-subtree-split）`);
  return { dir, split };
}

/** subtree 结构校验（模块目录 / squash 存在 / split 树一致） */
export function checkStructure(runGit, module, squash, meta) {
  const issues = [];
  const local = runGit(["ls-tree", "-r", "HEAD", "--", `${module}/`]);
  if (!local.trim()) {
    issues.push(`模块目录 ${module}/ 不存在（subtree 未引入或已被移除）`);
    return issues;
  }
  const splitExists = (() => {
    try {
      runGit(["cat-file", "-e", meta.split]);
      return true;
    } catch {
      return false; // git 对缺失对象 exit≠0，execFileSync throw
    }
  })();
  if (!splitExists) {
    issues.push(`split 对象 ${meta.split} 不在本地对象库（结构信息仍可读，dry-run 需先 fetch 上游）`);
    return issues;
  }
  const splitTree = runGit(["rev-parse", `${meta.split}^{tree}`]).trim();
  const squashTree = runGit(["rev-parse", `${squash}^{tree}`]).trim();
  if (splitTree !== squashTree) {
    issues.push(`squash commit 树与上游 split 树不一致（${squash} vs ${meta.split}）——subtree 元数据损坏`);
  }
  return issues;
}

// ── 清单校验 ──
const RISK_LEVELS = new Set(["high", "medium", "low"]);

/** 清单自身 schema 校验（spec：条目 = 文件路径 + 改动理由 + 预期冲突风险） */
export function validateManifestSchema(manifest) {
  const issues = [];
  if (!manifest || typeof manifest !== "object") {
    return [{ type: "manifest-invalid", level: "error", message: "清单缺失或非对象（docs/web-customizations.json 解析失败）" }];
  }
  const intrusions = manifest.intrusions;
  if (!Array.isArray(intrusions)) {
    return [{ type: "manifest-invalid", level: "error", message: "清单 intrusions 必须是数组" }];
  }
  for (const [i, entry] of intrusions.entries()) {
    if (!entry || typeof entry.file !== "string" || !entry.file) {
      issues.push({ type: "manifest-invalid", level: "error", message: `intrusions[${i}] 缺 file 字段` });
    }
    if (typeof entry.reason !== "string" || !entry.reason.trim()) {
      issues.push({ type: "manifest-invalid", level: "error", message: `intrusions[${i}]（${entry?.file ?? "?"}）缺 reason 字段（spec：文件路径 + 改动理由 + 预期冲突风险）` });
    }
    if (!RISK_LEVELS.has(entry?.risk)) {
      issues.push({ type: "manifest-invalid", level: "error", message: `intrusions[${i}]（${entry?.file ?? "?"}）risk 必须是 high/medium/low，实际：${entry?.risk ?? "缺失"}` });
    }
  }
  if (manifest.independent !== undefined && !Array.isArray(manifest.independent)) {
    issues.push({ type: "manifest-invalid", level: "error", message: "清单 independent 必须是字符串数组" });
  }
  return issues;
}

export function checkManifest(manifest, intrusions, independent) {
  const issues = [];
  const registered = new Set(manifest.intrusions.map((i) => i.file));
  for (const f of intrusions) {
    if (!registered.has(f)) {
      issues.push({ type: "unregistered", level: "error", message: `未登记侵入：${f}（相对上游有改动/删除，但不在清单 intrusions——先登记或还原）` });
    }
  }
  const current = new Set(intrusions);
  for (const i of manifest.intrusions) {
    if (!current.has(i.file)) {
      issues.push({ type: "stale", level: "error", message: `清单过期条目：${i.file}（当前与上游一致；若为刻意回退请从清单移除）` });
    }
  }
  const indepRegistered = new Set(manifest.independent ?? []);
  for (const f of independent) {
    if (!indepRegistered.has(f)) {
      issues.push({ type: "independent-missing", level: "warning", message: `独立新增文件未登记：${f}（零冲突，但建议登记以便文档化）` });
    }
  }
  return issues;
}

// ── dry-run 冲突预期 ──
/**
 * 预期冲突 = 上游 split→ref 的改动集 ∩ 侵入集；
 * 上游删除的侵入文件单列（需人工决策：跟随删除或保留定制）；
 * 上游新增文件与独立文件同名 → 提示（pull 后本地文件被上游覆盖，需合并内容）。
 */
export function dryRunConflicts(runGit, manifest, split, ref) {
  const upstream = parseLsTree(runGit(["ls-tree", "-r", split]));
  const next = parseLsTree(runGit(["ls-tree", "-r", ref]));
  const intrusive = new Set(manifest.intrusions.map((i) => i.file));
  const independentSet = new Set(manifest.independent ?? []);
  const conflicts = [];
  const deletedUpstream = [];
  for (const [rel, sha] of upstream) {
    const nextSha = next.get(rel);
    if (nextSha === sha) continue; // 上游未动
    if (nextSha === undefined) {
      // 上游删除
      if (intrusive.has(rel)) deletedUpstream.push(rel);
      continue;
    }
    // 上游改动
    if (intrusive.has(rel)) conflicts.push(rel);
  }
  // 上游新增文件与我方独立文件同名 → add/add 硬冲突（pull 时双方都新增同名文件）
  const independentCollisions = [...independentSet].filter((rel) => !upstream.has(rel) && next.has(rel));
  return { conflicts, deletedUpstream, independentCollisions };
}

// ── CLI ──
function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

function reportModule(name, { issues, conflicts, deletedUpstream, collisions }, dryRunRef) {
  console.log(`\n== ${name}/ ==`);
  if (issues.length === 0) console.log("  ✓ 结构/清单校验通过");
  for (const i of issues) console.log(`  [${i.level}] ${i.message}`);
  if (dryRunRef) {
    if (conflicts.length === 0 && deletedUpstream.length === 0 && collisions.length === 0) {
      console.log(`  ✓ dry-run 对 ${dryRunRef}：预期零冲突`);
    } else {
      for (const f of conflicts) console.log(`  [conflict] ${f}`);
      for (const f of deletedUpstream) console.log(`  [upstream-deleted] ${f}（上游删除 + 本地侵入过——需决策：跟随删除或保留定制）`);
      for (const f of collisions) console.log(`  [collision] ${f}（上游新增文件与我方独立文件同名——pull 将覆盖，需合并内容）`);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const dryRunIdx = args.indexOf("--dry-run");
  let dryRunRef = dryRunIdx >= 0 ? args[dryRunIdx + 1] : null;
  const moduleIdx = args.indexOf("--module");
  const only = moduleIdx >= 0 ? args[moduleIdx + 1] : null;
  if (dryRunIdx >= 0 && !dryRunRef) {
    console.error("用法：node scripts/validate-customizations.mjs --dry-run <upstream-ref>");
    process.exit(2);
  }
  if (moduleIdx >= 0 && !only) {
    console.error("用法：node scripts/validate-customizations.mjs --module web|gateway");
    process.exit(2);
  }
  let manifest;
  try {
    manifest = loadManifest();
  } catch (e) {
    console.error(`[error] 清单读取失败：${e.message}`);
    process.exit(1);
  }
  let anyError = false;
  try {
    const dirty = runGitDefault(["status", "--porcelain"]).trim();
    if (dirty) {
      console.warn(`[warn] 工作区有未提交改动（${dirty.split("\n").length} 个文件）——校验基于 HEAD 树，升级前请先提交或还原`);
    }
    for (const [mod, cfg] of Object.entries(manifest.modules)) {
      if (only && mod !== only) continue;
      const squash = cfg.upstream.subtreeSquash;
      const meta = findSubtreeMeta(runGitDefault, mod);
      const issues = checkStructure(runGitDefault, mod, squash, meta);
      let conflicts = [], deletedUpstream = [], collisions = [];
      if (mod === "web") {
        // 冻结源（gateway）只做结构校验，不校验侵入
        issues.push(...validateManifestSchema(cfg));
        const { intrusions, independent } = treeDiff(runGitDefault, squash, mod);
        issues.push(...checkManifest(cfg, intrusions, independent));
        if (dryRunRef) {
          ({ conflicts, deletedUpstream, independentCollisions: collisions } = dryRunConflicts(runGitDefault, cfg, meta.split, dryRunRef));
        }
      } else if (dryRunRef) {
        console.error(`  [warn] ${mod}/ 为冻结源（无 pull 冲突面），--dry-run 仅适用于 web/`);
        dryRunRef = null; // 冻结源不做 dry-run 输出，避免与警告矛盾
      }
      reportModule(mod, { issues, conflicts, deletedUpstream, collisions }, dryRunRef);
      if (issues.some((i) => i.level === "error")) anyError = true;
    }
  } catch (e) {
    console.error(`[error] 校验执行失败：${e.message}`);
    process.exit(1);
  }
  const dryRunNote = dryRunRef ? `；dry-run 预期冲突请对照实际 pull 结果核验` : "";
  console.log(`\n结果：${anyError ? "FAIL（存在 error 级问题，升级前必须处理）" : "PASS"}${dryRunNote}`);
  process.exit(anyError ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
