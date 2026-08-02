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
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { WebSocketServer } from "ws";
import { getLastSession, newSessionId, setLastSession } from "./store.mjs";
import { streamPod, sessionFileHost, POD_PROVIDER, fetchWorkerSessions, fetchWorkerSessionJsonl, fetchWorkerFiles, fetchWorkerFile, fetchWorkerSkills, userPiDir, userWorkspaceDir } from "./pods.mjs";
import { withLock } from "./queue.mjs";
import { messagesFromJsonl } from "./session-parse.mjs";
import { appendUsage, invoiceFor, scanUsage } from "./metering.mjs";
import { logEvent } from "./log.mjs";

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

// 本地模式（docker/bridge）会话列表：扫该用户数据目录（DTO 与 bridge 共用 sessionListEntry）
function localSessions(userId) {
  const dir = path.join(userPiDir(userId), "sessions");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => {
      const full = path.join(dir, f);
      const st = statSync(full);
      return sessionListEntry(f.slice(0, -6), readFileSync(full, "utf8"), new Date(st.mtime).toISOString());
    });
}

// 本地模式文件/技能（仅开发回退；产品走 k8s provider 的 fetchWorker* 读 PVC）
// ponytail: 与 bridge 的 listDir/scanSkills 各存一份——k8s 为产品路径，本地是开发占位，不共享模块
function localFiles(userId, p, recursive) {
  const root = userWorkspaceDir(userId);
  const target = path.resolve(root, p ?? "/");
  if (!target.startsWith(root) || !existsSync(target)) throw new Error("Directory not found");
  if (!statSync(target).isDirectory()) throw new Error("Not a directory");
  if (!recursive) {
    const entries = readdirSync(target, { withFileTypes: true })
      .filter((d) => d.name !== "node_modules" && d.name !== ".git")
      .map((d) => ({ name: d.name, isDir: d.isDirectory(), size: 0, modified: "" }))
      .sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));
    return { entries, path: target };
  }
  const files = [];
  const walk = (dir, depth) => {
    if (depth > 8 || files.length >= 5000) return;
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (files.length >= 5000) return;
      if (d.name === "node_modules" || d.name === ".git") continue;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) walk(full, depth + 1);
      else files.push(full);
    }
  };
  walk(target, 0);
  return { files };
}

function localFile(userId, p) {
  const root = userWorkspaceDir(userId);
  const target = path.resolve(root, p ?? "");
  if (!target.startsWith(root) || !existsSync(target)) throw new Error("file not found");
  return readFileSync(target, "utf8");
}

function localSkills(userId) {
  const dir = path.join(userPiDir(userId), "skills");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => d.endsWith(".md") || statSync(path.join(dir, d)).isDirectory())
    .map((d) => ({ name: d.replace(/\.md$/, ""), description: "", filePath: path.join(dir, d), baseDir: dir, disableModelInvocation: false, sourceInfo: { source: "global", scope: "user" } }));
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

const PROVIDER = process.env.POWERI_POD_PROVIDER ?? "fake";

