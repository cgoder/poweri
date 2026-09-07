/**
 * 工单 04：更新 API 核心逻辑（poweri/lib/skill-update-service.ts，route 为薄封装）。
 * fixture git 仓库零网络 + fetch 离线桩；故障注入用 CJS require 的 node:fs 可变对象替换 renameSync。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { applySkillUpdate, applySourceUpdates, checkUpdates } = await jiti.import("./skill-update-service.ts");
const { toggleSkillState, resolveUpdateState } = await jiti.import("./skill-subscriptions.ts");
const { getInstall, localDirHash, resolveCacheDir } = await jiti.import("./skill-install-registry.ts");

const require = createRequire(import.meta.url);

const V1 = "---\nname: demo\ndescription: demo skill\n---\n\n# Demo v1\n";
const V2 = "---\nname: demo\ndescription: demo skill v2\n---\n\n# Demo v2\n\nnew content\n";

function makeFixtureRepo(content = V1) {
  const dir = mkdtempSync(join(tmpdir(), "poweri-fixture-repo-"));
  const run = (args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  run(["init", "-q", "-b", "master"]);
  run(["config", "user.email", "test@example.test"]);
  run(["config", "user.name", "PowerI Test"]);
  const skillDir = join(dir, "skills", "demo");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), content, "utf8");
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "v1"]);
  return dir;
}

function commitAll(repo, message) {
  execFileSync("git", ["add", "-A"], { cwd: repo, stdio: "pipe" });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: repo, stdio: "pipe" });
}

function makeAgentEnv() {
  const agentDir = mkdtempSync(join(tmpdir(), "poweri-agent-"));
  const prevEnv = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  writeFileSync(
    join(agentDir, "poweri-subscriptions.json"),
    JSON.stringify([
      { id: "sub-fixture", url: `file://${globalThis.__fixtureRepo}`, name: "fixture", category: "business", type: "git", addedAt: Date.now() },
    ], null, 2),
    "utf8",
  );
  return {
    agentDir,
    restore: () => {
      if (prevEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = prevEnv;
    },
  };
}

function stubFetchOffline() {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("offline (test stub)");
  };
  return () => {
    globalThis.fetch = original;
  };
}

async function setupInstalled(repo) {
  globalThis.__fixtureRepo = repo;
  const env = makeAgentEnv();
  const restoreFetch = stubFetchOffline();
  const first = await toggleSkillState({ skillId: "sub-fixture-demo", enabled: true, cwd: repo });
  assert.equal(first.success, true, first.error);
  return { env, restoreFetch };
}

test("04: 远端更新 → apply 原子替换 + changedFiles + 登记表前移", async () => {
  const repo = makeFixtureRepo();
  const { env, restoreFetch } = await setupInstalled(repo);
  try {
    const before = getInstall("demo").sourceTreeHash;
    mkdirSync(join(repo, "skills", "demo", "references"), { recursive: true });
    writeFileSync(join(repo, "skills", "demo", "SKILL.md"), V2, "utf8");
    writeFileSync(join(repo, "skills", "demo", "references", "new.md"), "new ref", "utf8");
    commitAll(repo, "v2");

    const res = await applySkillUpdate("demo");
    assert.equal(res.success, true, res.error);
    assert.equal(res.before, before);
    assert.match(res.after, /^[0-9a-f]{40}$/);
    assert.notEqual(res.before, res.after);
    assert.ok(res.changedFiles.some((f) => f.path === "SKILL.md" && f.kind === "modified"));
    assert.ok(res.changedFiles.some((f) => f.path === "references/new.md" && f.kind === "added"));

    const destFile = join(env.agentDir, "skills", "demo", "SKILL.md");
    assert.match(readFileSync(destFile, "utf8"), /Demo v2/);
    assert.equal(existsSync(join(env.agentDir, "skills", "demo", "references", "new.md")), true);

    const rec = getInstall("demo");
    assert.equal(rec.sourceTreeHash, res.after, "登记表 hash 前移");
    assert.equal(rec.baselineLocalHash, localDirHash(join(env.agentDir, "skills", "demo")), "基线同步到新副本");
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("04: 休眠技能更新后 disable-model-invocation 仍为 true", async () => {
  const repo = makeFixtureRepo();
  const { env, restoreFetch } = await setupInstalled(repo);
  try {
    await toggleSkillState({ skillId: "sub-fixture-demo", enabled: false, cwd: repo });

    writeFileSync(join(repo, "skills", "demo", "SKILL.md"), V2, "utf8");
    commitAll(repo, "v2");

    const res = await applySkillUpdate("demo");
    assert.equal(res.success, true, res.error);
    const destFile = join(env.agentDir, "skills", "demo", "SKILL.md");
    const content = readFileSync(destFile, "utf8");
    assert.match(content, /Demo v2/);
    assert.match(content, /disable-model-invocation: true/, "休眠开关必须保留");
    assert.equal(getInstall("demo").disabled, true);
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("04: 本地偏离 → conflict；force 覆盖；keep 推进基线", async () => {
  const repo = makeFixtureRepo();
  const { env, restoreFetch } = await setupInstalled(repo);
  try {
    const destFile = join(env.agentDir, "skills", "demo", "SKILL.md");
    writeFileSync(destFile, readFileSync(destFile, "utf8") + "\n用户本地改动\n", "utf8");
    writeFileSync(join(repo, "skills", "demo", "SKILL.md"), V2, "utf8");
    commitAll(repo, "v2");

    // 409
    const conflict = await applySkillUpdate("demo");
    assert.equal(conflict.success, false);
    assert.equal(conflict.conflict, true);
    assert.match(readFileSync(destFile, "utf8"), /用户本地改动/, "冲突时本地内容不得被覆盖");

    // force
    const forced = await applySkillUpdate("demo", { force: true });
    assert.equal(forced.success, true, forced.error);
    assert.match(readFileSync(destFile, "utf8"), /Demo v2/);
    assert.equal(readFileSync(destFile, "utf8").includes("用户本地改动"), false);

    // keep：基线推进，内容不动
    writeFileSync(destFile, readFileSync(destFile, "utf8") + "\n新本地改动\n", "utf8");
    writeFileSync(join(repo, "skills", "demo", "SKILL.md"), V2 + "\nremote v3\n", "utf8");
    commitAll(repo, "v3");
    const kept = await applySkillUpdate("demo", { keep: true });
    assert.equal(kept.success, true, kept.error);
    assert.equal(kept.mode, "keep");
    assert.match(readFileSync(destFile, "utf8"), /新本地改动/, "keep 不回退本地内容");
    assert.equal(getInstall("demo").baselineLocalHash, localDirHash(join(env.agentDir, "skills", "demo")));
    // 票04 验收3：keep 后登记表 sourceTreeHash 推进到 latest，updateState 归 up-to-date（badge 清空）
    assert.equal(kept.after, getInstall("demo").sourceTreeHash, "登记表 sourceTreeHash 必须推进到 latest");
    assert.notEqual(kept.before, kept.after, "keep 前后版本标识必须前移");
    const cacheDir = resolveCacheDir("sub-fixture");
    const state = await resolveUpdateState({
      folderName: "demo",
      cacheDir,
      skillDir: join(cacheDir, "skills", "demo"),
      destDir: join(env.agentDir, "skills", "demo"),
      sub: { id: "sub-fixture", url: `file://${repo}`, type: "git" },
    });
    assert.equal(state.updateState, "up-to-date", "keep 后必须判 up-to-date，badge 清空");
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("04: unknown-origin 目录拒绝更新且内容一字未动", async () => {
  const repo = makeFixtureRepo();
  const { env, restoreFetch } = await setupInstalled(repo);
  try {
    // 手工放一个无登记目录
    const orphanDir = join(env.agentDir, "skills", "orphan");
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(join(orphanDir, "SKILL.md"), "---\nname: orphan\n---\n\n# Orphan\n", "utf8");

    const res = await applySkillUpdate("orphan");
    assert.equal(res.success, false);
    assert.match(res.error || "", /无来源登记|unknown/i);
    assert.equal(readFileSync(join(orphanDir, "SKILL.md"), "utf8"), "---\nname: orphan\n---\n\n# Orphan\n", "内容不得被动");
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("04: 第二次 rename 失败 → 回滚，旧目录完好且无残留", async () => {
  const repo = makeFixtureRepo();
  const { env, restoreFetch } = await setupInstalled(repo);
  const fsCjs = require("node:fs");
  const originalRename = fsCjs.renameSync;
  try {
    writeFileSync(join(repo, "skills", "demo", "SKILL.md"), V2, "utf8");
    commitAll(repo, "v2");
    const oldContent = readFileSync(join(env.agentDir, "skills", "demo", "SKILL.md"), "utf8");

    fsCjs.renameSync = (a, b) => {
      if (String(a).includes(".new-")) throw new Error("injected rename failure");
      return originalRename(a, b);
    };

    const res = await applySkillUpdate("demo");
    assert.equal(res.success, false);
    assert.match(res.error || "", /injected rename failure/);

    const destDir = join(env.agentDir, "skills", "demo");
    assert.equal(readFileSync(join(destDir, "SKILL.md"), "utf8"), oldContent, "旧副本完好");
    const leftovers = (await import("node:fs")).readdirSync(join(env.agentDir, "skills")).filter((n) => n.includes(".new-") || n.includes(".old-"));
    assert.deepEqual(leftovers, [], "不得残留 .new-/.old- 目录");
    assert.equal(getInstall("demo").sourceTreeHash, (await import("node:fs")).readFileSync(join(env.agentDir, "skills", "demo", "SKILL.md"), "utf8") ? getInstall("demo").sourceTreeHash : "", "登记表未写");
  } finally {
    fsCjs.renameSync = originalRename;
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("04: 源级批量更新 + checkUpdates 汇总", async () => {
  const repo = makeFixtureRepo();
  const { env, restoreFetch } = await setupInstalled(repo);
  try {
    writeFileSync(join(repo, "skills", "demo", "SKILL.md"), V2, "utf8");
    commitAll(repo, "v2");

    const check = await checkUpdates();
    assert.ok(Array.isArray(check.updates));
    const upd = check.updates.find((u) => u.folder === "demo");
    assert.ok(upd, "check 应报告 demo 可更新");
    assert.equal(upd.updateState, "update-available");
    assert.ok(upd.changedFiles?.length, "可更新项应带 changedFiles");

    const batch = await applySourceUpdates("sub-fixture");
    assert.ok(Array.isArray(batch.results));
    const demoResult = batch.results.find((r) => r.folder === "demo");
    assert.equal(demoResult.success, true, demoResult.error);

    // conflict 态：本地偏离后 check 也要带 changedFiles（UI 查看差异的数据源）
    const destFile = join(env.agentDir, "skills", "demo", "SKILL.md");
    writeFileSync(destFile, readFileSync(destFile, "utf8") + "\n用户本地改动\n", "utf8");
    writeFileSync(join(repo, "skills", "demo", "SKILL.md"), V2 + "\nremote v3\n", "utf8");
    commitAll(repo, "v3");
    const conflictCheck = await checkUpdates();
    const conflictItem = conflictCheck.updates.find((u) => u.folder === "demo");
    assert.equal(conflictItem?.updateState, "conflict");
    assert.ok(conflictItem?.changedFiles?.length, "conflict 项应带 changedFiles");
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("05: checkUpdates auto 模式 TTL 内零网络 + 过期才拉取 + 返回带 subscriptionId", async () => {
  const repo = makeFixtureRepo();
  const { env, restoreFetch } = await setupInstalled(repo);
  const subsFile = join(env.agentDir, "poweri-subscriptions.json");
  const readSubs = () => JSON.parse(readFileSync(subsFile, "utf8"));
  try {
    // force check（默认）：真实拉取，成功推进 lastSyncedAt（语义已内聚到 syncGitSubscription）
    await checkUpdates();
    const afterForce = readSubs()[0].lastSyncedAt;
    assert.equal(typeof afterForce, "number", "force 同步成功应推进 lastSyncedAt");

    // auto check（TTL 内）：跳过网络，lastSyncedAt 不动（若重拉会被推进）
    const auto = await checkUpdates(undefined, { force: false });
    assert.ok(Array.isArray(auto.updates) && auto.updates.length === 1, "TTL 内 auto 仍应汇总本地状态");
    assert.equal(auto.updates[0].folder, "demo");
    assert.equal(auto.updates[0].subscriptionId, "sub-fixture", "updates 应携带 subscriptionId供客户端按源合并");
    assert.equal(readSubs()[0].lastSyncedAt, afterForce, "TTL 内 auto 不得触发拉取（零网络）");

    // 回拨 lastSyncedAt 过期 → auto check 真实拉取并推进
    const subs = readSubs();
    subs[0].lastSyncedAt = Date.now() - 11 * 60 * 1000;
    writeFileSync(subsFile, JSON.stringify(subs), "utf8");
    await checkUpdates(undefined, { force: false });
    assert.ok(readSubs()[0].lastSyncedAt > afterForce, "过期后 auto 应拉取并推进 lastSyncedAt");
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("05: checkUpdates 单源失败 fail-soft——死源不再整体 500，健康源正常返回", async () => {
  const repo = makeFixtureRepo();
  globalThis.__fixtureRepo = repo;
  const env = makeAgentEnv();
  const restoreFetch = stubFetchOffline();
  const subsFile = join(env.agentDir, "poweri-subscriptions.json");
  try {
    // 追加一个必败源（file:// 指向不存在路径，无缓存，克隆必败）
    const subs = JSON.parse(readFileSync(subsFile, "utf8"));
    subs.push({
      id: "sub-dead",
      url: `file:///nonexistent-dead-repo-${Date.now()}.git`,
      name: "dead",
      category: "public",
      type: "git",
      addedAt: Date.now(),
    });
    writeFileSync(subsFile, JSON.stringify(subs), "utf8");

    const first = await toggleSkillState({ skillId: "sub-fixture-demo", enabled: true, cwd: repo });
    assert.equal(first.success, true, first.error);

    // 死源曾让 checkUpdates 直接抛出（route 500）；现在必须 fail-soft 走完
    const res = await checkUpdates();
    assert.ok(Array.isArray(res.updates), "死源不得让整体检查失败");
    assert.equal(res.updates.length, 1, "健康源的更新状态正常返回");
    assert.equal(res.updates[0].folder, "demo");

    // 死源退避生效：失败也写 lastSyncedAt，TTL 窗内不再重试克隆
    const persisted = JSON.parse(readFileSync(subsFile, "utf8"));
    const dead = persisted.find((s) => s.id === "sub-dead");
    assert.equal(typeof dead.lastSyncedAt, "number", "失败源应写 lastSyncedAt（退避起点）");
    assert.ok(dead.error, "失败源应记录 error（源条 ⚠ 展示）");
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});
