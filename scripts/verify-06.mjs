// ticket 06 集成验证：流式转发 + 长/短连接 + abort + 断线重连历史补发
// Part A（fake 主测试缝）：WS 长连接多轮 / abort 提前中断 / busy 拒绝
// Part B（docker + 真实 pi）：WS 一轮 + 历史接口补发 + 重连续接
// 运行：node scripts/verify-06.mjs（需 docker + pi-sandbox:local 镜像 + 已配置的 AI 网关）

import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "p06-"));
const GW_PORT = 18087;
const GATEWAY = `http://127.0.0.1:${GW_PORT}`;

function startGateway(env) {
  const child = spawn("node", ["gateway/server.mjs"], { env: { ...process.env, ...env, POWERI_DATA_DIR: DATA_DIR, POWERI_GATEWAY_PORT: String(GW_PORT) }, stdio: ["ignore", "pipe", "pipe"] });
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

function wsConnect(url, token) {
  const ws = new WebSocket(`${url}?token=${token}`);
  const queue = [];
  let onMsg = null, closed = false;
  ws.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (onMsg) { const cb = onMsg; onMsg = null; cb(ev); } else queue.push(ev);
  };
  ws.onerror = () => {};
  const next = () => new Promise((res) => {
    if (queue.length) res(queue.shift());
    else if (closed) res(null);
    else onMsg = res;
  });
  ws.onclose = () => { closed = true; if (onMsg) { const cb = onMsg; onMsg = null; cb(null); } };
  const open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return { ws, open, next, send: (o) => ws.send(JSON.stringify(o)), close: () => ws.close() };
}

