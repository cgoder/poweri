// PowerI 网关：认证 + 会话解析 + 路由 + 流式转发（Node，无框架）
// 客户端 API：
//   GET  /healthz                     存活探针
//   POST /v1/chat  Authorization: Bearer <token>
//         body { "session": "new"|"<id>"|省略, "message": "hi" }
//         → SSE 事件流：首个事件 {"type":"session",...}（会话决策可见），其后为 Pod 上游事件
//   GET  /v1/sessions/<sessionId>/messages  Bearer <token>  → 会话历史（断线重连补发）
//   WS   /v1/ws?token=<token>      长连接多轮对话；{"type":"abort"} 中断当前轮
// 会话语义：省略/“continue” → 续接该用户最近会话；无则新建；“new” → 强制新会话；
//           “<id>” → 续接指定会话。会话文件落在该用户数据目录（PoC 版 PVC）。
// 无状态：不保存会话，路由全靠请求自身 + 元数据存储（store.mjs）。
// 运行：node gateway/server.mjs
//   POWERI_GATEWAY_PORT / POWERI_GATEWAY_USERS("alice:token-a;bob:token-b") / POWERI_POD_PROVIDER
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { WebSocketServer } from "ws";
import { getLastSession, newSessionId, setLastSession } from "./store.mjs";
import { streamPod, sessionFileHost } from "./pods.mjs";
import { withLock } from "./queue.mjs";
import { appendUsage, invoiceFor, scanUsage } from "./metering.mjs";

const PORT = Number(process.env.POWERI_GATEWAY_PORT ?? 8080);
const USERS = parseUsers(process.env.POWERI_GATEWAY_USERS ?? "alice:dev-token");
const ADMIN_TOKEN = process.env.POWERI_GATEWAY_ADMIN_TOKEN ?? "admin-token";

function parseUsers(s) {
  const map = {};
  for (const pair of s.split(";")) {
    const [u, t] = pair.split(":");
    if (u && t) map[t.trim()] = u.trim();
  }
  return map;
}

function userFromReq(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return null;
  return USERS[h.slice(7)] ?? null;
}

function isAdmin(req) {
  return (req.headers.authorization || "") === `Bearer ${ADMIN_TOKEN}`;
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || "{}");
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

