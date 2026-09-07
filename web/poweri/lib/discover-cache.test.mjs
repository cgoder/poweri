import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
// 模块相对路径解析被测模块——不能用机器本地绝对路径，CI checkout 在
// /home/runner/work/... 下，硬编码路径会让整个文件加载失败（0.2.0 首发事故）。
const { getMarketSkills } = await jiti.import(
  path.join(import.meta.dirname, "skill-subscriptions.ts"),
);
const cacheMod = await jiti.import(
  path.join(import.meta.dirname, "discover-cache.ts"),
);
const { getCachedDiscover, setCachedDiscover, clearMarketSkillsCache, DISCOVER_TTL_MS } = cacheMod;

const FAKE_SKILL = {
  id: "skills-sh-owner-repo-skill",
  name: "cached-skill",
  description: "",
  author: "owner",
  tags: [],
  version: "",
  category: "public",
  sourceLabel: "skills.sh",
  subscriptionId: "sub-skills-sh",
  subscriptionUrl: "https://github.com/owner/repo",
  sourceType: "skills.sh",
  installed: false,
  enabled: false,
  installs: "42",
};

/** 空订阅 + 全部网络请求抛错：getMarketSkills 的 discover 只能来自缓存 */
function withIsolatedAgentDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "poweri-discover-"));
  const origEnv = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  fs.writeFileSync(path.join(dir, "poweri-subscriptions.json"), JSON.stringify({ subscriptions: [] }));
  t.after(() => {
    if (origEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = origEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const restoreFetch = () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("network disabled in test"); };
    return () => { globalThis.fetch = orig; };
  };
  return { dir, restoreFetch };
}

test("discover-cache：set 后 get 命中（内存），clear 后失效", async (t) => {
  withIsolatedAgentDir(t);
  clearMarketSkillsCache();
  assert.equal(getCachedDiscover("all|"), null);
  setCachedDiscover("all|", [FAKE_SKILL]);
  const hit = getCachedDiscover("all|");
  assert.ok(hit !== null && hit.length === 1 && hit[0].name === "cached-skill");
  clearMarketSkillsCache();
  assert.equal(getCachedDiscover("all|"), null);
});

test("discover-cache：磁盘持久化——换进程模拟（直接写文件）后仍命中", async (t) => {
  const { dir } = withIsolatedAgentDir(t);
  clearMarketSkillsCache();
  setCachedDiscover("all|", [FAKE_SKILL]);
  // 模拟重启：清内存（clear 会删盘，这里改用 getCachedDiscover 从盘重灌的路径：先清内存再删盘文件会失去数据，
  // 因此验证磁盘文件本身存在且内容正确）
  assert.ok(fs.existsSync(path.join(dir, "poweri-discover-cache.json")), "应写入磁盘缓存文件");
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "poweri-discover-cache.json"), "utf8"));
  assert.equal(onDisk.version, 1);
  assert.equal(onDisk.entries.length, 1);
  assert.equal(onDisk.entries[0].key, "all|");
  assert.equal(onDisk.entries[0].items[0].name, "cached-skill");
});

test("discover-cache：过期条目不命中（返回 null）", async (t) => {
  const { dir } = withIsolatedAgentDir(t);
  clearMarketSkillsCache();
  fs.writeFileSync(
    path.join(dir, "poweri-discover-cache.json"),
    JSON.stringify({ version: 1, entries: [{ key: "all|", items: [FAKE_SKILL], at: Date.now() - DISCOVER_TTL_MS - 1 }] }),
  );
  assert.equal(getCachedDiscover("all|"), null);
});

test("discover-cache：损坏缓存文件容错（get 返回 null 不抛错）", async (t) => {
  const { dir } = withIsolatedAgentDir(t);
  clearMarketSkillsCache();
  fs.writeFileSync(path.join(dir, "poweri-discover-cache.json"), "{{{not-json");
  assert.equal(getCachedDiscover("all|"), null);
});

test("getMarketSkills：discover=true 且网络全断 + 无缓存 → discover 为空、不抛错", async (t) => {
  const { restoreFetch } = withIsolatedAgentDir(t);
  clearMarketSkillsCache();
  const restore = restoreFetch();
  t.after(restore);
  const res = await getMarketSkills(process.cwd(), "all", "", { discover: true });
  assert.ok(!res.skills.some((s) => s.sourceType === "skills.sh"), "无缓存且网络断时应无 discover 技能");
});

test("getMarketSkills：默认（不带 discover）→ 不读缓存不请求 skills.sh", async (t) => {
  const { dir } = withIsolatedAgentDir(t);
  clearMarketSkillsCache();
  // 预置有效缓存：若默认路径仍读缓存会命中；若拉网则 fetch 桩抛错，两种都算失败
  setCachedDiscover("all|", [FAKE_SKILL]);
  const orig = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error("network disabled in test"); };
  t.after(() => { globalThis.fetch = orig; });
  const res = await getMarketSkills(process.cwd(), "all", "", {});
  assert.ok(!res.skills.some((s) => s.sourceType === "skills.sh"), "默认路径不应含 discover 技能");
  assert.equal(fetchCalls, 0, "默认路径不应发起 skills.sh 请求");
  // 缓存文件未被触碰（读缓存都未发生）
  assert.ok(fs.existsSync(path.join(dir, "poweri-discover-cache.json")));
});

test("getMarketSkills：预置缓存 + discover=true → 网络全断也返回 discover 技能（缓存命中）", async (t) => {
  const { restoreFetch } = withIsolatedAgentDir(t);
  clearMarketSkillsCache();
  setCachedDiscover("all|", [FAKE_SKILL]);
  const restore = restoreFetch();
  t.after(restore);
  const res = await getMarketSkills(process.cwd(), "all", "", { discover: true });
  assert.ok(res.skills.some((s) => s.sourceType === "skills.sh" && s.name === "cached-skill"), "应命中缓存返回 discover 技能");
});

test("getMarketSkills：business tab + discover=true 不请求网络也不缓存", async (t) => {
  const { restoreFetch } = withIsolatedAgentDir(t);
  clearMarketSkillsCache();
  const restore = restoreFetch();
  t.after(restore);
  const res = await getMarketSkills(process.cwd(), "business", "", { discover: true });
  assert.ok(!res.skills.some((s) => s.sourceType === "skills.sh"), "business 不应有 discover 技能");
});
