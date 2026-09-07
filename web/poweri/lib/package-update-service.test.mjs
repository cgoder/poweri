/**
 * 包更新检测服务(poweri/lib/package-update-service.ts)。
 * SDK 调用通过 fetcher 注入桩,零网络零 spawn;重点验证 TTL 缓存语义、fail-soft 与匹配纯函数。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const {
  getPackageUpdates,
  clearPackageUpdatesCacheForTests,
  PACKAGE_UPDATES_TTL_MS,
} = await jiti.import("./package-update-service.ts");
const { isPackageUpdateAvailable } = await jiti.import("./package-update-shared.ts");
const { isSamePackage } = await jiti.import("./packages-catalog.ts");

function makeUpdates(list) {
  return list.map(([source, displayName]) => ({ source, displayName, type: "npm", scope: "user" }));
}

test("getPackageUpdates: 首次调用走 fetcher,summary 反映 outdated 数量", async () => {
  clearPackageUpdatesCacheForTests();
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return makeUpdates([["npm:pi-rewind", "pi-rewind"]]);
  };
  const result = await getPackageUpdates("/fixture/cwd", { fetcher, now: () => 1_000_000 });
  assert.equal(calls, 1);
  assert.equal(result.summary.outdated, 1);
  assert.equal(result.updates[0].source, "npm:pi-rewind");
  assert.equal(result.checkedAt, 1_000_000);
  assert.equal(result.error, undefined);
});

test("getPackageUpdates: TTL 窗口内复用缓存零 fetch,force 绕过缓存", async () => {
  clearPackageUpdatesCacheForTests();
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return makeUpdates([["npm:a", "a"]]);
  };
  let t = 10_000;
  const now = () => t;

  await getPackageUpdates("/fixture/cwd-ttl", { fetcher, now });
  await getPackageUpdates("/fixture/cwd-ttl", { fetcher, now });
  assert.equal(calls, 1, "TTL 窗口内第二次调用不应触发 fetcher");

  t += PACKAGE_UPDATES_TTL_MS + 1;
  await getPackageUpdates("/fixture/cwd-ttl", { fetcher, now });
  assert.equal(calls, 2, "TTL 过期后应重新检测");

  await getPackageUpdates("/fixture/cwd-ttl", { fetcher, now, force: true });
  assert.equal(calls, 3, "force 应绕过缓存");
});

test("getPackageUpdates: 不同 cwd 缓存隔离", async () => {
  clearPackageUpdatesCacheForTests();
  const seen = [];
  const fetcher = async (cwd) => {
    seen.push(cwd);
    return makeUpdates(cwd.endsWith("b") ? [["npm:b", "b"]] : []);
  };
  const a = await getPackageUpdates("/fixture/a", { fetcher, now: () => 0 });
  const b = await getPackageUpdates("/fixture/b", { fetcher, now: () => 0 });
  assert.equal(a.summary.outdated, 0);
  assert.equal(b.summary.outdated, 1);
  assert.deepEqual(seen, ["/fixture/a", "/fixture/b"]);
});

test("getPackageUpdates: fail-soft — fetcher 抛错返回空结果 + error,且不缓存", async () => {
  clearPackageUpdatesCacheForTests();
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    throw new Error("npm view failed");
  };
  const failed = await getPackageUpdates("/fixture/err", { fetcher, now: () => 0 });
  assert.deepEqual(failed.updates, []);
  assert.equal(failed.summary.outdated, 0);
  assert.equal(failed.error, "npm view failed");

  // 失败不写缓存:恢复后立即重试成功
  const ok = await getPackageUpdates("/fixture/err", {
    fetcher: async () => makeUpdates([["npm:c", "c"]]),
    now: () => 0,
  });
  assert.equal(ok.summary.outdated, 1);
  assert.equal(calls, 1, "失败结果不应被缓存");
});

test("isPackageUpdateAvailable: source/displayName 双通道 + 版本锁定规范化匹配", () => {
  const updates = makeUpdates([
    ["npm:pi-mcp-adapter", "pi-mcp-adapter"],
    ["npm:@tintinweb/pi-subagents", "@tintinweb/pi-subagents"],
  ]);
  assert.equal(isPackageUpdateAvailable("npm:pi-mcp-adapter", updates, isSamePackage), true);
  assert.equal(isPackageUpdateAvailable("npm:pi-mcp-adapter@2.0.0", updates, isSamePackage), true, "锁版本安装也应命中");
  assert.equal(isPackageUpdateAvailable("npm:@tintinweb/pi-subagents", updates, isSamePackage), true);
  assert.equal(isPackageUpdateAvailable("npm:@tintinweb/pi-subagents@0.19.0", updates, isSamePackage), true);
  assert.equal(isPackageUpdateAvailable("npm:pi-web-access", updates, isSamePackage), false);
  assert.equal(isPackageUpdateAvailable("", updates, isSamePackage), false);
});
