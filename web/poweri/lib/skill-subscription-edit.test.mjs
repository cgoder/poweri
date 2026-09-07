/**
 * 工单 07：编辑订阅源（action:"update"）——只覆盖显式字段、id 不变、
 * url 变更清缓存目录（避免 .git/config 的 origin 指向旧仓库）、removeSubscription 清孤儿缓存。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { updateSubscription, removeSubscription, getMarketSkills } = await jiti.import("./skill-subscriptions.ts");

function makeFixtureRepo(content = "---\nname: demo\ndescription: demo skill\n---\n\n# Demo\n") {
  const dir = mkdtempSync(join(tmpdir(), "poweri-fixture-repo-"));
  const run = (args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  run(["init", "-q", "-b", "master"]);
  run(["config", "user.email", "test@example.test"]);
  run(["config", "user.name", "PowerI Test"]);
  const skillDir = join(dir, "skills", "demo");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), content, "utf8");
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "init"]);
  return dir;
}

function makeAgentEnv(repoA) {
  const agentDir = mkdtempSync(join(tmpdir(), "poweri-agent-"));
  const prevEnv = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  writeFileSync(
    join(agentDir, "poweri-subscriptions.json"),
    JSON.stringify([
      { id: "sub-fixture", url: `file://${repoA}`, name: "fixture", category: "business", type: "git", addedAt: Date.now() },
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

function cacheDirOf(agentDir, id) {
  return join(agentDir, "git-subscriptions", id);
}

test("07: 改 name 不影响缓存目录，且只覆盖传入字段", async () => {
  const repo = makeFixtureRepo();
  const env = makeAgentEnv(repo);
  const restoreFetch = stubFetchOffline();
  try {
    await getMarketSkills(repo, "all", undefined, { forceSync: true });
    assert.equal(existsSync(cacheDirOf(env.agentDir, "sub-fixture")), true);

    const updated = updateSubscription("sub-fixture", { name: "renamed" });
    assert.equal(updated.name, "renamed");
    assert.equal(updated.id, "sub-fixture", "id 不变");
    assert.equal(updated.url, `file://${repo}`, "未传字段保持");
    assert.equal(existsSync(cacheDirOf(env.agentDir, "sub-fixture")), true, "name 变更不清缓存");
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("07: 改 url → 缓存目录被清，下次同步从新源克隆", async () => {
  const repoA = makeFixtureRepo();
  const repoB = makeFixtureRepo("---\nname: demo\ndescription: from repo B\n---\n\n# B\n");
  const env = makeAgentEnv(repoA);
  const restoreFetch = stubFetchOffline();
  try {
    await getMarketSkills(repoA, "all", undefined, { forceSync: true });
    assert.equal(existsSync(cacheDirOf(env.agentDir, "sub-fixture")), true);

    const updated = updateSubscription("sub-fixture", { url: `file://${repoB}` });
    assert.equal(updated.url, `file://${repoB}`);
    assert.equal(existsSync(cacheDirOf(env.agentDir, "sub-fixture")), false, "url 变更必须清缓存");

    const res = await getMarketSkills(repoB, "all", undefined, { forceSync: true });
    const demo = res.skills.find((s) => s.id === "sub-fixture-demo");
    assert.ok(demo, "新源应被克隆并解析");
    assert.equal(demo.description, "from repo B");
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repoA, { recursive: true, force: true });
    rmSync(repoB, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("07: 只改 token，其余字段原样", async () => {
  const repo = makeFixtureRepo();
  const env = makeAgentEnv(repo);
  const restoreFetch = stubFetchOffline();
  try {
    const updated = updateSubscription("sub-fixture", { token: "glpat-secret" });
    assert.equal(updated.token, "glpat-secret");
    assert.equal(updated.name, "fixture");
    assert.equal(updated.category, "business");
    assert.equal(updated.url, `file://${repo}`);
    // token 变更不清缓存（url 未变）
    await getMarketSkills(repo, "all", undefined, { forceSync: true });
    assert.equal(existsSync(cacheDirOf(env.agentDir, "sub-fixture")), true);
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("07: removeSubscription 删除订阅并清理缓存目录（无孤儿残留）", async () => {
  const repo = makeFixtureRepo();
  const env = makeAgentEnv(repo);
  const restoreFetch = stubFetchOffline();
  try {
    await getMarketSkills(repo, "all", undefined, { forceSync: true });
    assert.equal(existsSync(cacheDirOf(env.agentDir, "sub-fixture")), true);

    assert.equal(removeSubscription("sub-fixture"), true);
    assert.equal(removeSubscription("sub-fixture"), false, "二次删除返回 false");
    assert.equal(existsSync(cacheDirOf(env.agentDir, "sub-fixture")), false, "缓存目录应一并清理");
    assert.equal(existsSync(join(env.agentDir, "poweri-subscriptions.json")), true);
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});
