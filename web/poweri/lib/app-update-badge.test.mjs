/**
 * 应用本体更新圆点共享层（poweri/lib/app-update-badge.ts）。
 * 重点验证 deriveAppUpdateBadge 各状态推导与 store 的订阅广播语义。
 */
import test from "node:test";
import assert from "node:assert/strict";

const {
  getAppUpdateBadgeState,
  setAppUpdateBadgeState,
  subscribeAppUpdateBadge,
  resetAppUpdateBadgeForTests,
  deriveAppUpdateBadge,
} = await import("./app-update-badge.ts");

test("01: deriveAppUpdateBadge — loading 阶段不示意", () => {
  assert.deepEqual(deriveAppUpdateBadge("loading", null, null), {
    checked: false,
    updateAvailable: false,
    latest: null,
    mode: null,
  });
});

test("02: deriveAppUpdateBadge — dev 模式 checked 但永不示意", () => {
  // dev 态 latest 恒为 null，防御性断言：即使误传也不示意
  assert.deepEqual(deriveAppUpdateBadge("idle", "dev", null), {
    checked: true,
    updateAvailable: false,
    latest: null,
    mode: "dev",
  });
  assert.equal(deriveAppUpdateBadge("idle", "dev", "9.9.9").updateAvailable, false);
});

test("03: deriveAppUpdateBadge — 有新版时示意并带版本号", () => {
  const badge = deriveAppUpdateBadge("idle", "shell", "0.2.9");
  assert.equal(badge.checked, true);
  assert.equal(badge.updateAvailable, true);
  assert.equal(badge.latest, "0.2.9");
  assert.equal(badge.mode, "shell");
});

test("04: deriveAppUpdateBadge — 已是最新/空版本号不示意", () => {
  assert.equal(deriveAppUpdateBadge("idle", "shell", null).updateAvailable, false);
  assert.equal(deriveAppUpdateBadge("idle", "browser", "").updateAvailable, false);
  assert.equal(deriveAppUpdateBadge("idle", "browser", null).latest, null);
});

test("05: deriveAppUpdateBadge — done（已安装未重启）latest 清空后圆点消失", () => {
  assert.equal(deriveAppUpdateBadge("done", "shell", null).updateAvailable, false);
});

test("06: deriveAppUpdateBadge — error 态保留旧 latest（失败不覆盖好答案）", () => {
  const badge = deriveAppUpdateBadge("error", "shell", "0.2.9");
  assert.equal(badge.updateAvailable, true);
  assert.equal(badge.latest, "0.2.9");
});

test("07: store — set 后读取同一引用并按序广播", () => {
  resetAppUpdateBadgeForTests();
  const seen = [];
  const unsub = subscribeAppUpdateBadge(() => {
    seen.push(getAppUpdateBadgeState());
  });
  const next = { checked: true, updateAvailable: true, latest: "0.2.9", mode: "shell" };
  setAppUpdateBadgeState(next);
  unsub();
  const after = { checked: true, updateAvailable: false, latest: null, mode: "shell" };
  setAppUpdateBadgeState(after);

  assert.equal(seen.length, 1, "退订后不再收到广播");
  assert.equal(seen[0], next, "广播携带的是当次整体替换的对象");
  assert.equal(getAppUpdateBadgeState(), after, "读取的是最近一次整体替换的对象");
  assert.equal(getAppUpdateBadgeState().updateAvailable, false);
});

test("08: store — 初始态未检测不示意", () => {
  resetAppUpdateBadgeForTests();
  const state = getAppUpdateBadgeState();
  assert.equal(state.checked, false);
  assert.equal(state.updateAvailable, false);
  assert.equal(state.latest, null);
});
