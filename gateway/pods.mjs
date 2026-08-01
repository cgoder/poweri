// PowerI Pod 提供者：把请求路由到能处理该 session 的 Pod，产出一条事件流。
// Pod 抽象 = stream(session, message) → AsyncIterable<object>（上游事件）。
// 实现：
//   fake   — 内存假 Pod（主测试缝，无真实 pi）
//   bridge — 经 WS 连真实 Worker Pod 的桥（可切换到真实 Pod 验证）
// 选型：POWERI_POD_PROVIDER=fake|bridge，POWERI_POD_BRIDGE_URL=ws://host:port

import { WebSocket } from "ws";

// ── fake：内存假 Pod ──────────────────────────────────
export function fakePodStream(session, message) {
  const reply = `(fake)[${session}] echo: ${message}`;
  return (async function* () {
    yield { type: "agent_start" };
    yield { type: "turn_start" };
    yield { type: "message_start", message: { role: "assistant" } };
    yield { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: reply }] } };
    yield { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: reply }] } };
    yield { type: "turn_end" };
    yield { type: "agent_end" };
  })();
}

// ── WS → 事件异步迭代器（逐条 JSONL）──────────────────
function wsEvents(ws) {
  let buf = [], wake = null;
  ws.on("message", (d) => {
    try { buf.push(JSON.parse(d.toString())); } catch {}
    if (wake) { const w = wake; wake = null; w(); }
  });
  ws.on("close", () => { if (wake) { const w = wake; wake = null; w(); } });
  return (async function* () {
    while (true) {
      if (buf.length) yield buf.shift();
      else if (ws.readyState === ws.CLOSED || ws.readyState === ws.CLOSING) return;
      else await new Promise((r) => (wake = r));
    }
  })();
}

// ── bridge：连真实桥 ──────────────────────────────────
export function bridgePodStream(wsUrl, session, message) {
  return (async function* () {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
    ws.send(JSON.stringify({ id: "g-chat", type: "prompt", message }));
    const it = wsEvents(ws);
    for await (const ev of it) {
      yield ev;
      if (ev.type === "agent_settled") break;
    }
    ws.close();
  })();
}

// ── 路由入口 ──────────────────────────────────────────
const PROVIDER = process.env.POWERI_POD_PROVIDER ?? "fake";
const BRIDGE_URL = process.env.POWERI_POD_BRIDGE_URL ?? "ws://localhost:8081";

export function streamPod(session, message) {
  if (PROVIDER === "bridge") return bridgePodStream(BRIDGE_URL, session, message);
  return fakePodStream(session, message);
}