// 就绪探针：Pod 提供层可用才 ready（docker 需引擎存活；fake/bridge 直接可用）
function readyz() {
  if (PROVIDER === "docker") {
    try { execFileSync("docker", ["info"], { stdio: "ignore" }); return true; }
    catch { return false; }
  }
  return true;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  if (url.pathname === "/readyz") {
    res.writeHead(readyz() ? 200 : 503, { "Content-Type": "text/plain" });
    res.end(readyz() ? "ready" : "not ready");
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
      const requestId = `${sessionId}-${randomUUID().slice(0, 8)}`; // traceId：贯穿 client→网关→Pod
      try {
        const { stream } = await streamPod(userId, sessionId, message, requestId);
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
        requestId,
        sessionId, ok,
        usage: usageAgg,
        platform: { durationMs: Date.now() - t0, bandwidthBytes: bytesOut },
      });
      logEvent({
        type: "request", ok, userId, sessionId, requestId,
        channel: "sse", provider: PROVIDER,
        durationMs: Date.now() - t0, bytesOut,
        usage: usageAgg,
      });
    });
    try { res.write("event: done\ndata: {}\n\n"); res.end(); } catch {}
    return;
  }

  if (url.pathname === "/v1/sessions" && req.method === "GET") {
    // 会话列表（k8s 经 worker bridge HTTP 面读 PVC；本地模式扫数据目录）
    const userId = userFromReq(req);
    if (!userId) { sendJson(res, 401, { error: "unauthorized" }); return; }
    try {
      const sessions = POD_PROVIDER === "k8s" ? await fetchWorkerSessions(userId) : localSessions(userId);
      sendJson(res, 200, { sessions });
    } catch (e) { sendJson(res, 502, { error: String(e?.message ?? e) }); }
    return;
  }

  // 工作区文件/技能（网关代理 → worker bridge 读 PVC；pi-web 壳文件浏览器/技能菜单）
  if (url.pathname === "/v1/files" && req.method === "GET") {
    const userId = userFromReq(req);
    if (!userId) { sendJson(res, 401, { error: "unauthorized" }); return; }
    try {
      const data = POD_PROVIDER === "k8s"
        ? await fetchWorkerFiles(userId, url.searchParams.get("path") ?? "/", url.searchParams.get("recursive") === "1")
        : localFiles(userId, url.searchParams.get("path") ?? "/", url.searchParams.get("recursive") === "1");
      sendJson(res, 200, data);
    } catch (e) { sendJson(res, 502, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/v1/file" && req.method === "GET") {
    const userId = userFromReq(req);
    if (!userId) { sendJson(res, 401, { error: "unauthorized" }); return; }
    try {
      const content = POD_PROVIDER === "k8s"
        ? await fetchWorkerFile(userId, url.searchParams.get("path") ?? "")
        : localFile(userId, url.searchParams.get("path") ?? "");
      sendJson(res, 200, { content });
    } catch (e) { sendJson(res, 502, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/v1/skills" && req.method === "GET") {
    const userId = userFromReq(req);
    if (!userId) { sendJson(res, 401, { error: "unauthorized" }); return; }
    try {
      const skills = POD_PROVIDER === "k8s"
        ? await fetchWorkerSkills(userId)
        : localSkills(userId);
      sendJson(res, 200, { skills });
    } catch (e) { sendJson(res, 502, { error: String(e?.message ?? e) }); }
    return;
  }

  if (url.pathname.startsWith("/v1/sessions/") && url.pathname.endsWith("/jsonl") && req.method === "GET") {
    // 原始会话 JSONL（导出 HTML 用）：k8s 经 bridge 读 PVC；本地读文件
    const userId = userFromReq(req);
    if (!userId) { sendJson(res, 401, { error: "unauthorized" }); return; }
    const sessionId = url.pathname.split("/")[3];
    if (!sessionId) { sendJson(res, 400, { error: "sessionId required" }); return; }
    try {
      if (POD_PROVIDER === "k8s") {
        const lines = await fetchWorkerSessionJsonl(userId, sessionId);
        if (lines === null) { sendJson(res, 404, { error: "session not found" }); return; }
        sendJson(res, 200, { sessionId, lines });
      } else {
        const file = sessionFileHost(userId, sessionId);
        if (!existsSync(file)) { sendJson(res, 404, { error: "session not found" }); return; }
        sendJson(res, 200, { sessionId, lines: readFileSync(file, "utf8") });
      }
    } catch (e) { sendJson(res, 502, { error: String(e?.message ?? e) }); }
    return;
  }

  if (url.pathname.startsWith("/v1/sessions/") && url.pathname.endsWith("/messages") && req.method === "GET") {
    // 断线重连历史补发：从用户 PVC 上的会话 JSONL 提取消息（事件已持久化，重连不丢）
    const userId = userFromReq(req);
    if (!userId) { sendJson(res, 401, { error: "unauthorized" }); return; }
    const sessionId = url.pathname.split("/")[3];
    if (!sessionId) { sendJson(res, 400, { error: "sessionId required" }); return; }
    // k8s provider：会话 JSONL 在 worker PVC，经 bridge HTTP 面读（修复 ticket 20 发现的本地读 bug）
    let messages;
    if (POD_PROVIDER === "k8s") {
      const lines = await fetchWorkerSessionJsonl(userId, sessionId);
      if (lines === null) { sendJson(res, 404, { error: "session not found" }); return; }
      messages = messagesFromJsonl(lines);
    } else {
      const file = sessionFileHost(userId, sessionId);
      if (!existsSync(file)) { sendJson(res, 404, { error: "session not found" }); return; }
      messages = messagesFromJsonl(readFileSync(file, "utf8"));
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
      const requestId = `${sessionId}-${randomUUID().slice(0, 8)}`;
      await withLock(`${userId}/${sessionId}`, async () => {
        const t0 = Date.now();
        let usageAgg = null, bytesOut = 0, ok = true;
        const { stream, abort } = await streamPod(userId, sessionId, msg.message, requestId);
        current = { abort };
        try {
          for await (const ev of stream) {
            const s = JSON.stringify(ev);
            bytesOut += s.length;
            wsend(ev);
            if (ev.type === "message_end" && ev.message?.role === "assistant" && ev.message.usage) {
              usageAgg = usageAgg ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0 };
              for (const k of ["input", "output", "cacheRead", "cacheWrite", "reasoning", "totalTokens"]) {
                usageAgg[k] += Number(ev.message.usage[k]) || 0;
              }
            }
          }
        } catch (e) {
          ok = false;
          wsend({ type: "error", error: String(e?.message ?? e) });
        } finally { current = null; }
        appendUsage(userId, { ts: Date.now(), requestId, sessionId, ok, usage: usageAgg, platform: { durationMs: Date.now() - t0, bandwidthBytes: bytesOut } });
        logEvent({ type: "request", ok, userId, sessionId, requestId, channel: "ws", provider: PROVIDER, durationMs: Date.now() - t0, bytesOut, usage: usageAgg });
      });
      wsend({ type: "done" });
    } finally { inflight = false; }
  });
  // 断开：不主动取消——drain 由正在跑的 for await 继续完成（JSONL 完整性）
});

server.listen(PORT, () => console.error(`[gateway] listening on :${PORT}  users=${Object.values(USERS).join(",")}  provider=${process.env.POWERI_POD_PROVIDER ?? "fake"}`));
