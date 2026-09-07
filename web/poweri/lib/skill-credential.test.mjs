/**
 * 工单 06：订阅凭据零泄露加固。
 * - buildAuthenticatedUrl / redactSecrets 为可测导出
 * - token 不落 .git/config（file:// fixture 验证 config 干净）
 * - 响应脱敏：subscriptions 无 token 键、hasToken 布尔
 * - poweri-subscriptions.json 权限 0600
 * - 错误消息脱敏
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { getMarketSkills, buildAuthenticatedUrl, redactSecrets } = await jiti.import("./skill-subscriptions.ts");

function makeFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "poweri-fixture-repo-"));
  const run = (args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  run(["init", "-q", "-b", "master"]);
  run(["config", "user.email", "test@example.test"]);
  run(["config", "user.name", "PowerI Test"]);
  const skillDir = join(dir, "skills", "demo");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "---\nname: demo\n---\n\n# Demo\n", "utf8");
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "init"]);
  return dir;
}

function makeAgentEnv(repo, token) {
  const agentDir = mkdtempSync(join(tmpdir(), "poweri-agent-"));
  const prevEnv = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  writeFileSync(
    join(agentDir, "poweri-subscriptions.json"),
    JSON.stringify([
      { id: "sub-fixture", url: `file://${repo}`, name: "fixture", category: "business", type: "git", token, addedAt: Date.now() },
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

test("06: buildAuthenticatedUrl 有 token 时注入 oauth2 凭据，无 token 原样", () => {
  assert.equal(
    buildAuthenticatedUrl("https://gitlab.litta.cn/litta/skills.git", "glpat-ABC"),
    "https://oauth2:glpat-ABC@gitlab.litta.cn/litta/skills.git",
  );
  assert.equal(buildAuthenticatedUrl("https://github.com/x/y.git", undefined), "https://github.com/x/y.git");
  // 非 http 协议不做凭据注入
  assert.equal(buildAuthenticatedUrl("file:///tmp/repo.git", "tok"), "file:///tmp/repo.git");
});

test("06: redactSecrets 剔除 token 与 URL 内嵌凭据", () => {
  assert.equal(redactSecrets("clone failed for glpat-ABC-very-secret", ["glpat-ABC-very-secret"]), "clone failed for ***");
  assert.equal(
    redactSecrets("fatal: unable to access 'https://oauth2:glpat-X@gitlab.example/x.git/'", []),
    "fatal: unable to access 'https://***@gitlab.example/x.git/'",
  );
  // 短 token（<4 字符）不替换，避免误伤
  assert.equal(redactSecrets("token is ab", ["ab"]), "token is ab");
  // 无敏感信息原样
  assert.equal(redactSecrets("no secrets here", ["secret-a"]), "no secrets here");
});

test("06: 带 token 的订阅同步后 .git/config 不含凭据", async () => {
  const repo = makeFixtureRepo();
  const env = makeAgentEnv(repo, "glpat-SECRET-foo");
  const restoreFetch = stubFetchOffline();
  try {
    const res = await getMarketSkills(repo, "all", undefined, { forceSync: true });
    assert.ok(res.skills.length >= 1, "应能正常同步");

    const config = readFileSync(join(env.agentDir, "git-subscriptions", "sub-fixture", ".git", "config"), "utf8");
    assert.equal(config.includes("glpat-SECRET-foo"), false, "config 不得含 token");
    assert.equal(config.includes("oauth2"), false, "config 不得含 oauth2 凭据形态");
    assert.ok(config.includes(`file://${repo}`), "origin.url 保持干净 URL");
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("06: getMarketSkills 返回的 subscriptions 无 token 键，hasToken 正确", async () => {
  const repo = makeFixtureRepo();
  const env = makeAgentEnv(repo, "glpat-SECRET-foo");
  const restoreFetch = stubFetchOffline();
  try {
    const res = await getMarketSkills(repo, "all", undefined, { forceSync: true });
    const sub = res.subscriptions[0];
    assert.equal("token" in sub, false, "响应不得含 token 键");
    assert.equal(sub.hasToken, true);
    const serialized = JSON.stringify(res);
    assert.equal(serialized.includes("glpat-SECRET-foo"), false, "整个响应序列化不得含 token");
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("06: poweri-subscriptions.json 权限 0600", async () => {
  const repo = makeFixtureRepo();
  const env = makeAgentEnv(repo, undefined);
  const restoreFetch = stubFetchOffline();
  try {
    await getMarketSkills(repo, "all", undefined, { forceSync: true });
    if (process.platform !== "win32") {
      const mode = statSync(join(env.agentDir, "poweri-subscriptions.json")).mode & 0o777;
      assert.equal(mode, 0o600, `期望 0600，实际 ${mode.toString(8)}`);
    }
  } finally {
    restoreFetch();
    env.restore();
    rmSync(repo, { recursive: true, force: true });
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("06: 克隆失败错误消息被脱敏（不含 token）", async () => {
  const env = makeAgentEnv("/nonexistent-poweri-fixture-repo", "glpat-SECRET-foo");
  const restoreFetch = stubFetchOffline();
  try {
    const res = await getMarketSkills(env.agentDir, "all", undefined, { forceSync: true });
    assert.ok(res.subscriptions[0].error, "应有错误");
    assert.equal(res.subscriptions[0].error.includes("glpat-SECRET-foo"), false, "错误消息不得含 token");
    assert.equal(JSON.stringify(res).includes("glpat-SECRET-foo"), false);
  } finally {
    restoreFetch();
    env.restore();
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});
