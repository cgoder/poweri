// PowerI stdio↔WebSocket 桥
// 每个 WS 连接对应一个独立的 `pi --mode rpc` 子进程（进程隔离）。
// 网关经 WS 发 RPC 命令 → 桥转发到 pi stdin；pi stdout 的 JSONL 事件流 → 转发回 WS。
// 依赖：Bun（原生 WebSocket server + spawn，无第三方依赖）。
// 运行：bun run bridge/server.mjs  （读取 .env 的 POWERI_BRIDGE_PORT / POWERI_AI_MODEL）
// 健康探针：客户端连接后发送 {"type":"get_state"}，返回 success:true 即存活。

import { spawn } from "node:child_process";

const PORT = Number(Bun.env.POWERI_BRIDGE_PORT ?? 8081);
const MODEL = (Bun.env.POWERI_AI_MODEL ?? "").trim();
const piArgs = ["--mode", "rpc", ...(MODEL ? ["--model", `poweri-gw/${MODEL}`] : [])];

// 把字节流按 LF 切成完整 JSONL 行。
// 协议规定仅以 \n 分隔（勿用 Node readline，它会把 U+2028/29 也当换行）。
function toLines(stream, onLine) {
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.trim()) onLine(line.replace(/\r$/, ""));
    }
  });
}

Bun.serve({
  port: PORT,
  fetch(req, server) {
    if (server.upgrade(req)) return undefined;
    return new Response("upgrade failed", { status: 500 });
  },
  websocket: {
    open(ws) {
      const proc = spawn("pi", piArgs, { stdio: ["pipe", "pipe", "pipe"] });
      proc.stderr.on("data", (d) => console.error("[pi-stderr]", d.toString().trim()));
      toLines(proc.stdout, (line) => {
        try { ws.send(line); } catch {}
      });
      proc.on("exit", (code, signal) => {
        console.error(`[pi] exited code=${code} signal=${signal}`);
        try { ws.close(1011, "pi process exited"); } catch {}
      });
      ws.data = proc;
      console.error(`[bridge] ws open → spawn pi (pid=${proc.pid})`);
    },
    message(ws, buf) {
      const proc = ws.data;
      if (!proc || proc.killed || !proc.stdin.writable) return;
      // 一个 WS 消息 = 一条 RPC 命令，规范化后补一个 \n
      proc.stdin.write(buf.toString().replace(/[\r\n]+$/, "") + "\n");
    },
    close(ws) {
      const proc = ws.data;
      if (proc && !proc.killed) {
        proc.kill();
        console.error(`[bridge] ws close → kill pi pid=${proc.pid}`);
      }
    },
  },
});

console.error(`[bridge] listening on :${PORT}  model=${piArgs.join(" ")}`);
