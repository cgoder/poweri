// PowerI 网关：认证 + 会话解析 + 路由 + 流式转发（Node，无框架）
// 客户端 API：
//   GET  /healthz                     存活探针
//   POST /v1/chat  Authorization: Bearer <token>
//         body { "session": "new"|"<id>"|省略, "message": "hi" }
//         → SSE 事件流：首个事件 {"type":"session","sessionId":...}（会话决策可见），
//           其后为 Pod 上游事件（message_update 等）
// 会话语义：省略/“continue” → 续接该用户最近会话；无则新建；“new” → 强制新会话；
//           “<id>” → 续接指定会话。会话文件落在该用户数据目录（PoC 版 PVC）。
// 无状态：不保存会话，路由全靠请求自身 + 元数据存储（store.mjs）。
// 运行：node gateway/server.mjs
//   POWERI_GATEWAY_PORT / POWERI_GATEWAY_USERS("alice:token-a;bob:token-b") / POWERI_POD_PROVIDER

import { createServer } from "node:http";
import { getLastSession, newSessionId, setLastSession } from "./store.mjs";
import { streamPod } from "./pods.mjs";

const PORT = Number(process.env.POWERI_GATEWAY_PORT ?? 8080);
const USERS = parseUsers(process.env.POWERI_GATEWAY_USERS ?? "alice:dev-token");

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
    let body = "";
    for await (const chunk of req) body += chunk;
    let { session, message } = JSON.parse(body || "{}");
    if (!message) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "message required" }));
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
    try {
      for await (const ev of await streamPod(userId, sessionId, message)) {
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      }
    } catch (e) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: String(e?.message ?? e) })}\n\n`);
    }
    res.write("event: done\ndata: {}\n\n");
    res.end();
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => console.error(`[gateway] listening on :${PORT}  users=${Object.values(USERS).join(",")}  provider=${process.env.POWERI_POD_PROVIDER ?? "fake"}`));
