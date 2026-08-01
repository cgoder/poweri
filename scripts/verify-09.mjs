// scripts/verify-09.mjs — ticket 09 计量 + 账单集成验证（断言失败即非零退出）
//
// Part A（fake + 确定性 usage + 自定义价目，数学精确断言）：
//   - 每请求 usage 注入 1000/200/3000/0/100，价目全 $1/M
//   - alice 2 请求 → 账单 total = 2×0.0043 = 0.0086（精确），明细项 input=2000/output=400...
//   - 重复/并发出账幂等（reused），bob 账单独立隔离
//   - 无 admin token → 401；GET usage 审计查询
// Part B（docker + 真实 pi）：真实请求计量 totalTokens>0、账单 total>0、每用户 1 条
//
// 用法：node scripts/verify-09.mjs
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { periodKey } from "../gateway/metering.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const PORT = 18081;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = "admin-tok";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MONTH = periodKey();

function startGateway(extraEnv) {
  return spawn("node", ["gateway/server.mjs"], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      POWERI_GATEWAY_PORT: String(PORT),
      POWERI_GATEWAY_USERS: "alice:tok-alice;bob:tok-bob",
      POWERI_GATEWAY_ADMIN_TOKEN: ADMIN,
      ...extraEnv,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
}

async function waitHealth(gw) {
  for (let i = 0; i < 80; i++) {
    if (gw.exitCode !== null) throw new Error("gateway 提前退出");
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch {}
    await sleep(250);
  }
  throw new Error("gateway 未就绪");
}

async function chat(token, body) {
  const res = await fetch(`${BASE}/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 200, `chat HTTP ${res.status}`);
  const text = await res.text();
  assert.ok(text.includes("event: done") && !text.includes("event: error"), "chat 应成功完成");
  return text;
}

async function invoicePost(userId, period) {
  const res = await fetch(`${BASE}/v1/admin/invoice`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADMIN}` },
    body: JSON.stringify({ userId, period }),
  });
  assert.equal(res.status, 200, `invoice HTTP ${res.status}`);
  return res.json();
}

function stop(gw) { return new Promise((r) => { gw.once("exit", r); gw.kill(); }); }

function cleanupPods() {
  try {
    execFileSync("docker", ["ps", "-q", "--filter", "name=poweri-"], { encoding: "utf8" })
      .trim().split("\n").filter(Boolean).forEach((id) => {
        try { execFileSync("docker", ["rm", "-f", id], { stdio: "ignore" }); } catch {}
      });
  } catch {}
}

// ══════════ Part A: fake + 确定性用量 + 自定义价目 ══════════
{
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "p09-fake-"));
  const priceFile = path.join(dataDir, "prices.json");
  writeFileSync(priceFile, JSON.stringify({ input: 1e-6, output: 1e-6, cacheRead: 1e-6, cacheWrite: 1e-6, reasoning: 1e-6, bandwidth: 0 }));
  const gw = startGateway({
    POWERI_POD_PROVIDER: "fake", POWERI_FAKE_USAGE: "1000/200/3000/0/100",
    POWERI_DATA_DIR: dataDir, POWERI_PRICES_FILE: priceFile,
  });
  await waitHealth(gw);
  try {
    await chat("tok-alice", { session: "s9", message: "a" });
    await chat("tok-alice", { session: "s9", message: "b" });
    await chat("tok-bob", { session: "s9b", message: "c" });

    // 审计查询
    const usageRes = await fetch(`${BASE}/v1/admin/usage?userId=alice`, { headers: { Authorization: `Bearer ${ADMIN}` } });
    assert.equal(usageRes.status, 200);
    const usage = await usageRes.json();
    assert.equal(usage.records.length, 2, "alice 明细账应 2 条");
    assert.equal(usage.corrupt, 0);
    for (const r of usage.records) {
      assert.equal(r.usage.input, 1000);
      assert.equal(r.usage.totalTokens, 1200);
      assert.equal(r.ok, true);
    }

    // 无 admin token → 401
    const n401 = await fetch(`${BASE}/v1/admin/invoice`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "alice", period: MONTH }),
    });
    assert.equal(n401.status, 401, "无 admin token 应 401");

    // 账单：alice = 2 请求 × (1000+200+3000+100)×1/M = 0.0043 → 0.0086
    const invA = await invoicePost("alice", MONTH);
    assert.equal(invA.reused, false);
    assert.ok(Math.abs(invA.total - 0.0086) < 1e-9, `alice total 期望 0.0086，实际 ${invA.total}`);
    assert.equal(invA.requests, 2);
    assert.equal(invA.records.length, 2);
    const q = Object.fromEntries(invA.items.map((i) => [i.kind, i.quantity]));
    assert.equal(q.input, 2000); assert.equal(q.output, 400); assert.equal(q.cacheRead, 6000); assert.equal(q.reasoning, 200);

    // 幂等：重复生成 → reused，金额不变
    const invA2 = await invoicePost("alice", MONTH);
    assert.equal(invA2.reused, true, "重复出账应幂等复用");
    assert.equal(invA2.total, invA.total);
    assert.equal(invA2.records.length, 2, "不重复计费");

    // 跨用户隔离：bob 1 请求 → 0.0043
    const invB = await invoicePost("bob", MONTH);
    assert.equal(invB.requests, 1);
    assert.ok(Math.abs(invB.total - 0.0043) < 1e-9, `bob total ${invB.total}`);

    console.log(`✓ PartA fake: alice ${invA.requests}请求=$0.0086(精确) | 幂等复用=${invA2.reused} | bob ${invB.requests}请求=$0.0043 | 明细 ${usage.records.length}条`);
  } finally { await stop(gw); }
}

// ══════════ Part B: docker + 真实 pi ══════════
{
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "p09-real-"));
  const gw = startGateway({ POWERI_POD_PROVIDER: "docker", POWERI_DATA_DIR: dataDir, POWERI_AI_MODEL: "agent" });
  await waitHealth(gw);
  try {
    await chat("tok-alice", { message: "Reply with exactly: meter-one" });
    await chat("tok-bob", { message: "Reply with exactly: meter-two" });

    const invA = await invoicePost("alice", MONTH);
    assert.equal(invA.requests, 1);
    assert.ok(invA.records[0].usage?.totalTokens > 0, `真实计量 totalTokens>0，实际 ${invA.records[0].usage?.totalTokens}`);
    assert.ok(invA.total > 0, "真实账单金额 > 0");
    assert.ok(invA.records[0].platform.durationMs > 0);

    const invB = await invoicePost("bob", MONTH);
    assert.equal(invB.requests, 1);
    assert.ok(invB.records[0].usage?.totalTokens > 0);

    console.log(`✓ PartB 真实pi: alice totalTokens=${invA.records[0].usage.totalTokens} $${invA.total} | bob totalTokens=${invB.records[0].usage.totalTokens} $${invB.total}`);
  } finally { await stop(gw); cleanupPods(); }
}

console.log("✅ 全部断言通过：RPC 事件+平台指标聚合 / 定价精确 / 幂等出账 / 按用户可审计");