const textOf = (ev) => (ev.message?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");

async function runChatOnce(url, token, body) {
  const res = await fetch(`${url}/v1/chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const events = [];
  let buf = "";
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true }); // 注意：chunk.toString() 是数字串，必须 TextDecoder
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      const m = line.match(/^data: (.+)$/);
      if (m) { try { events.push(JSON.parse(m[1])); } catch {} }
    }
  }
  return { status: res.status, events };
}

async function partA() {
  console.log("── Part A: WS 长连接（fake）──");
  const gw = startGateway({ POWERI_POD_PROVIDER: "fake", POWERI_FAKE_DELAY_MS: "300" });
  await new Promise((r) => setTimeout(r, 800));
  try {
    // A1: 未认证连接被拒（仅 server 拒绝才算 4001；连接失败是 1006/-1）
    const bad = new WebSocket(`ws://127.0.0.1:${GW_PORT}/v1/ws`);
    const code = await new Promise((res) => {
      bad.onclose = (e) => res(e.code);
      bad.onerror = () => res(-1); // 连接失败≠未认证拒绝
    });
    assert.equal(code, 4001, "A1 未认证 WS 连接被拒");
    console.log("  ✓ A1 未认证拒绝");

    // A2: 同一 WS 连接两轮对话，续接同一会话
    const c = wsConnect(`ws://127.0.0.1:${GW_PORT}/v1/ws`, "dev-token");
    await c.open;
    const t0 = Date.now();
    c.send({ message: "hello one" });
    let ev, events = [];
    while ((ev = await c.next()) && ev.type !== "done") events.push(ev);
    const s1 = events.find((e) => e.type === "ready")?.sessionId;
    const r1 = events.filter((e) => e.type === "message_update").map(textOf).join("");
    assert.match(r1, /echo: hello one/, "A2-1 第一轮回复");
    assert.equal(events.filter((e) => e.type === "message_end").length, 1, "A2-2 消息完整");
    const elapsed1 = Date.now() - t0;

    c.send({ message: "hello two" });
    events = [];
    while ((ev = await c.next()) && ev.type !== "done") events.push(ev);
    const s2 = events.find((e) => e.type === "ready")?.sessionId;
    const r2 = events.filter((e) => e.type === "message_update").map(textOf).join("");
    assert.equal(s2, s1, "A2-3 两轮同一会话");
    assert.match(r2, /echo: hello two/, "A2-4 第二轮回复");
    console.log(`  ✓ A2 长连接两轮（同会话 ${s1}，首轮 ${elapsed1}ms）`);

    // A3: abort 提前中断（延迟 300ms，50ms 后 abort → 事件流在 ~50ms 提前结束）
    c.send({ message: "slow" });
    const tA = Date.now();
    let aborted = false;
    const p = (async () => {
      let e;
      while ((e = await c.next()) && e.type !== "done") {
        if (e.type === "abort_ack") aborted = true;
      }
    })();
    await new Promise((r) => setTimeout(r, 60));
    c.send({ type: "abort" });
    await p;
    const abortElapsed = Date.now() - tA;
    assert.ok(aborted, "A3-1 收到 abort_ack");
    assert.ok(abortElapsed < 250, `A3-2 abort 提前结束（${abortElapsed}ms < 250ms）`);
    console.log(`  ✓ A3 abort 提前中断（${abortElapsed}ms）`);

    // A4: 单连接并发第二请求被 busy 拒绝
    c.send({ message: "one" });
    await new Promise((r) => setTimeout(r, 50));
    c.send({ message: "two" });
    let ev4;
    while ((ev4 = await c.next()) && ev4.type !== "error" && ev4.type !== "done") {}
    assert.equal(ev4?.type, "error", "A4-1 busy 拒绝");
    assert.match(ev4?.error ?? "", /busy/, "A4-2 busy 提示");
    while ((ev4 = await c.next()) && ev4.type !== "done") {}
    c.close();
    console.log("  ✓ A4 并发第二请求 busy 拒绝");

    // A5: SSE 短连接仍可用（回归）
    const { status, events: sse } = await runChatOnce(GATEWAY, "dev-token", { session: "new", message: "short" });
    assert.equal(status, 200, "A5-1 SSE 200");
    assert.ok(sse.some((e) => e.type === "message_update"), "A5-2 SSE 有增量");
    console.log("  ✓ A5 SSE 短连接回归");
  } finally {
    stop(gw);
  }
}

async function partB() {
  console.log("── Part B: docker + 真实 pi ──");
  const gw = startGateway({ POWERI_POD_PROVIDER: "docker", POWERI_GATEWAY_USERS: "alice:token-a" });
  await new Promise((r) => setTimeout(r, 800));
  try {
    // B1: WS 一轮对话拿会话 id
    const c = wsConnect(`ws://127.0.0.1:${GW_PORT}/v1/ws`, "token-a");
    await c.open;
    c.send({ message: "记住验证码 zebra，下轮问我" });
    let ev, events = [];
    while ((ev = await c.next()) && ev.type !== "done") events.push(ev);
    const sessionId = events.find((e) => e.type === "ready")?.sessionId;
    assert.ok(sessionId, "B1-1 拿到 sessionId");
    assert.ok(events.some((e) => e.type === "message_end" && textOf(e)), "B1-2 有助手回复");
    c.close();
    console.log(`  ✓ B1 WS 真实对话（session ${sessionId}）`);

    // B2: 历史接口补发（事件已持久化在会话 JSONL）
    const res = await fetch(`${GATEWAY}/v1/sessions/${sessionId}/messages`, { headers: { Authorization: "Bearer token-a" } });
    assert.equal(res.status, 200, "B2-1 历史接口 200");
    const hist = await res.json();
    assert.equal(hist.messages[0]?.role, "user", "B2-2 首条为 user");
    assert.equal(hist.messages[0]?.text, "记住验证码 zebra，下轮问我", "B2-3 user 文本完整");
    assert.ok(hist.messages.some((m) => m.role === "assistant" && m.text.length > 0), "B2-4 有助手文本");
    // 未认证 401
    const unauth = await fetch(`${GATEWAY}/v1/sessions/${sessionId}/messages`);
    assert.equal(unauth.status, 401, "B2-5 历史接口未认证 401");
    console.log(`  ✓ B2 历史补发 ${hist.messages.length} 条消息`);

    // B3: 断线重连（新连接 + 显式 session id）续接上文
    const c2 = wsConnect(`ws://127.0.0.1:${GW_PORT}/v1/ws`, "token-a");
    await c2.open;
    c2.send({ session: sessionId, message: "验证码是什么？" });
    events = [];
    while ((ev = await c2.next()) && ev.type !== "done") events.push(ev);
    const reply = events.filter((e) => e.type === "message_update").map(textOf).join("");
    assert.match(reply, /zebra/i, "B3 重连后记得上文 zebra");
    c2.close();
    console.log("  ✓ B3 断线重连续接上文（zebra 记忆跨连接）");
  } finally {
    stop(gw);
    cleanupPods();
  }
}

const part = process.argv[2] ?? "all";
if (part === "all" || part === "A") await partA();
if (part === "all" || part === "B") await partB();
console.log(`\n✅ ticket 06 验证全部通过（${DATA_DIR}）`);
