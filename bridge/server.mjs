// PowerI stdio↔WebSocket 桥（Node 实现）
// 每个 WS 连接对应一个独立的 `pi --mode rpc` 子进程（进程隔离）。
// 网关经 WS 发 RPC 命令 → 桥转发到 pi stdin；pi stdout 的 JSONL 事件流 → 转发回 WS。
// 运行时：Node（pi 与 skills 均依赖 Node，容器内统一 Node 单运行时；唯一依赖 `ws`）。
// 运行：node /bridge/server.mjs  （读取 POWERI_BRIDGE_PORT / POWERI_AI_MODEL）
// 健康探针：客户端连接后发送 {"type":"get_state"}，返回 success:true 即存活。

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.POWERI_BRIDGE_PORT ?? 8081);
const MODEL = (process.env.POWERI_AI_MODEL ?? "").trim();
const SESSION = (process.env.POWERI_SESSION_PATH ?? "").trim();
// 扩展加载：POWERI_EXTENSIONS 逗号/空格分隔的路径列表；默认带镜像内置 User Memory 扩展（路径存在才加，兼容宿主直跑）
const EXTENSIONS = (process.env.POWERI_EXTENSIONS ?? "/poweri/extensions/user-memory.mjs")
  .split(/[,\s]+/)
  .map((p) => p.trim())
  .filter((p) => p && existsSync(p));
const piArgs = [
  "--mode", "rpc",
  ...(MODEL ? ["--model", `poweri-gw/${MODEL}`] : []),
  ...(SESSION ? ["--session", SESSION] : []),
  ...EXTENSIONS.flatMap((p) => ["-e", p]),
];

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

const server = createServer();
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  const proc = spawn("pi", piArgs, { stdio: ["pipe", "pipe", "pipe"] });
  proc.stderr.on("data", (d) => console.error("[pi-stderr]", d.toString().trim()));
  toLines(proc.stdout, (line) => {
    try { ws.send(line); } catch {}
  });
  proc.on("exit", (code, signal) => {
    console.error(`[pi] exited code=${code} signal=${signal}`);
    try { ws.close(1011, "pi process exited"); } catch {}
  });

  ws.on("message", (data) => {
    if (!proc || proc.killed || !proc.stdin.writable) return;
    proc.stdin.write(data.toString().replace(/[\r\n]+$/, "") + "\n");
  });
  ws.on("close", () => {
    if (proc && !proc.killed) { proc.kill(); console.error(`[bridge] ws close → kill pi pid=${proc.pid}`); }
  });

  console.error(`[bridge] ws open → spawn pi (pid=${proc.pid})`);
});

server.listen(PORT, () => console.error(`[bridge] listening on :${PORT}  model=${piArgs.join(" ")}`));
