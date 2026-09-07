/**
 * 工单 02：安装时登记来源凭证。
 *
 * 通过公共 seam `toggleSkillState()` 驱动（安装 → 休眠 → 再启用 → 异源冲突），
 * fixture git 仓库用 file:// 协议本地克隆，零网络；全局 fetch 打桩为离线，
 * 让 getMarketSkills 内部的可选 Discover 拉取立即失败（其自有 try/catch 会吞掉）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { toggleSkillState, getMarketSkills } = await jiti.import("./skill-subscriptions.ts");
const { getInstall, localDirHash, readRegistry, removeInstall } = await jiti.import("./skill-install-registry.ts");

function makeFixtureRepo(skillPath = "skills/demo") {
  const dir = mkdtempSync(join(tmpdir(), "poweri-fixture-repo-"));
  const run = (args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  run(["init", "-q", "-b", "master"]);
  run(["config", "user.email", "test@example.test"]);
  run(["config", "user.name", "PowerI Test"]);
  const skillDir = join(dir, ...skillPath.split("/"));
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "---\nname: demo\ndescription: demo skill\n---\n\n# Demo\n", "utf8");
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "init"]);
  return dir;
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

function sub(id, url) {
  return { id, url, name: id, category: "business", type: "git", addedAt: Date.now() };
}

test("02: 安装后登记来源凭证（verified / skillPath / sourceTreeHash / baseline）", async () => {
  const repo = makeFixtureRepo();
  const env = makeAgentEnv([sub("sub-fixture", `file://${repo}`)]);
  const restoreFetch = stubFetchOffline();
  try {
    const res = await toggleSkillState({ skillId: "sub-fixture-demo", enabled: true, cwd: repo });
    assert.equal(res.success, true, res.error);

    const rec = getInstall("demo");
    assert.ok(rec, "登记表应出现 demo 记录");
    assert.equal(rec.origin, "verified");
    assert.equal(rec.repoUrl, `file://${repo}`);
    assert.equal(rec.skillPath, "skills/demo");
    assert.match(rec.sourceTreeHash, /^[0-9a-f]{40}$/);
    assert.equal(rec.disabled, false);
    // baseline 与安装副本当前摘要一致（disable 行不参与哈希）
    const destDir = join(env.agentDir, "skills", "demo");
    assert.equal(rec.baselineLocalHash, localDirHash(destDir));
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("02: 休眠/再启用后 disabled 与来源字段跟随更新", async () => {
  const repo = makeFixtureRepo();
  const env = makeAgentEnv([sub("sub-fixture", `file://${repo}`)]);
  const restoreFetch = stubFetchOffline();
  try {
    await toggleSkillState({ skillId: "sub-fixture-demo", enabled: true, cwd: repo });
    const destDir = join(env.agentDir, "skills", "demo");

    await toggleSkillState({ skillId: "sub-fixture-demo", enabled: false, cwd: repo });
    let rec = getInstall("demo");
    assert.equal(rec.disabled, true);
    assert.equal(rec.skillPath, "skills/demo", "休眠不应丢失来源路径");
    assert.match(rec.sourceTreeHash, /^[0-9a-f]{40}$/, "休眠不应丢失来源 hash");
    assert.equal(rec.baselineLocalHash, localDirHash(destDir), "休眠不改内容，基线不变");

    // 再启用：localPath 已被本地合并覆写为安装副本路径，skillPath 必须复用登记值而非反推
    const firstInstalledAt = getInstall("demo").installedAt;
    await toggleSkillState({ skillId: "sub-fixture-demo", enabled: true, cwd: repo });
    rec = getInstall("demo");
    assert.equal(rec.disabled, false);
    assert.equal(rec.skillPath, "skills/demo", "再启用后 skillPath 不得被反推污染");
    assert.match(rec.sourceTreeHash, /^[0-9a-f]{40}$/);
    assert.equal(rec.installedAt, firstInstalledAt, "再启用不重置首次安装时间");
    assert.ok(rec.updatedAt >= firstInstalledAt, "updatedAt 随操作前移");
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("02: 同名目录已被其他源安装 → 拒绝安装且登记表不被破坏", async () => {
  const repoA = makeFixtureRepo("skills/demo");
  const repoB = makeFixtureRepo("skills/demo");
  const env = makeAgentEnv([
    sub("sub-a", `file://${repoA}`),
    sub("sub-b", `file://${repoB}`),
  ]);
  const restoreFetch = stubFetchOffline();
  try {
    const first = await toggleSkillState({ skillId: "sub-a-demo", enabled: true, cwd: repoA });
    assert.equal(first.success, true, first.error);

    const second = await toggleSkillState({ skillId: "sub-b-demo", enabled: true, cwd: repoB });
    assert.equal(second.success, false);
    assert.match(second.error || "", /已由|拒绝/);

    const rec = getInstall("demo");
    assert.equal(rec.repoUrl, `file://${repoA}`, "登记表仍指向首个源");
    assert.equal(Object.keys(readRegistry().installs).length, 1, "登记表无额外记录");
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repoA, { recursive: true, force: true });
    rmSync(repoB, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

// ── v0.2.0 评审跟进（.scratch/v020-release-readiness/07、08）─────────────────

test("07: 同步失败但缓存健在 → updateState 退回上次已知，不报 unknown-origin", async () => {
  const repo = makeFixtureRepo();
  const env = makeAgentEnv([sub("sub-fixture", `file://${repo}`)]);
  const restoreFetch = stubFetchOffline();
  try {
    const res = await toggleSkillState({ skillId: "sub-fixture-demo", enabled: true, cwd: repo });
    assert.equal(res.success, true, res.error);

    // 摧毁 origin（fetch 必败），缓存目录保留 —— syncGitSubscription 走 fail-soft
    rmSync(repo, { recursive: true, force: true });
    const market = await getMarketSkills(env.agentDir, "all", undefined, { forceSync: true });
    const item = market.skills.find((s) => s.name === "demo" && s.subscriptionId === "sub-fixture");
    assert.ok(item, "旧缓存应继续解析出 demo");
    assert.equal(item.updateState, "up-to-date", "上次已知判定 = 缓存版本 == 登记版本");
    assert.notEqual(item.updateState, "unknown-origin", "拉取失败不得降级 unknown-origin");
  } finally {
    restoreFetch();
    env.restore();
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("08: 同名技能多源内容一致 → 反查歧义记 unknown，不补记", async () => {
  const repoA = makeFixtureRepo("skills/demo");
  const repoB = makeFixtureRepo("skills/demo");
  const env = makeAgentEnv([
    sub("sub-a", `file://${repoA}`),
    sub("sub-b", `file://${repoB}`),
  ]);
  const restoreFetch = stubFetchOffline();
  try {
    const res = await toggleSkillState({ skillId: "sub-a-demo", enabled: true, cwd: repoA });
    assert.equal(res.success, true, res.error);
    assert.equal(getInstall("demo")?.origin, "verified");

    // 模拟老安装：抹掉登记记录，让 resolveUpdateState 走反查分支
    assert.equal(removeInstall("demo"), true);
    assert.equal(getInstall("demo"), undefined);

    const market = await getMarketSkills(repoA, "all", undefined, { forceSync: true });
    const item = market.skills.find((s) => s.name === "demo" && s.subscriptionId === "sub-a");
    assert.ok(item, "demo 应出现在订阅源列表");
    assert.equal(item.updateState, "unknown-origin", "两源同名且内容一致 → 歧义取 unknown");

    assert.equal(getInstall("demo"), undefined, "歧义时不得凭先到先得补记 inferred");
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repoA, { recursive: true, force: true });
    rmSync(repoB, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("同步失败退避：失败源写 lastSyncedAt，TTL 窗内不再重试克隆（死源不再拖慢每次打开）", async () => {
  const env = makeAgentEnv([
    sub("sub-dead", `file:///nonexistent-dead-repo-${Date.now()}.git`),
  ]);
  const restoreFetch = stubFetchOffline();
  const subsFile = join(env.agentDir, "poweri-subscriptions.json");
  const readSubs = () => JSON.parse(readFileSync(subsFile, "utf8"));
  try {
    // 第一次：克隆必败 → 退避起点（lastSyncedAt）+ error 落盘
    await getMarketSkills(env.agentDir, "all");
    const first = readSubs()[0];
    assert.equal(typeof first.lastSyncedAt, "number", "失败也必须写 lastSyncedAt（退避起点）");
    assert.ok(first.error, "失败记录 error（源条 ⚠ 展示，fail-soft 不归零）");

    // 第二次（TTL 窗内）：跳过克隆。若仍重试，克隆会再次失败并推进 lastSyncedAt，
    // 断言不变即证明退避生效——死源不再让每次打开面板都白烧一次网络超时
    await getMarketSkills(env.agentDir, "all");
    assert.equal(readSubs()[0].lastSyncedAt, first.lastSyncedAt, "退避窗内不得重试克隆");
  } finally {
    restoreFetch();
    env.restore();
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});
