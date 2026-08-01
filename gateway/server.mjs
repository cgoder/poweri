// PowerI 网关：认证 + 路由 + 流式转发（Node，无框架）
// 客户端 API：
//   GET  /healthz                     存活探针
//   POST /v1/chat  Authorization: Bearer <token>
//         body { "session": "s1", "message": "hi" }
//         → SSE 事件流（data: <json>），事件即 Pod 上游事件（message_update 等）
// 无状态：不保存会话，路由与认证全靠请求自身；Pod 由 PodProvider 解析。
// 运行：node gateway/server.mjs  （POWERI_GATEWAY_PORT / POWERI_GATEWAY_TOKEN）

import { createServer } from "node:http";
import { streamPod } from "./pods.mjs";

const PORT = Number(process.env.POWERI_GATEWAY_PORT ?? 8080);
const TOKEN = process.env.POWERI_GATEWAY_TOKEN ?? "dev-token";

function authed(req) {
  return (req.headers.authorization || "") === `Bearer ${TOKEN}`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  if (url.pathname === "/v1/chat" && req.method === "POST") {
    if (!authed(req)) {
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
    session = session || "default";

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("event: ready\ndata: {}\n\n");
    try {
      for await (const ev of streamPod(session, message)) {
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

server.listen(PORT, () => console.error(`[gateway] listening on :${PORT}  (token auth)`));
