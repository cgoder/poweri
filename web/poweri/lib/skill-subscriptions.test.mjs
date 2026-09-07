/**
 * 默认订阅源收敛（2026-09 拍板：只保留 skills.sh 官方源，业务/精选源一律用户手动配置）
 * 与旧文件迁移（isDefault 非白名单源读取时移除、写回、清缓存目录）。
 * PI_CODING_AGENT_DIR 指向 fixture 目录，零网络零真实用户数据。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { DEFAULT_SUBSCRIPTIONS, readSubscriptions } = await jiti.import("./skill-subscriptions.ts");
const { resolveCacheDir } = await jiti.import("./skill-install-registry.ts");

test("默认订阅源只保留 skills.sh 官方源（服务于搜索/发现）", () => {
  assert.deepEqual(
    DEFAULT_SUBSCRIPTIONS.map((s) => s.id),
    ["sub-skills-sh"],
    "LITTA 团队源 / Pi 精选源不再预置，一律用户手动配置",
  );
  for (const sub of DEFAULT_SUBSCRIPTIONS) {
    assert.equal(sub.isDefault, true);
  }
});

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

test("迁移：旧默认源（LITTA/Pi）读取时移除并写回，手动添加的源保留", () => {
  const subs = [
    { id: "sub-litta-business", url: "https://gitlab.litta.cn/litta/litta-skills.git", name: "LITTA 团队源", category: "business", type: "git", addedAt: 1, isDefault: true },
    { id: "sub-skills-sh", url: "https://github.com/vercel-labs/skills.git", name: "skills.sh 官方源", category: "public", type: "git", addedAt: 1, isDefault: true },
    { id: "sub-pi-public-skills", url: "https://github.com/earendil-works/pi-skills.git", name: "Pi 精选源", category: "public", type: "git", addedAt: 1, isDefault: true },
    { id: "sub-manual", url: "https://example.com/team.git", name: "手动配置", category: "business", type: "git", addedAt: 2 },
  ];
  const env = makeAgentEnv(subs);
  const file = join(env.agentDir, "poweri-subscriptions.json");
  try {
    const result = readSubscriptions();
    assert.deepEqual(
      result.map((s) => s.id).sort(),
      ["sub-manual", "sub-skills-sh"],
      "isDefault 非白名单源被移除，手动源不受影响",
    );
    // 文件写回持久化（下次读取不再触发迁移）
    const persisted = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(persisted.map((s) => s.id).sort(), ["sub-manual", "sub-skills-sh"]);
    // 幂等：再次读取无变化
    assert.deepEqual(readSubscriptions().map((s) => s.id).sort(), ["sub-manual", "sub-skills-sh"]);
  } finally {
    env.restore();
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});

test("迁移：被移除默认源的缓存克隆目录一并清理", () => {
  const subs = [
    { id: "sub-litta-business", url: "https://gitlab.litta.cn/litta/litta-skills.git", name: "LITTA 团队源", category: "business", type: "git", addedAt: 1, isDefault: true },
    { id: "sub-skills-sh", url: "https://github.com/vercel-labs/skills.git", name: "skills.sh 官方源", category: "public", type: "git", addedAt: 1, isDefault: true },
  ];
  const env = makeAgentEnv(subs);
  try {
    // 预置 stale 源的缓存目录，模拟旧机器上的克隆残留
    const staleCache = resolveCacheDir("sub-litta-business", env.agentDir);
    mkdirSync(staleCache, { recursive: true });
    writeFileSync(join(staleCache, ".marker"), "x", "utf8");

    readSubscriptions();

    assert.equal(existsSync(staleCache), false, "stale 默认源的缓存目录应被清理");
    assert.equal(
      existsSync(resolveCacheDir("sub-skills-sh", env.agentDir)),
      false,
      "白名单默认源不受迁移影响",
    );
  } finally {
    env.restore();
    rmSync(env.agentDir, { recursive: true, force: true });
  }
});
