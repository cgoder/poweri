// memory-core 单元测试（node --test，零依赖）
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import {
  TEMPLATE,
  ensureMemoryFile,
  parseSections,
  renderMemory,
  applyRemember,
  applyRecover,
  truncateInjection,
  buildInjection,
  estimateTokens,
} from "../memory-core.mjs";

const D = "2026-08-01";

// --- ensureMemoryFile ---
test("ensureMemoryFile 创建目录/模板/历史目录，幂等", () => {
  const dir = fs.mkdtempSync("/tmp/memtest-");
  try {
    const f = ensureMemoryFile(dir);
    assert.ok(fs.existsSync(f));
    assert.ok(fs.existsSync(`${dir}/history`));
    assert.ok(fs.readFileSync(f, "utf8").includes("## 画像"));
    ensureMemoryFile(dir); // 二次调用不覆盖
    assert.ok(fs.readFileSync(f, "utf8").includes("## 画像"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- applyRemember ---
test("remember 追加/占位清理/事实带日期", () => {
  let { content } = applyRemember(TEMPLATE, { section: "profile", fact: "产品负责人" }, D);
  let sec = parseSections(content);
  assert.deepEqual(sec.profile, ["- 产品负责人"]); // 占位行被清掉
  ({ content } = applyRemember(content, { section: "facts", fact: "平台名为 PowerI" }, D));
  sec = parseSections(content);
  assert.deepEqual(sec.facts, ["- [2026-08-01] 平台名为 PowerI"]);
});

test("remember 幂等：相同行不重复写入", () => {
  const once = applyRemember(TEMPLATE, { section: "preferences", fact: "不用 emoji" }, D);
  const twice = applyRemember(once.content, { section: "preferences", fact: "不用 emoji" }, D);
  assert.equal(twice.changed, false);
  assert.equal(twice.reason, "duplicate");
  assert.equal(parseSections(twice.content).preferences.length, 1);
});

test("remember replace=true 替换同内容旧行（忽略日期前缀）", () => {
  let { content } = applyRemember(TEMPLATE, { section: "facts", fact: "网关用 llsm" }, D);
  ({ content } = applyRemember(content, { section: "facts", fact: "网关用 llsm", replace: true }, "2026-08-02"));
  const facts = parseSections(content).facts;
  assert.equal(facts.length, 1);
  assert.ok(facts[0].includes("2026-08-02")); // 日期更新为最近一次
});

test("remember 未知 section / 空 fact 拒绝", () => {
  assert.equal(applyRemember(TEMPLATE, { section: "hack", fact: "x" }, D).changed, false);
  assert.equal(applyRemember(TEMPLATE, { section: "profile", fact: "  " }, D).changed, false);
});

// --- truncateInjection ---
test("预算内全文注入，超预算保留画像+最近条目且结构完整", () => {
  let content = TEMPLATE;
  for (let i = 1; i <= 20; i++) ({ content } = applyRemember(content, { section: "facts", fact: `事实 ${i}` }, D));
  for (let i = 1; i <= 10; i++) ({ content } = applyRemember(content, { section: "preferences", fact: `偏好 ${i}` }, D));

  const fullLen = content.length;
  assert.equal(truncateInjection(content, fullLen * 10), content); // 预算充足 → 全文

  const small = truncateInjection(content, 120);
  assert.ok(small.length <= 120);
  const sec = parseSections(small);
  assert.equal(sec.profile.length, 0); // 画像（空）保留
  assert.ok(sec.facts.length < 20 && sec.facts.length >= 1); // 裁掉旧条目、保留最近
  assert.ok(sec.facts.every((l) => /事实 \d+/.test(l)));
  assert.ok(small.startsWith("# User Memory")); // 结构完整
});

test("超小预算兜底：只留画像节", () => {
  let content = TEMPLATE;
  ({ content } = applyRemember(content, { section: "profile", fact: "P" }, D));
  const out = truncateInjection(content, 10);
  assert.ok(parseSections(out).profile.length >= 1);
  assert.equal(parseSections(out).facts.length, 0);
});

// --- buildInjection ---
test("注入块含记忆+使用规则；空记忆有占位", () => {
  const b = buildInjection("mem", false);
  assert.ok(b.includes("## User Memory"));
  assert.ok(b.includes("## 记忆使用规则"));
  assert.ok(b.includes("remember"));
  assert.ok(buildInjection("", true).includes("暂无记忆内容"));
});

test("estimateTokens 粗略换算", () => {
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens(""), 0);
});

test("remember replace 覆盖（facts 新日期）暴露 replaced；applyRecover 恢复旧版本且防重复", () => {
  // r1：facts 追加（无旧行可覆盖）
  const r1 = applyRemember(TEMPLATE, { section: "facts", fact: "完成了 A 模块", replace: true }, "2026-08-01");
  assert.equal(r1.changed, true);
  assert.equal(r1.replaced, undefined);

  // r2：同事实新日期 replace → 覆盖旧版本，暴露 replaced
  const r2 = applyRemember(r1.content, { section: "facts", fact: "完成了 A 模块", replace: true }, "2026-08-02");
  assert.equal(r2.changed, true);
  assert.ok(r2.replaced, "覆盖发生时应有 replaced");
  assert.equal(r2.replaced.section, "facts");
  assert.equal(r2.replaced.oldLine, "- [2026-08-01] 完成了 A 模块"); // 文件中的行（带 - 与日期）
  assert.equal(r2.replaced.newLine, "[2026-08-02] 完成了 A 模块"); // 工具入参原始行（无前缀）
  assert.ok(!r2.content.includes("[2026-08-01]"), "旧版本行已被替换移除");

  // 恢复：旧版本加回，与新版本并存
  const rec = applyRecover(r2.content, { section: "facts", oldLine: r2.replaced.oldLine });
  assert.equal(rec.changed, true);
  assert.ok(rec.content.includes("- [2026-08-01] 完成了 A 模块"));
  assert.ok(rec.content.includes("- [2026-08-02] 完成了 A 模块"));
  // 重复恢复被拒
  const again = applyRecover(rec.content, { section: "facts", oldLine: r2.replaced.oldLine });
  assert.equal(again.changed, false);
  assert.equal(again.reason, "already present");
  // 非法 section / 空 oldLine 拒绝
  assert.equal(applyRecover(r2.content, { section: "nope", oldLine: "x" }).changed, false);
  assert.equal(applyRecover(r2.content, { section: "facts", oldLine: "  " }).changed, false);
});