// 会话解析：返回 (sessionId, 是否新建)
function resolveSession(userId, session) {
  if (session && session !== "new" && session !== "continue") return [session, false];
  if (!session || session === "continue") {
    const last = getLastSession(userId);
    if (last) return [last, false];
  }
  return [newSessionId(), true];
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  if (url.pathname === "/v1/chat" && req.method === "POST") {
    const userId = userFromReq(req);
    if (!userId) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    let { session, message } = await readJson(req);
    if (!message) {
      sendJson(res, 400, { error: "message required" });
      return;
    }

    const [sessionId, isNew] = resolveSession(userId, session);
    setLastSession(userId, sessionId);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`event: ready\ndata: {"sessionId":"${sessionId}","isNew":${isNew},"userId":"${userId}"}\n\n`);
    // 会话级串行（ADR-0005）：同一 (userId, sessionId) 一次只放一个 in-flight，其余排队。
    // 客户端断开时仍继续消费上游流：让 pi 完成本回合，保证会话 JSONL 完整不损坏。
    // 同时按请求聚合计量（ADR-0006）：assistant message_end 的 usage 累加 + 平台指标。
    await withLock(`${userId}/${sessionId}`, async () => {
      const t0 = Date.now();
      let usageAgg = null, bytesOut = 0, ok = true;
      try {
        const { stream } = await streamPod(userId, sessionId, message);
        for await (const ev of stream) {
          if (ev?.type === "message_end" && ev.message?.role === "assistant" && ev.message.usage) {
            usageAgg = usageAgg ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0 };
            for (const k of ["input", "output", "cacheRead", "cacheWrite", "reasoning", "totalTokens"]) {
              usageAgg[k] += Number(ev.message.usage[k]) || 0;
            }
          }
          const s = `data: ${JSON.stringify(ev)}\n\n`;
          bytesOut += s.length;
          try { res.write(s); } catch { /* 对端断开：继续消费直至回合结束 */ }
        }
      } catch (e) {
        ok = false;
        try { res.write(`event: error\ndata: ${JSON.stringify({ error: String(e?.message ?? e) })}\n\n`); } catch {}
      }
      appendUsage(userId, {
        ts: Date.now(),
        requestId: `${sessionId}-${randomUUID().slice(0, 8)}`,
        sessionId, ok,
        usage: usageAgg,
        platform: { durationMs: Date.now() - t0, bandwidthBytes: bytesOut },
      });
    });
    try { res.write("event: done\ndata: {}\n\n"); res.end(); } catch {}
    return;
  }

  if (url.pathname.startsWith("/v1/sessions/") && url.pathname.endsWith("/messages") && req.method === "GET") {
    // 断线重连历史补发：从用户 PVC 上的会话 JSONL 提取消息（事件已持久化，重连不丢）
    const userId = userFromReq(req);
    if (!userId) { sendJson(res, 401, { error: "unauthorized" }); return; }
    const sessionId = url.pathname.split("/")[3];
    if (!sessionId) { sendJson(res, 400, { error: "sessionId required" }); return; }
    const file = sessionFileHost(userId, sessionId);
    if (!existsSync(file)) { sendJson(res, 404, { error: "session not found" }); return; }
    const messages = [];
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        const m = o.message;
        if (!m?.role) continue;
        const parts = m.content ?? [];
        const text = parts.filter((c) => c.type === "text").map((c) => c.text).join("");
        const thinking = parts.filter((c) => c.type === "thinking").map((c) => c.thinking ?? c.text ?? "").join("");
        if (!text && !thinking) continue;
        messages.push({ role: m.role, text, thinking: thinking || undefined, ts: o.timestamp });
      } catch { /* 跳过截断行 */ }
    }
    sendJson(res, 200, { sessionId, messages });
    return;
  }

  if (url.pathname === "/v1/admin/usage" && req.method === "GET") {
    if (!isAdmin(req)) { sendJson(res, 401, { error: "unauthorized" }); return; }
    const userId = url.searchParams.get("userId");
    if (!userId) { sendJson(res, 400, { error: "userId required" }); return; }
    const from = Number(url.searchParams.get("from") ?? -Infinity);
    const to = Number(url.searchParams.get("to") ?? Infinity);
    sendJson(res, 200, scanUsage(userId, from, to));
    return;
  }

  if (url.pathname === "/v1/admin/invoice" && req.method === "GET") {
    if (!isAdmin(req)) { sendJson(res, 401, { error: "unauthorized" }); return; }
    const { userId, period } = Object.fromEntries(url.searchParams);
    if (!userId || !period) { sendJson(res, 400, { error: "userId and period required" }); return; }
    const { invoice, reused } = await invoiceFor(userId, period);
    sendJson(res, 200, { reused, ...invoice });
    return;
  }

  if (url.pathname === "/v1/admin/invoice" && req.method === "POST") {
    if (!isAdmin(req)) { sendJson(res, 401, { error: "unauthorized" }); return; }
    const { userId, period } = await readJson(req);
    if (!userId || !period) { sendJson(res, 400, { error: "userId and period required" }); return; }
    const { invoice, reused } = await invoiceFor(userId, period);
    sendJson(res, 200, { reused, ...invoice });
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

// ── WS 长连接端点（ticket 06）：同一连接多轮对话，可中途 abort ──────────
// 连接：/v1/ws?token=<userToken>（浏览器 WS 无法带 Authorization 头，故 token 走 query；也兼容 header）
// 消息：{ message, session? } 发起一轮（同一连接同时只处理一个，busy 则返回 error）
//       { type: "abort" } 中断当前轮（pi RPC abort：停止生成，会话 JSONL 保持完整）
// 事件：ready / 上游事件原样转发 / done；连接断开时仍 drain 完当前轮（同 SSE 策略）
const wss = new WebSocketServer({ server, path: "/v1/ws" });
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token") ?? (req.headers.authorization || "").replace(/^Bearer /, "");
  const userId = USERS[token] ?? null;
  if (!userId) { ws.close(4001, "unauthorized"); return; }
  const wsend = (o) => { try { ws.send(JSON.stringify(o)); } catch {} };
  let inflight = false, current = null; // 单连接单 in-flight；跨 session 并发请用多连接
  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === "abort") { current?.abort(); wsend({ type: "abort_ack" }); return; }
    if (typeof msg.message !== "string" || !msg.message.trim()) { wsend({ type: "error", error: "message required" }); return; }
    if (inflight) { wsend({ type: "error", error: "busy: one request at a time per connection" }); return; }
    inflight = true;
    try {
      const [sessionId, isNew] = resolveSession(userId, msg.session);
      setLastSession(userId, sessionId);
      wsend({ type: "ready", sessionId, isNew, userId });
      await withLock(`${userId}/${sessionId}`, async () => {
        const { stream, abort } = await streamPod(userId, sessionId, msg.message);
        current = { abort };
        try {
          for await (const ev of stream) wsend(ev);
        } catch (e) {
          wsend({ type: "error", error: String(e?.message ?? e) });
        } finally { current = null; }
      });
      wsend({ type: "done" });
    } finally { inflight = false; }
  });
  // 断开：不主动取消——drain 由正在跑的 for await 继续完成（JSONL 完整性）
});

server.listen(PORT, () => console.error(`[gateway] listening on :${PORT}  users=${Object.values(USERS).join(",")}  provider=${process.env.POWERI_POD_PROVIDER ?? "fake"}`));
