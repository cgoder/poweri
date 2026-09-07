/**
 * PowerI 产品层：使用统计聚合单测。
 *
 * 用临时目录造 .jsonl 会话归档（PI_CODING_AGENT_DIR 指向临时目录），验证：
 * - substring 字段提取（含 assistant 行内 escaped 假 usage 不误伤）；
 * - 按日聚合 totals / sessions / activeDays / streak / models / trend / heatmap；
 * - soft TTL 秒回（同一 aggregate 引用）+ force 刷新后 per-file 签名缓存失效。
 *
 * 运行：node --experimental-strip-types --test poweri/lib/usage-stats.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const usage = await jiti.import("./usage-stats.ts");

/** 模块级缓存跨测试残留会互相污染（key 为绝对路径，但 __piUsageCache 是全局单例）。 */
function resetServerCache() {
  delete globalThis.__piUsageCache;
  delete globalThis.__piUsageFileCache;
  delete globalThis.__piUsagePromise;
}

function makeSessionFile(dir, project, name, lines) {
  const projectDir = join(dir, "sessions", project);
  mkdirSync(projectDir, { recursive: true });
  const file = join(projectDir, name);
  writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

/** 生成一条会话归档行（结构对齐 pi session .jsonl）。 */
function msgLine({ ts, id, parentId, role, content, model, usage: usageObj }) {
  const line = {
    type: "message",
    id,
    parentId: parentId ?? null,
    timestamp: ts,
    message: {
      role,
      content: content ?? [{ type: "text", text: role === "user" ? "hi" : "ok" }],
      timestamp: Date.parse(ts),
      ...(model ? { model } : {}),
      ...(usageObj ? { usage: usageObj } : {}),
    },
  };
  return JSON.stringify(line);
}

test("getAggregate + summarizeUsage: 按日聚合与响应结构", async () => {
  const dir = mkdtempSync(join(tmpdir(), "poweri-usage-"));
  try {
    process.env.PI_CODING_AGENT_DIR = dir;
    resetServerCache();

    const now = Date.now();
    const todayKey = usage.dateKey(now);
    const yesterdayKey = usage.shiftKey(todayKey, -1);
    const day3Key = usage.shiftKey(todayKey, -3);
    const ts = (key, time) => `${key}T${time}`;

    // sess-1：今天 2 条 assistant（model-a 1000 / 750，其中一条 content 内嵌
    // escaped 假 usage 不应被计入）+ 昨天 model-b 500 + 3 天前 model-a 250。
    makeSessionFile(dir, "proj-a", "sess-1.jsonl", [
      JSON.stringify({ type: "session", id: "sess-1", timestamp: ts(todayKey, "09:00"), cwd: "/tmp/x" }),
      msgLine({ ts: ts(todayKey, "09:00"), id: "m1", role: "user" }),
      msgLine({
        ts: ts(todayKey, "09:00:05"), id: "m2", parentId: "m1", role: "assistant",
        model: "model-a", usage: { input: 100, output: 900, totalTokens: 1000 },
      }),
      msgLine({
        ts: ts(todayKey, "09:00:10"), id: "m3", parentId: "m1", role: "assistant",
        content: [{ type: "text", text: "thinking \"usage\":{\"totalTokens\":9999999} done" }],
        model: "model-a", usage: { input: 50, output: 700, totalTokens: 750 },
      }),
      msgLine({ ts: ts(yesterdayKey, "18:00"), id: "m4", role: "user" }),
      msgLine({
        ts: ts(yesterdayKey, "18:00:05"), id: "m5", parentId: "m4", role: "assistant",
        model: "model-b", usage: { input: 100, output: 400, totalTokens: 500 },
      }),
      // tool 消息不计入 messages / tokens
      JSON.stringify({
        type: "message", id: "m9", parentId: "m2", timestamp: ts(todayKey, "09:01"),
        message: { role: "tool", toolName: "bash", content: "out" },
      }),
      // 非 message 行（session_info）应被跳过
      JSON.stringify({ type: "session_info", id: "i1", name: "x", timestamp: ts(todayKey, "09:02") }),
      msgLine({
        ts: ts(day3Key, "10:00"), id: "m6", role: "assistant",
        model: "model-a", usage: { input: 50, output: 200, totalTokens: 250 },
      }),
    ]);

    // sess-2：今天 assistant model-b 300 + user（无独立 user 前置也算消息数）。
    makeSessionFile(dir, "proj-b", "sess-2.jsonl", [
      JSON.stringify({ type: "session", id: "sess-2", timestamp: ts(todayKey, "11:00"), cwd: "/tmp/y" }),
      msgLine({
        ts: ts(todayKey, "11:00"), id: "s2m1", role: "assistant",
        model: "model-b", usage: { input: 100, output: 200, totalTokens: 300 },
      }),
      msgLine({ ts: ts(todayKey, "11:01"), id: "s2m2", parentId: "s2m1", role: "user" }),
    ]);

    // 无 header 的归档应被跳过（SessionManager.listAll 同口径）。
    makeSessionFile(dir, "proj-a", "no-header.jsonl", [
      msgLine({ ts: ts(todayKey, "12:00"), id: "nh1", role: "user" }),
    ]);

    const agg = await usage.getAggregate(false);
    const summary = usage.summarizeUsage(agg, 7, now);

    // totals
    assert.equal(summary.totals.tokens, 1000 + 750 + 500 + 250 + 300, "tokens 汇总");
    assert.equal(summary.totals.messages, 3 + 2 + 1 + 2, "messages（user+assistant，tool 不计）");
    assert.equal(summary.totals.sessions, 2, "范围内去重 session 数（no-header 跳过）");
    assert.equal(summary.totals.activeDays, 3, "活跃天数（今天/昨天/3天前）");

    // streak：今天+昨天活跃，前天断 → 2
    assert.equal(summary.streak, 2, "连续活跃天数");

    // models：model-a = 1000+750+250 = 2000，model-b = 500+300 = 800
    assert.equal(summary.models.length, 2);
    assert.equal(summary.models[0].id, "model-a");
    assert.equal(summary.models[0].tokens, 2000);
    assert.ok(Math.abs(summary.models[0].share - 2000 / 2800) < 1e-9, "share 占比");
    assert.equal(summary.topModel?.id, "model-a");
    assert.equal(summary.models[1].id, "model-b");

    // range / trend：7 天零填充，今天 tokens = 1750 + 300
    assert.equal(summary.range.days, 7);
    assert.equal(summary.range.startDate, usage.shiftKey(todayKey, -6));
    assert.equal(summary.trend.length, 7);
    assert.equal(summary.trend[6].date, todayKey);
    assert.equal(summary.trend[6].tokens, 1750 + 300);
    assert.equal(summary.trend[5].tokens, 500);
    assert.equal(summary.trend[3].tokens, 250);
    assert.equal(summary.trend[0].tokens, 0, "范围外日期零填充");

    // heatmap：固定 182 天，消息数按日
    assert.equal(summary.heatmap.length, 182);
    assert.equal(summary.heatmap[181].date, todayKey);
    assert.equal(summary.heatmap[181].messages, 5, "今天消息数（3+2）");
    assert.equal(summary.heatmap[180].messages, 2);
    assert.equal(summary.heatmap[178].messages, 1);
  } finally {
    delete process.env.PI_CODING_AGENT_DIR;
    resetServerCache();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("缓存：soft TTL 秒回同一引用，force 刷新感知文件变更", async () => {
  const dir = mkdtempSync(join(tmpdir(), "poweri-usage-cache-"));
  try {
    process.env.PI_CODING_AGENT_DIR = dir;
    resetServerCache();

    const now = Date.now();
    const todayKey = usage.dateKey(now);
    const ts = `${todayKey}T09:00:00`;

    makeSessionFile(dir, "proj-a", "sess-1.jsonl", [
      JSON.stringify({ type: "session", id: "sess-1", timestamp: ts, cwd: "/tmp/x" }),
      msgLine({ ts, id: "m1", role: "user" }),
      msgLine({ ts, id: "m2", parentId: "m1", role: "assistant", model: "model-a", usage: { totalTokens: 100 } }),
    ]);

    const first = await usage.getAggregate(false);
    const second = await usage.getAggregate(false);
    assert.equal(second, first, "soft TTL 内直接返回同一 aggregate 引用（不重 stat）");

    // 追加一行后 force 刷新 → 必须感知变更
    const file = join(dir, "sessions", "proj-a", "sess-1.jsonl");
    const extra = msgLine({ ts: `${todayKey}T09:01:00`, id: "m3", parentId: "m2", role: "assistant", model: "model-a", usage: { totalTokens: 50 } });
    writeFileSync(file, readFileSync(file, "utf8") + "\n" + extra + "\n");

    const refreshed = await usage.getAggregate(true);
    assert.notEqual(refreshed, first, "force 刷新应重建 aggregate");
    const summary = usage.summarizeUsage(refreshed, 7, now);
    assert.equal(summary.totals.tokens, 150, "force 后新行被计入");

    // 删除整个归档 → 该 session 从聚合中消失
    rmSync(join(dir, "sessions", "proj-a"), { recursive: true, force: true });
    const afterDelete = await usage.getAggregate(true);
    const s2 = usage.summarizeUsage(afterDelete, 7, now);
    assert.equal(s2.totals.tokens, 0, "归档删除后缓存项同步清理");
    assert.equal(s2.totals.sessions, 0);
  } finally {
    delete process.env.PI_CODING_AGENT_DIR;
    resetServerCache();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Gateway 计量统计不读取宿主 session：按用户记录聚合", async () => {
  const now = Date.parse("2026-08-16T12:00:00");
  const today = usage.dateKey(now);
  const yesterday = usage.shiftKey(today, -1);
  const records = [
    { ts: Date.parse(`${today}T09:00:00`), sessionId: "msb-a", usage: { input: 100, output: 900, totalTokens: 1000 } },
    { ts: Date.parse(`${today}T09:01:00`), sessionId: "msb-a", usage: { input: 50, output: 450, totalTokens: 500 } },
    { ts: Date.parse(`${yesterday}T18:00:00`), sessionId: "msb-b", usage: { input: 20, output: 80, totalTokens: 100 } },
  ];
  const summary = usage.summarizeGatewayUsage(records, 7, now);
  assert.equal(summary.totals.tokens, 1600);
  assert.equal(summary.totals.sessions, 2);
  assert.equal(summary.totals.messages, 3);
  assert.equal(summary.topModel?.id, "poweri-gw/agent");
  assert.equal(summary.heatmap.at(-1).messages, 2);
  assert.deepEqual(usage.summarizeGatewayBySession(records), [
    { sessionId: "msb-a", messages: 2, tokens: 1500, input: 150, cacheRead: 0, cacheWrite: 0, cost: 0 },
    { sessionId: "msb-b", messages: 1, tokens: 100, input: 20, cacheRead: 0, cacheWrite: 0, cost: 0 },
  ]);
});

test("substring 提取与日期工具", () => {
  const line = '{"type":"message","timestamp":"2026-08-16T09:00:05","message":{"role":"assistant","model":"model-a","usage":{"input":100,"output":900,"totalTokens":1000}}}';
  assert.equal(usage.sliceStringField(line, "timestamp", 0), "2026-08-16T09:00:05");
  const usageIdx = line.indexOf('"usage":{');
  assert.equal(usage.sliceNumberField(line, "totalTokens", usageIdx), 1000);
  assert.equal(usage.sliceNumberField(line, "nonexistent", usageIdx), 0);
  assert.equal(
    usage.sliceNumberField(line, "totalTokens", 0),
    1000,
    "从 0 开始也能找到 usage 内的字段（本行无前置干扰文本）",
  );

  assert.equal(usage.dateKey(Date.parse("2026-08-16T09:00:05")), "2026-08-16");
  assert.equal(usage.shiftKey("2026-08-16", 1), "2026-08-17");
  assert.equal(usage.shiftKey("2026-08-16", -1), "2026-08-15");
  assert.equal(usage.shiftKey("2026-03-01", -1), "2026-02-28", "跨月");
});
