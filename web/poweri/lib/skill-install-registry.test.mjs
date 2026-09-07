import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  readRegistry,
  writeRegistry,
  upsertInstall,
  getInstall,
  removeInstall,
  getRegistryFilePath,
  REGISTRY_VERSION,
} from "./skill-install-registry.ts";

function makeAgentDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "poweri-registry-"));
}

function sampleRecord(overrides = {}) {
  return {
    folder: "enterprise-semantic",
    origin: "verified",
    subscriptionId: "sub-abc",
    repoUrl: "https://gitlab.example.test/litta/litta-skills.git",
    skillPath: "skills/enterprise-semantic",
    sourceTreeHash: "a".repeat(40),
    baselineLocalHash: "sha256:" + "b".repeat(64),
    disabled: false,
    installedAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

test("readRegistry 无文件时返回空表且不落盘", () => {
  const agentDir = makeAgentDir();
  try {
    const reg = readRegistry(agentDir);
    assert.equal(reg.version, REGISTRY_VERSION);
    assert.deepEqual(Object.keys(reg.installs), []);
    assert.equal(fs.existsSync(getRegistryFilePath(agentDir)), false);
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("upsertInstall 写入后 readRegistry 重读一致", () => {
  const agentDir = makeAgentDir();
  try {
    upsertInstall(sampleRecord(), agentDir);
    const reg = readRegistry(agentDir);
    assert.equal(reg.version, REGISTRY_VERSION);
    assert.deepEqual(reg.installs["enterprise-semantic"], sampleRecord());
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("upsertInstall 覆盖同名记录", () => {
  const agentDir = makeAgentDir();
  try {
    upsertInstall(sampleRecord(), agentDir);
    upsertInstall(sampleRecord({ sourceTreeHash: "c".repeat(40), updatedAt: 1700000000001 }), agentDir);
    const reg = readRegistry(agentDir);
    assert.equal(reg.installs["enterprise-semantic"].sourceTreeHash, "c".repeat(40));
    assert.equal(reg.installs["enterprise-semantic"].updatedAt, 1700000000001);
    assert.equal(Object.keys(reg.installs).length, 1);
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("getInstall 命中与未命中", () => {
  const agentDir = makeAgentDir();
  try {
    upsertInstall(sampleRecord(), agentDir);
    assert.deepEqual(getInstall("enterprise-semantic", agentDir), sampleRecord());
    assert.equal(getInstall("no-such-skill", agentDir), undefined);
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("removeInstall 首次删除返回 true，再次返回 false", () => {
  const agentDir = makeAgentDir();
  try {
    upsertInstall(sampleRecord(), agentDir);
    assert.equal(removeInstall("enterprise-semantic", agentDir), true);
    assert.equal(getInstall("enterprise-semantic", agentDir), undefined);
    assert.equal(removeInstall("enterprise-semantic", agentDir), false);
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("损坏 JSON → 空表且原文件保留", () => {
  const agentDir = makeAgentDir();
  try {
    const file = getRegistryFilePath(agentDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ this is not valid json !!!", "utf8");
    const reg = readRegistry(agentDir);
    assert.deepEqual(Object.keys(reg.installs), []);
    assert.equal(fs.existsSync(file), true);
    assert.equal(fs.readFileSync(file, "utf8"), "{ this is not valid json !!!");
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("installs 缺失或非对象 → 空表", () => {
  const agentDir = makeAgentDir();
  try {
    const file = getRegistryFilePath(agentDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1 }), "utf8");
    assert.deepEqual(Object.keys(readRegistry(agentDir).installs), []);
    fs.writeFileSync(file, JSON.stringify([1, 2, 3]), "utf8");
    assert.deepEqual(Object.keys(readRegistry(agentDir).installs), []);
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("writeRegistry 原子落盘可重读", () => {
  const agentDir = makeAgentDir();
  try {
    const file = getRegistryFilePath(agentDir);
    writeRegistry({ version: REGISTRY_VERSION, installs: { k: sampleRecord({ folder: "k" }) } }, agentDir);
    assert.deepEqual(readRegistry(agentDir).installs.k, sampleRecord({ folder: "k" }));
    // 不残留 tmp 文件
    assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((n) => n.includes(".tmp-")), []);
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("getRegistryFilePath 默认路径跟随 PI_CODING_AGENT_DIR", () => {
  const agentDir = makeAgentDir();
  const prev = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const file = getRegistryFilePath();
    assert.equal(file, path.join(agentDir, "poweri-skill-installs.json"));
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

// ---------- 切片 2：stripDisableLine + localDirHash ----------

import { stripDisableLine, localDirHash, resolveCacheDir } from "./skill-install-registry.ts";

const SKILL_WITH_KEY = `---
name: demo
disable-model-invocation: true
description: hello
---

# Demo

body mentions disable-model-invocation: false in prose
`;

const SKILL_WITHOUT_KEY = `---
name: demo
description: hello
---

# Demo

body mentions disable-model-invocation: false in prose
`;

test("localDirHash 格式为 sha256:<64hex> 且对同一内容稳定", () => {
  const dir = makeAgentDir();
  try {
    fs.mkdirSync(path.join(dir, "refs"), { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), SKILL_WITHOUT_KEY, "utf8");
    fs.writeFileSync(path.join(dir, "refs", "a.md"), "alpha", "utf8");
    const h1 = localDirHash(dir);
    const h2 = localDirHash(dir);
    assert.match(h1, /^sha256:[0-9a-f]{64}$/);
    assert.equal(h1, h2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("localDirHash 对新增/修改/删除文件敏感", () => {
  const dir = makeAgentDir();
  try {
    fs.mkdirSync(path.join(dir, "refs"), { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), SKILL_WITHOUT_KEY, "utf8");
    fs.writeFileSync(path.join(dir, "refs", "a.md"), "alpha", "utf8");
    const base = localDirHash(dir);

    fs.writeFileSync(path.join(dir, "refs", "b.md"), "bravo", "utf8");
    assert.notEqual(localDirHash(dir), base, "新增文件应改变 hash");

    fs.writeFileSync(path.join(dir, "refs", "b.md"), "bravo-v2", "utf8");
    const withB = localDirHash(dir);
    assert.notEqual(withB, base, "修改文件应改变 hash");

    fs.rmSync(path.join(dir, "refs", "b.md"));
    assert.equal(localDirHash(dir), base, "删除文件应回到原 hash");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("localDirHash 与文件遍历顺序无关", () => {
  const dirA = makeAgentDir();
  const dirB = makeAgentDir();
  try {
    for (const d of [dirA, dirB]) {
      fs.mkdirSync(path.join(d, "refs"), { recursive: true });
    }
    // A：a 先写 b 后写；B：b 先写 a 后写（readdir 顺序可能不同，排序后必须一致）
    fs.writeFileSync(path.join(dirA, "SKILL.md"), SKILL_WITHOUT_KEY, "utf8");
    fs.writeFileSync(path.join(dirA, "refs", "a.md"), "alpha", "utf8");
    fs.writeFileSync(path.join(dirA, "refs", "b.md"), "bravo", "utf8");
    fs.writeFileSync(path.join(dirB, "refs", "b.md"), "bravo", "utf8");
    fs.writeFileSync(path.join(dirB, "refs", "a.md"), "alpha", "utf8");
    fs.writeFileSync(path.join(dirB, "SKILL.md"), SKILL_WITHOUT_KEY, "utf8");
    assert.equal(localDirHash(dirA), localDirHash(dirB));
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});

test("stripDisableLine 剔除 true/false/引号键，正文不受影响", () => {
  const stripped = stripDisableLine(SKILL_WITH_KEY);
  assert.equal(stripped, SKILL_WITHOUT_KEY);

  const quoted = `---\n"disable-model-invocation": true\nname: demo\n---\nbody`;
  assert.equal(stripDisableLine(quoted), `---\nname: demo\n---\nbody`);

  const single = `---\n'disable-model-invocation': false\nname: demo\n---\nbody`;
  assert.equal(stripDisableLine(single), `---\nname: demo\n---\nbody`);
});

test("无 frontmatter 的内容 stripDisableLine 原样返回", () => {
  const plain = "# Demo\nno frontmatter here\n";
  assert.equal(stripDisableLine(plain), plain);
});

test("仅 disable-model-invocation 行差异的两个目录 → localDirHash 相同（休眠不算偏离）", () => {
  const dirOn = makeAgentDir();
  const dirOff = makeAgentDir();
  try {
    fs.writeFileSync(path.join(dirOn, "SKILL.md"), SKILL_WITH_KEY, "utf8");
    fs.writeFileSync(path.join(dirOff, "SKILL.md"), SKILL_WITHOUT_KEY, "utf8");
    assert.equal(localDirHash(dirOn), localDirHash(dirOff));
  } finally {
    fs.rmSync(dirOn, { recursive: true, force: true });
    fs.rmSync(dirOff, { recursive: true, force: true });
  }
});

test("localDirHash 对空目录与深层嵌套目录稳定产出", () => {
  const empty = makeAgentDir();
  const nested = makeAgentDir();
  try {
    assert.match(localDirHash(empty), /^sha256:[0-9a-f]{64}$/);
    fs.mkdirSync(path.join(nested, "a", "b", "c"), { recursive: true });
    fs.writeFileSync(path.join(nested, "a", "b", "c", "deep.txt"), "deep", "utf8");
    assert.equal(localDirHash(nested), localDirHash(nested));
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
    fs.rmSync(nested, { recursive: true, force: true });
  }
});

// ---------- 切片 3：remoteTreeHash ----------

import { execFileSync } from "node:child_process";
import { remoteTreeHash } from "./skill-install-registry.ts";

function makeFixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "poweri-git-fixture-"));
  const run = (args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  run(["init", "-q", "-b", "master"]);
  run(["config", "user.email", "test@example.test"]);
  run(["config", "user.name", "PowerI Test"]);
  return { dir, run };
}

function commitAll(repo, message) {
  repo.run(["add", "-A"]);
  repo.run(["commit", "-q", "-m", message]);
}

test("remoteTreeHash 在 fixture 仓库返回 40 hex 且为目录 tree hash", async () => {
  const repo = makeFixtureRepo();
  try {
    fs.mkdirSync(path.join(repo.dir, "skills", "demo"), { recursive: true });
    fs.writeFileSync(path.join(repo.dir, "skills", "demo", "SKILL.md"), SKILL_WITHOUT_KEY, "utf8");
    commitAll(repo, "add demo skill");

    const hash = await remoteTreeHash(repo.dir, "skills/demo");
    assert.match(hash, /^[0-9a-f]{40}$/);
    // 与 git rev-parse 直接输出一致（独立来源对账）
    const direct = repo.run(["rev-parse", "HEAD:skills/demo"]).toString().trim();
    assert.equal(hash, direct);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("同仓库另一子目录改动后，本目录 tree hash 不变", async () => {
  const repo = makeFixtureRepo();
  try {
    fs.mkdirSync(path.join(repo.dir, "skills", "demo"), { recursive: true });
    fs.mkdirSync(path.join(repo.dir, "skills", "other"), { recursive: true });
    fs.writeFileSync(path.join(repo.dir, "skills", "demo", "SKILL.md"), SKILL_WITHOUT_KEY, "utf8");
    fs.writeFileSync(path.join(repo.dir, "skills", "other", "SKILL.md"), "---\nname: other\n---\n", "utf8");
    commitAll(repo, "add demo + other");

    const demoHash = await remoteTreeHash(repo.dir, "skills/demo");

    fs.writeFileSync(path.join(repo.dir, "skills", "other", "SKILL.md"), "---\nname: other-v2\n---\n", "utf8");
    commitAll(repo, "only other changed");
    assert.equal(await remoteTreeHash(repo.dir, "skills/demo"), demoHash, "兄弟目录改动不应影响本目录 hash");
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("本目录自身内容变化后 hash 前移", async () => {
  const repo = makeFixtureRepo();
  try {
    fs.mkdirSync(path.join(repo.dir, "skills", "demo"), { recursive: true });
    fs.writeFileSync(path.join(repo.dir, "skills", "demo", "SKILL.md"), SKILL_WITHOUT_KEY, "utf8");
    commitAll(repo, "v1");
    const v1 = await remoteTreeHash(repo.dir, "skills/demo");

    fs.mkdirSync(path.join(repo.dir, "skills", "demo", "references"), { recursive: true });
    fs.writeFileSync(path.join(repo.dir, "skills", "demo", "references", "new.md"), "new", "utf8");
    commitAll(repo, "v2");
    assert.notEqual(await remoteTreeHash(repo.dir, "skills/demo"), v1);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("skillPath 不存在 → 抛错", async () => {
  const repo = makeFixtureRepo();
  try {
    fs.writeFileSync(path.join(repo.dir, "README.md"), "readme", "utf8");
    commitAll(repo, "init");
    await assert.rejects(() => remoteTreeHash(repo.dir, "skills/nope"), /failed|error/i);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

// ---------- 评审修复：回归测试 ----------

test("folder 名为 __proto__ 的记录可正常往返（原型污染防护）", () => {
  const agentDir = makeAgentDir();
  try {
    upsertInstall(sampleRecord({ folder: "__proto__" }), agentDir);
    const reg = readRegistry(agentDir);
    assert.ok(Object.hasOwn(reg.installs, "__proto__"), "installs 应持有自有 __proto__ 键");
    assert.deepEqual(reg.installs["__proto__"], sampleRecord({ folder: "__proto__" }));
    assert.equal(Object.keys(reg.installs).length, 1);
    assert.equal(removeInstall("__proto__", agentDir), true);
    assert.equal(readRegistry(agentDir).installs["__proto__"], undefined);
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("无 frontmatter 的文件正文出现 disable 行不被误删", () => {
  const bodyOnly = "title: x\n---\n# body\ndisable-model-invocation: true\nmore\n";
  assert.equal(stripDisableLine(bodyOnly), bodyOnly);
});

test("disable 行位于 frontmatter 首行也能剔除", () => {
  const first = `---\ndisable-model-invocation: true\nname: demo\n---\nbody`;
  assert.equal(stripDisableLine(first), `---\nname: demo\n---\nbody`);
});

test("非 SKILL.md 文件里的 disable 行属于用户内容，计入偏离", () => {
  const dirA = makeAgentDir();
  const dirB = makeAgentDir();
  try {
    for (const d of [dirA, dirB]) {
      fs.mkdirSync(path.join(d, "references"), { recursive: true });
      fs.writeFileSync(path.join(d, "SKILL.md"), SKILL_WITHOUT_KEY, "utf8");
    }
    // A 的 references/x.md 带 disable 行（用户自写），B 不带
    fs.writeFileSync(path.join(dirA, "references", "x.md"), "---\ndisable-model-invocation: true\n---\n", "utf8");
    fs.writeFileSync(path.join(dirB, "references", "x.md"), "---\n---\n", "utf8");
    assert.notEqual(localDirHash(dirA), localDirHash(dirB), "references 里的 disable 行应算用户偏离");
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});

test("writeRegistry 拒绝覆盖损坏的登记表文件（响亮失败替代静默清空）", () => {
  const agentDir = makeAgentDir();
  try {
    const file = getRegistryFilePath(agentDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ corrupted !!!", "utf8");
    assert.throws(() => writeRegistry({ version: REGISTRY_VERSION, installs: {} }, agentDir), /损坏|corrupt/i);
    assert.equal(fs.readFileSync(file, "utf8"), "{ corrupted !!!");
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("resolveCacheDir 指向 agentDir/git-subscriptions/<id>", () => {
  const agentDir = makeAgentDir();
  const prev = process.env.PI_CODING_AGENT_DIR;
  try {
    assert.equal(resolveCacheDir("sub-abc", agentDir), path.join(agentDir, "git-subscriptions", "sub-abc"));
    // 默认路径跟随 PI_CODING_AGENT_DIR
    process.env.PI_CODING_AGENT_DIR = agentDir;
    assert.equal(resolveCacheDir("sub-abc"), path.join(agentDir, "git-subscriptions", "sub-abc"));
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});
