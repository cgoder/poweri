// scripts/verify-05.mjs — ticket 05 并发控制集成验证（断言失败即非零退出）
//
// Part 1（fake provider + 固定延迟，时序断言）：
//   - 同会话 3 并发 → 串行：总时长 ≥ 3×delay
//   - 跨会话 3 并发 → 并行：总时长 < 2×delay
// Part 2（docker provider + 真实 pi）：
//   - 同会话 3 并发 → 全部成功；会话 JSONL 完整（每行可解析）、3 条用户消息、
//     3 个回复 token 齐全（alpha/bravo/charlie）→ 不损坏、不丢失
//   - 跨会话 2 并发 → 全部成功（不同容器并行）
//
// 用法：node scripts/verify-05.mjs
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const ROOT = path.join(import.meta.dirname, "..");
const PORT = 18080;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startGateway(extraEnv) {
  return spawn("node", ["gateway/server.mjs"], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      POWERI_GATEWAY_PORT: String(PORT),
      POWERI_GATEWAY_USERS: "alice:tok-alice;bob:tok-bob",
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
  const t0 = Date.now();
  const res = await fetch(`${BASE}/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 200, `HTTP ${res.status}`);
  const text = await res.text();
  return { ms: Date.now() - t0, text };
}

function stop(gw) { return new Promise((r) => { gw.once("exit", r); gw.kill(); }); }

function assertDone(text, label) {
  assert.ok(text.includes("event: done"), `${label}: 应有 done 事件`);
  assert.ok(!text.includes('"type":"error"') && !text.includes("event: error"), `${label}: 不应有错误事件`);
}

function cleanupPods() {
  try {
    execFileSync("docker", ["ps", "-q", "--filter", "name=poweri-"], { encoding: "utf8" })
      .trim().split("\n").filter(Boolean).forEach((id) => {
        try { execFileSync("docker", ["rm", "-f", id], { stdio: "ignore" }); } catch {}
      });
  } catch {}
}

// ══════════ Part 1: fake provider 时序验证 ══════════
{
  const gw = startGateway({ POWERI_POD_PROVIDER: "fake", POWERI_FAKE_DELAY_MS: "400", POWERI_DATA_DIR: mkdtempSync(path.join(os.tmpdir(), "p05-fake-")) });
  await waitHealth(gw);
  try {
    const t0 = Date.now();
    const same = await Promise.all([
      chat("tok-alice", { session: "s-timing", message: "a" }),
      chat("tok-alice", { session: "s-timing", message: "b" }),
      chat("tok-alice", { session: "s-timing", message: "c" }),
    ]);
    const sameMs = Date.now() - t0;
    assert.ok(sameMs >= 3 * 400 - 200, `同会话应串行（≥3×delay≈1200ms），实测 ${sameMs}ms`);
    same.forEach((r) => assertDone(r.text, "同会话并发请求"));

    const t1 = Date.now();
    const diff = await Promise.all([
      chat("tok-alice", { session: "s1", message: "a" }),
      chat("tok-alice", { session: "s2", message: "b" }),
      chat("tok-bob", { session: "s3", message: "c" }),
    ]);
    const diffMs = Date.now() - t1;
    assert.ok(diffMs < 2 * 400 + 200, `跨会话应并行（≈400ms），实测 ${diffMs}ms`);
    diff.forEach((r) => assertDone(r.text, "跨会话并发请求"));

    console.log(`✓ Part1 fake: 同会话 3 并发 ${sameMs}ms（串行≈1200ms）| 跨会话 3 并发 ${diffMs}ms（并行≈400ms）`);
  } finally { await stop(gw); }
}

// ══════════ Part 2: docker provider + 真实 pi ══════════
{
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "p05-real-"));
  const gw = startGateway({ POWERI_POD_PROVIDER: "docker", POWERI_DATA_DIR: dataDir, POWERI_AI_MODEL: "agent" });
  await waitHealth(gw);
  try {
    const SID = "p05-race";
    const t0 = Date.now();
    const same = await Promise.all([
      chat("tok-alice", { session: SID, message: "Reply with exactly: alpha" }),
      chat("tok-alice", { session: SID, message: "Reply with exactly: bravo" }),
      chat("tok-alice", { session: SID, message: "Reply with exactly: charlie" }),
    ]);
    const sameMs = Date.now() - t0;
    same.forEach((r) => assertDone(r.text, "真实 pi 同会话并发"));

    const diff = await Promise.all([
      chat("tok-alice", { session: "p05-a", message: "Reply with exactly: delta" }),
      chat("tok-bob", { session: "p05-b", message: "Reply with exactly: echo" }),
    ]);
    diff.forEach((r) => assertDone(r.text, "真实 pi 跨会话并发"));

    // ── 会话 JSONL 完整性：不损坏、不丢失 ──
    const sessionFile = path.join(dataDir, "users", "alice", ".pi", "agent", "sessions", `${SID}.jsonl`);
    const lines = readFileSync(sessionFile, "utf8").split("\n").filter((l) => l.trim());
    assert.ok(lines.length > 0, "会话文件非空");
    let users = 0, assistants = 0, assistantText = "";
    for (const [i, l] of lines.entries()) {
      let o;
      try { o = JSON.parse(l); } catch { throw new Error(`JSONL 第 ${i + 1} 行损坏: ${l.slice(0, 120)}`); }
      if (o?.type === "message" && o.message?.role === "assistant") {
        assistants++;
        assistantText += (o.message.content ?? []).map((c) => c.text ?? "").join("") + "\n";
      }
      if (o?.type === "message" && o.message?.role === "user") users++;
    }
    assert.ok(users >= 3, `同会话 3 并发后应 ≥3 条用户消息（无丢失），实际 ${users}`);
    assert.ok(assistants >= 3, `至少 3 条 assistant 回复，实际 ${assistants}`);
    for (const tok of ["alpha", "bravo", "charlie"]) {
      assert.ok(assistantText.includes(tok), `回复中应包含 ${tok}（无丢失）`);
    }
    console.log(`✓ Part2 真实pi: 同会话 3 并发 ${sameMs}ms 串行完成 | JSONL ${lines.length} 行全部可解析，${users} 用户消息 + ${assistants} assistant 回复，alpha/bravo/charlie 齐全`);
  } finally {
    await stop(gw);
    cleanupPods();
  }
}

console.log("✅ 全部断言通过：会话内串行 / 跨会话并行 / JSONL 不损坏不丢失");
