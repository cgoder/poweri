// 计量与定价单元测试：node --test gateway/test/
// 覆盖：computeCost 精确性 / 价目文件合并 / periodKey / 落账-聚合-幂等-审计
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "p09-unit-"));
process.env.POWERI_DATA_DIR = dataDir;

test("定价：computeCost 按价目精确计算", async () => {
  const { computeCost, DEFAULT_PRICES } = await import("../pricing.mjs");
  // input 2000×0.25/M + output 400×1/M + cacheRead 6000×0.05/M + reasoning 200×0.25/M
  const c = computeCost(
    { input: 2000, output: 400, cacheRead: 6000, cacheWrite: 0, reasoning: 200 },
    { bandwidthBytes: 0 },
    DEFAULT_PRICES,
  );
  assert.ok(Math.abs(c - 0.00125) < 1e-9, `期望 0.00125，实际 ${c}`);
  assert.equal(computeCost(null, null, DEFAULT_PRICES), 0, "无用量应 0");
  const b = computeCost(null, { bandwidthBytes: 1024 ** 3 }, DEFAULT_PRICES);
  assert.ok(Math.abs(b - 0.09) < 1e-9, `1GB 出站应 0.09，实际 ${b}`);
});

test("定价：自定义价目文件合并覆盖默认", async () => {
  const priceFile = path.join(dataDir, "prices.json");
  writeFileSync(priceFile, JSON.stringify({ output: 3 / 1_000_000 }));
  process.env.POWERI_PRICES_FILE = priceFile;
  const { loadPrices, computeCost } = await import("../pricing.mjs");
  const p = loadPrices();
  assert.equal(p.output, 3 / 1_000_000, "应覆盖 output");
  assert.equal(p.input, 0.25 / 1_000_000, "未覆盖项应保留默认");
  const c = computeCost({ output: 1_000_000 }, null, p);
  assert.ok(Math.abs(c - 3) < 1e-9, `1M output @3/M 应 3，实际 ${c}`);
  delete process.env.POWERI_PRICES_FILE;
});

test("periodKey：月/日格式正确", async () => {
  const { periodKey } = await import("../metering.mjs");
  assert.equal(periodKey(new Date(2026, 7, 15), "month"), "2026-08");
  assert.equal(periodKey(new Date(2026, 7, 15), "day"), "2026-08-15");
  assert.equal(periodKey(new Date(2026, 11, 31), "day"), "2026-12-31");
});

test("计量+账单：落账、聚合、审计、幂等、跨用户隔离", async () => {
  const { appendUsage, invoiceFor, scanUsage } = await import("../metering.mjs");
  const tsAug = new Date(2026, 7, 10).getTime();
  const rec = (id, u) => ({ ts: tsAug, requestId: id, sessionId: "s1", ok: true, usage: u, platform: { durationMs: 100, bandwidthBytes: 500 } });
  const u1 = { input: 1000, output: 200, cacheRead: 3000, cacheWrite: 0, reasoning: 100, totalTokens: 1200 };
  appendUsage("alice", rec("r1", u1));
  appendUsage("alice", rec("r2", u1));
  appendUsage("bob", rec("r3", u1));
  appendUsage("alice", { ...rec("r4", u1), ts: new Date(2026, 8, 1).getTime() }); // 9 月

  // 审计查询：8 月应只含 2 条
  const { records, corrupt } = scanUsage("alice", new Date(2026, 7, 1).getTime(), new Date(2026, 7, 31, 23, 59, 59, 999).getTime());
  assert.equal(records.length, 2, "8 月应 2 条");
  assert.equal(corrupt, 0);

  // 每请求成本 0.000625 → alice 8 月 total 0.00125
  const a = await invoiceFor("alice", "2026-08");
  assert.equal(a.reused, false);
  assert.ok(Math.abs(a.invoice.total - 0.00125) < 1e-9, `alice 8 月 total ${a.invoice.total}`);
  assert.equal(a.invoice.requests, 2);
  assert.equal(a.invoice.records.length, 2);
  assert.equal(a.invoice.corruptLines, 0);
  const item = Object.fromEntries(a.invoice.items.map((i) => [i.kind, i.quantity]));
  assert.equal(item.input, 2000);
  assert.equal(item.output, 400);

  // 幂等：重复生成同一账单 reused，金额不变
  const a2 = await invoiceFor("alice", "2026-08");
  assert.equal(a2.reused, true);
  assert.equal(a2.invoice.total, a.invoice.total);
  assert.equal(a2.invoice.records.length, 2, "不重复计费");

  // 并发生成同一账单：withLock 串行化 → 恰好一个 first
  const [x, y] = await Promise.all([invoiceFor("bob", "2026-08"), invoiceFor("bob", "2026-08")]);
  assert.equal(x.reused || y.reused, true, "并发生成应只有一个首次");

  // 跨用户：bob 账单只含 bob 记录
  const b = await invoiceFor("bob", "2026-08");
  assert.equal(b.invoice.requests, 1);

  // 9 月只含 r4
  const sep = await invoiceFor("alice", "2026-09");
  assert.equal(sep.invoice.requests, 1);
  assert.ok(Math.abs(sep.invoice.total - 0.000625) < 1e-9);

  // 按日账单
  const day = await invoiceFor("alice", "2026-08-10");
  assert.equal(day.invoice.requests, 2);
});
