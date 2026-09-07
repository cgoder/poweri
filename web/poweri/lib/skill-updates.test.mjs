/**
 * 工单 03：同步 TTL 与 updateState 检测。
 *
 * fixture git 仓库 file:// 本地克隆零网络；fetch 桩离线（Discover 拉取立即失败被吞）；
 * fail-soft 用 `git remote set-url origin file:///nonexistent` 模拟拉取失败。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { getMarketSkills, toggleSkillState } = await jiti.import("./skill-subscriptions.ts");

function makeFixtureRepo(skillPath = "skills/demo", content = "---\nname: demo\ndescription: demo skill\n---\n\n# Demo v1\n") {
  const dir = mkdtempSync(join(tmpdir(), "poweri-fixture-repo-"));
  const run = (args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  run(["init", "-q", "-b", "master"]);
  run(["config", "user.email", "test@example.test"]);
  run(["config", "user.name", "PowerI Test"]);
  const skillDir = join(dir, ...skillPath.split("/"));
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

function makeAgentEnv(subscriptions) {
  const agentDir = mkdtempSync(join(tmpdir(), "poweri-agent-"));
  const prevEnv = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  writeFileSync(join(agentDir, "poweri-subscriptions.json"), JSON.stringify(subscriptions, null, 2), "utf8");
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

function sub(id, url, extra = {}) {
  return { id, url, name: id, category: "business", type: "git", addedAt: Date.now(), ...extra };
}

test("03: TTL 内跳过网络不克隆；force 强制同步", async () => {
  const repo = makeFixtureRepo();
  const seededAt = Date.now();
  const env = makeAgentEnv([sub("sub-fixture", `file://${repo}`, { lastSyncedAt: seededAt })]);
  const restoreFetch = stubFetchOffline();
  try {
    // TTL 内且无缓存：不产生网络/克隆，仅解析（无订阅源技能产出）
    const res = await getMarketSkills(repo, "all");
    assert.equal(res.skills.some((s) => s.subscriptionId === "sub-fixture"), false, "TTL 内不应解析出订阅源技能");
    assert.equal(existsSync(join(env.agentDir, "git-subscriptions", "sub-fixture")), false, "TTL 内不得克隆");
    assert.equal(res.subscriptions[0].error, undefined);
    assert.ok(res.subscriptions[0].lastSyncedAt >= seededAt);

    // force：克隆并解析
    const res2 = await getMarketSkills(repo, "all", undefined, { forceSync: true });
    assert.ok(res2.skills.length >= 1, "force 后应解析出技能");
    assert.equal(existsSync(join(env.agentDir, "git-subscriptions", "sub-fixture")), true);
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("03: 远端更新 → update-available，installed/latest 各异", async () => {
  const repo = makeFixtureRepo();
  const env = makeAgentEnv([sub("sub-fixture", `file://${repo}`)]);
  const restoreFetch = stubFetchOffline();
  try {
    await toggleSkillState({ skillId: "sub-fixture-demo", enabled: true, cwd: repo });

    writeFileSync(join(repo, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: demo skill\n---\n\n# Demo v2\n", "utf8");
    commitAll(repo, "v2");

    const res = await getMarketSkills(repo, "all", undefined, { forceSync: true });
    const demo = res.skills.find((s) => s.id === "sub-fixture-demo");
    assert.ok(demo, "应解析出 demo");
    assert.equal(demo.installed, true);
    assert.equal(demo.updateState, "update-available");
    assert.match(demo.installedVersion, /^[0-9a-f]{40}$/);
    assert.match(demo.latestVersion, /^[0-9a-f]{40}$/);
    assert.notEqual(demo.installedVersion, demo.latestVersion);
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("03: 本地正文改动 → conflict（优先级最高）", async () => {
  const repo = makeFixtureRepo();
  const env = makeAgentEnv([sub("sub-fixture", `file://${repo}`)]);
  const restoreFetch = stubFetchOffline();
  try {
    await toggleSkillState({ skillId: "sub-fixture-demo", enabled: true, cwd: repo });
    const destFile = join(env.agentDir, "skills", "demo", "SKILL.md");
    writeFileSync(destFile, readFileSync(destFile, "utf8") + "\n用户本地改动\n", "utf8");

    const res = await getMarketSkills(repo, "all", undefined, { forceSync: true });
    const demo = res.skills.find((s) => s.id === "sub-fixture-demo");
    assert.equal(demo.updateState, "conflict");
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("03: 仅休眠开关差异 → 仍 up-to-date（剔除 disable 行回归护栏）", async () => {
  const repo = makeFixtureRepo();
  const env = makeAgentEnv([sub("sub-fixture", `file://${repo}`)]);
  const restoreFetch = stubFetchOffline();
  try {
    await toggleSkillState({ skillId: "sub-fixture-demo", enabled: true, cwd: repo });
    await toggleSkillState({ skillId: "sub-fixture-demo", enabled: false, cwd: repo }); // 休眠

    const res = await getMarketSkills(repo, "all", undefined, { forceSync: true });
    const demo = res.skills.find((s) => s.id === "sub-fixture-demo");
    assert.equal(demo.enabled, false);
    assert.equal(demo.updateState, "up-to-date", "休眠不算偏离");
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("03: 无登记且内容不匹配 → unknown-origin（不给更新入口）", async () => {
  const repo = makeFixtureRepo();
  const env = makeAgentEnv([sub("sub-fixture", `file://${repo}`)]);
  const restoreFetch = stubFetchOffline();
  try {
    // 首次同步出缓存（TTL 之外），但不安装、不登记
    await getMarketSkills(repo, "all", undefined, { forceSync: true });
    // 手工放一个内容不同的本地目录（模拟 02 之前的老安装，且内容与当前远端不同）
    const destDir = join(env.agentDir, "skills", "demo");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "SKILL.md"), "---\nname: demo\ndescription: old\n---\n\n# Old content\n", "utf8");

    const res = await getMarketSkills(repo, "all", undefined, { forceSync: true });
    const demo = res.skills.find((s) => s.id === "sub-fixture-demo");
    assert.equal(demo.updateState, "unknown-origin");
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("03: 无登记但内容与远端一致 → inferred 补记 + up-to-date", async () => {
  const repo = makeFixtureRepo();
  const env = makeAgentEnv([sub("sub-fixture", `file://${repo}`)]);
  const restoreFetch = stubFetchOffline();
  try {
    await getMarketSkills(repo, "all", undefined, { forceSync: true });
    // 手工放一个与当前远端内容完全一致的本地目录
    const destDir = join(env.agentDir, "skills", "demo");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "SKILL.md"), "---\nname: demo\ndescription: demo skill\n---\n\n# Demo v1\n", "utf8");

    const res = await getMarketSkills(repo, "all", undefined, { forceSync: true });
    const demo = res.skills.find((s) => s.id === "sub-fixture-demo");
    assert.equal(demo.updateState, "up-to-date", "内容一致应补记 inferred 并判 up-to-date");
    const { readRegistry } = await jiti.import("./skill-install-registry.ts");
    const rec = readRegistry().installs["demo"];
    assert.equal(rec.origin, "inferred");
    assert.equal(rec.skillPath, "skills/demo");
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("03: 拉取失败 fail-soft → 旧缓存照常解析 + error 记入 + 状态退回上次已知", async () => {
  const repo = makeFixtureRepo();
  const env = makeAgentEnv([sub("sub-fixture", `file://${repo}`)]);
  const restoreFetch = stubFetchOffline();
  try {
    await toggleSkillState({ skillId: "sub-fixture-demo", enabled: true, cwd: repo });
    // 把缓存 remote 指向不存在路径，模拟拉取失败
    const cacheDir = join(env.agentDir, "git-subscriptions", "sub-fixture");
    execFileSync("git", ["remote", "set-url", "origin", "file:///nonexistent-poweri-fixture"], { cwd: cacheDir, stdio: "pipe" });

    const res = await getMarketSkills(repo, "all", undefined, { forceSync: true });
    const demo = res.skills.find((s) => s.id === "sub-fixture-demo");
    assert.ok(demo, "旧缓存应照常解析");
    assert.equal(demo.updateState, "up-to-date", "失败不得误报 unknown-origin，退回上次已知状态");
    assert.ok(res.subscriptions[0].error, "error 应记入订阅");
    assert.match(res.subscriptions[0].error, /Git update failed|fatal|does not appear/i);
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("03: sources 聚合（total/outdated/conflict/error/lastSyncedAt）", async () => {
  const repo = makeFixtureRepo();
  const env = makeAgentEnv([sub("sub-fixture", `file://${repo}`)]);
  const restoreFetch = stubFetchOffline();
  try {
    await toggleSkillState({ skillId: "sub-fixture-demo", enabled: true, cwd: repo });
    writeFileSync(join(repo, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: demo skill\n---\n\n# Demo v2\n", "utf8");
    commitAll(repo, "v2");

    const res = await getMarketSkills(repo, "all", undefined, { forceSync: true });
    const src = res.sources.find((s) => s.subscriptionId === "sub-fixture");
    assert.ok(src, "sources 应包含该订阅");
    assert.equal(src.total, 1);
    assert.equal(src.outdated, 1);
    assert.equal(src.conflict, 0);
    assert.equal(src.error, undefined);
    assert.ok(src.lastSyncedAt);
    assert.ok(src.name);
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});
