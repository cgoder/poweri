// PowerI stdio↔WebSocket 桥（Node 实现）
// 每个 WS 连接对应一个独立的 `pi --mode rpc` 子进程（进程隔离）。
// 网关经 WS 发 RPC 命令 → 桥转发到 pi stdin；pi stdout 的 JSONL 事件流 → 转发回 WS。
// 运行时：Node（pi 与 skills 均依赖 Node，容器内统一 Node 单运行时；唯一依赖 `ws`）。
// 运行：node /bridge/server.mjs  （读取 POWERI_BRIDGE_PORT / POWERI_AI_MODEL）
// 健康探针：客户端连接后发送 {"type":"get_state"}，返回 success:true 即存活。

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { sessionListEntry, SESSIONS_CONTAINER_DIR } from "./session-parse.mjs";

const PORT = Number(process.env.POWERI_BRIDGE_PORT ?? 8081);
// 会话目录：网关 k8s provider 经 HTTP 面读会话列表/历史（默认 worker 镜像布局）
const SESSIONS_DIR = process.env.POWERI_BRIDGE_SESSIONS_DIR ?? SESSIONS_CONTAINER_DIR;
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

// 会话路径优先级：WS 握手 query（?session=<path>，K8s 常驻 Pod 按连接指定）> 启动 env
wss.on("connection", (ws, req) => {
  const sessionFromQuery = new URL(req.url ?? "/", "http://localhost").searchParams.get("session") ?? "";
  const sessionPath = sessionFromQuery.trim() || SESSION;
  console.error(`[bridge] conn url=${req.url ?? ""} session=${sessionPath}`);
  const args = piArgs.filter((a, i, arr) => !(a === "--session" && i > 0 && arr[i - 1] === "--session"));
  if (sessionPath) args.push("--session", sessionPath);
  const proc = spawn("pi", args, { stdio: ["pipe", "pipe", "pipe"] });
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

// ── HTTP 面：会话列表/读取（k8s provider 下网关经此读 worker PVC 上的会话 JSONL）──
// GET /sessions            → { sessions: [sessionListEntry DTO] }
// GET /sessions/<id>       → { id, lines: "<原始 JSONL>" }
// GET /files?path=&recursive=0 → 工作区目录列表（网关代理给 pi-web 文件浏览器/搜索）
// GET /file?path=          → { content } 读取工作区文件（utf8，只读）
// GET /skills              → { skills: [SkillInfo] } 扫描 agent 技能目录
// ponytail: 每次请求全量读+解析所有会话文件，会话量大时阻塞 WS 通道——加缓存/分页再议
const WORKSPACE = process.env.POWERI_BRIDGE_WORKSPACE ?? "/workspace";
const AGENT_DIR = process.env.POWERI_BRIDGE_AGENT_DIR ?? "/home/piuser/.pi/agent";
const IGNORED_NAMES = new Set(["node_modules", ".git", ".next", "dist", "build", "__pycache__", ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache", "target", "vendor", ".DS_Store"]);
const MAX_WALK = 5000;
const MAX_DEPTH = 8;

function resolveInWorkspace(p) {
  const target = p && p.startsWith("/") ? join("/", p) : join(WORKSPACE, p ?? "");
  return target === WORKSPACE || target.startsWith(WORKSPACE + "/") ? target : null;
}

function listDir(p, recursive) {
  if (!existsSync(p)) throw new Error("Directory not found");
  const st = statSync(p);
  if (!st.isDirectory()) throw new Error("Not a directory");
  if (!recursive) {
    const entries = readdirSync(p, { withFileTypes: true })
      .filter((d) => !IGNORED_NAMES.has(d.name))
      .map((d) => ({ name: d.name, isDir: d.isDirectory(), size: 0, modified: "" }))
      .sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));
    return { entries, path: p };
  }
  const files = [];
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH || files.length >= MAX_WALK) return;
    let items;
    try { items = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of items) {
      if (files.length >= MAX_WALK) return;
      if (IGNORED_NAMES.has(d.name)) continue;
      const full = join(dir, d.name);
      if (d.isDirectory()) walk(full, depth + 1);
      else files.push(full);
    }
  };
  walk(p, 0);
  return { files };
}

function parseFrontmatter(s) {
  const m = s.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function scanSkills() {
  const dir = join(AGENT_DIR, "skills");
  if (!existsSync(dir)) return [];
  const skills = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    let filePath, fm = {};
    if (d.isDirectory()) {
      const md = join(dir, d.name, "SKILL.md");
      if (!existsSync(md)) continue;
      filePath = md;
      try { fm = parseFrontmatter(readFileSync(md, "utf8")); } catch {}
    } else if (d.name.endsWith(".md")) {
      filePath = join(dir, d.name);
      try { fm = parseFrontmatter(readFileSync(filePath, "utf8")); } catch {}
    } else continue;
    skills.push({
      name: fm.name || d.name.replace(/\.md$/, ""),
      description: fm.description || "",
      filePath,
      baseDir: dir,
      disableModelInvocation: false,
      sourceInfo: { source: "global", scope: "user" },
    });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

server.on("request", (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (url.pathname === "/skills" && req.method === "GET") {
    try { send(200, { skills: scanSkills() }); } catch (e) { send(500, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/files" && req.method === "GET") {
    const target = resolveInWorkspace(url.searchParams.get("path") ?? "/");
    if (!target) { send(400, { error: "path outside workspace" }); return; }
    try { send(200, listDir(target, url.searchParams.get("recursive") === "1")); }
    catch (e) { send(400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/file" && req.method === "GET") {
    const target = resolveInWorkspace(url.searchParams.get("path") ?? "");
    if (!target) { send(400, { error: "path outside workspace" }); return; }
    try { send(200, { content: readFileSync(target, "utf8") }); }
    catch (e) { send(400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/sessions" && req.method === "GET") {
    try {
      const sessions = readdirSync(SESSIONS_DIR)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => {
          const st = statSync(join(SESSIONS_DIR, f));
          return sessionListEntry(f.replace(/\.jsonl$/, ""), readFileSync(join(SESSIONS_DIR, f), "utf8"), new Date(st.mtime).toISOString());
        })
        .sort((a, b) => (b.modified || "").localeCompare(a.modified || ""));
      send(200, { sessions });
    } catch (e) { send(500, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname.startsWith("/sessions/") && req.method === "GET") {
    // basename 防路径穿越；文件名为 <gatewayId>.jsonl
    const id = decodeURIComponent(url.pathname.slice("/sessions/".length).replace(/[^a-zA-Z0-9._-]/g, ""));
    try {
      const lines = readFileSync(join(SESSIONS_DIR, `${id}.jsonl`), "utf8");
      send(200, { id, lines });
    } catch { send(404, { error: "session not found" }); }
    return;
  }
  res.writeHead(404); res.end();
});

server.listen(PORT, () => console.error(`[bridge] listening on :${PORT}  model=${piArgs.join(" ")}`));
