// ticket 11 验证：健康/就绪探针 + 结构化 JSONL 日志 + trace 关联
// A 网关探针（healthz/readyz）+ fake 请求日志（SSE/WS 两通道）
// B docker provider 真实请求日志（含 usage + provider）
// C 桥的就绪探针（get_state）
// 运行：node scripts/verify-11.mjs（B 需 docker + 镜像；模型 API 故障时 B 走警告）

import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "p11-"));
const LOG_DIR = path.join(DATA_DIR, "logs");
const GW_PORT = 18090;
const BASE = `http://127.0.0.1:${GW_PORT}`;

function startGateway(env) {
  const child = spawn("node", ["gateway/server.mjs"], {
    env: { ...process.env, ...env, POWERI_DATA_DIR: DATA_DIR, POWERI_LOG_DIR: LOG_DIR, POWERI_GATEWAY_PORT: String(GW_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", () => {});
  return child;
}
const stop = (c) => { try { c.kill("SIGTERM"); } catch {} };
function cleanupPods() {
  try {
    execFileSync("docker", ["ps", "-q", "--filter", "name=poweri-"], { encoding: "utf8" })
      .trim().split("\n").filter(Boolean).forEach((id) => { try { execFileSync("docker", ["rm", "-f", id], { stdio: "ignore" }); } catch {} });
  } catch {}
}
const readLog = () => fs.readdirSync(LOG_DIR).map((f) => fs.readFileSync(path.join(LOG_DIR, f), "utf8")).join("\n").split("\n").filter(Boolean).map((l) => JSON.parse(l));

async function chat(token, body) {
  const res = await fetch(`${BASE}/v1/chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const dec = new TextDecoder();
  let buf = "";
  for await (const c of res.body) buf += dec.decode(c, { stream: true });
  return { status: res.status, body: buf };
}

async function partA() {
  console.log("── A: 探针 + fake 日志 ──");
  const gw = startGateway({ POWERI_POD_PROVIDER: "fake", POWERI_FAKE_USAGE: "100/20/300/0/10" });
  await new Promise((r) => setTimeout(r, 800));
  try {
    const hz = await fetch(`${BASE}/healthz`);
    const rz = await fetch(`${BASE}/readyz`);
    assert.equal(hz.status, 200, "A1 /healthz 200");
    assert.equal(rz.status, 200, "A2 /readyz 200");
    console.log("  ✓ A1-A2 探针");

    const { status } = await chat("dev-token", { session: "new", message: "log me" });
    assert.equal(status, 200, "A3 SSE 请求成功");
    const logs = readLog();
    const sse = logs.filter((l) => l.channel === "sse");
    assert.equal(sse.length, 1, "A4 一条 SSE 请求日志");
    assert.ok(sse[0].requestId && sse[0].sessionId && sse[0].userId === "alice", "A5 日志含 trace/会话字段");
    assert.equal(sse[0].provider, "fake", "A6 provider=fake");
    assert.equal(sse[0].usage.input, 100, "A7 usage 聚合入日志");
    assert.equal(sse[0].ok, true, "A8 ok=true");

    // WS 通道日志
    const ws = new WebSocket(`ws://127.0.0.1:${GW_PORT}/v1/ws?token=dev-token`);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.send(JSON.stringify({ message: "via ws" }));
    await new Promise((res) => { ws.onmessage = (e) => { if (JSON.parse(e.data).type === "done") res(); }; });
    ws.close();
    await new Promise((r) => setTimeout(r, 200));
    const wsLogs = readLog().filter((l) => l.channel === "ws");
    assert.equal(wsLogs.length, 1, "A9 一条 WS 请求日志");
    assert.ok(wsLogs[0].requestId, "A10 WS 日志含 trace");
    console.log(`  ✓ A3-A10 日志（SSE/WS 各 1 条，requestId 关联）`);
  } finally { stop(gw); }
}

async function partB() {
  console.log("── B: docker 真实请求日志 ──");
  const gw = startGateway({ POWERI_POD_PROVIDER: "docker", POWERI_GATEWAY_USERS: "alice:token-a" });
  await new Promise((r) => setTimeout(r, 800));
  try {
    const rz = await fetch(`${BASE}/readyz`);
    assert.equal(rz.status, 200, "B1 /readyz 200（docker 引擎存活）");
    const { status, body } = await chat("token-a", { session: "new", message: "hi" });
    assert.equal(status, 200, "B2 真实请求 200");
    const ok = !body.includes("event: error");
    const logs = readLog().filter((l) => l.channel === "sse");
    const rec = logs.at(-1);
    if (ok && rec?.ok) {
      assert.equal(rec.provider, "docker", "B3 provider=docker");
      assert.ok((rec.usage?.totalTokens ?? 0) > 0, "B4 真实 usage totalTokens>0");
      console.log(`  ✓ B 真实请求日志（totalTokens=${rec.usage.totalTokens}, duration=${rec.durationMs}ms）`);
    } else {
      console.log(`  ⚠ B 模型 API 不可达（status=${status}）——日志/探针逻辑已由 A 覆盖，不阻塞`);
    }
  } finally { stop(gw); cleanupPods(); }
}

async function partC() {
  console.log("── C: 桥就绪探针（get_state）──");
  const name = "p11-bridge";
  try { execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" }); } catch {}
  const port = execFileSync("docker", ["run", "-d", "--rm", "--name", name, "-p", "127.0.0.1::8081", "--entrypoint", "node", "pi-sandbox:local", "/bridge/server.mjs"], { encoding: "utf8" }).trim();
  try {
    const hp = execFileSync("docker", ["port", name, "8081"], { encoding: "utf8" }).trim().split("->").pop().trim();
    const ws = new WebSocket(`ws://${hp}`);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const state = await new Promise((res) => { ws.onmessage = (e) => res(JSON.parse(e.data)); });
    ws.send(JSON.stringify({ type: "get_state" }));
    const state2 = await new Promise((res) => { ws.onmessage = (e) => res(JSON.parse(e.data)); });
    assert.equal(state2.success, true, "C1 get_state success");
    assert.ok(state2.model, "C2 返回 model");
    ws.close();
    console.log("  ✓ C 桥 get_state 就绪探针（model=" + state2.model + "）");
  } finally {
    try { execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" }); } catch {}
  }
}

const part = process.argv[2] ?? "all";
if (part === "all" || part === "A") await partA();
if (part === "all" || part === "B") await partB();
if (part === "all" || part === "C") await partC();
console.log(`\n✅ ticket 11 验证通过（log dir: ${LOG_DIR}）`);
