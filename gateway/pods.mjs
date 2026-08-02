// PowerI Pod 提供者：把请求路由到能处理该 (userId, sessionId) 的 Pod，产出一条事件流。
// Pod 抽象 = stream(userId, sessionId, message) → AsyncIterable<object>（上游事件）。
// 实现：
//   fake   — 内存假 Pod（主测试缝，无真实 pi）
//   bridge — 经 WS 连单个已运行桥（快速链路调试）
//   docker — 按请求调度一个容器：挂载该用户数据目录（PoC 版 per-user PVC）+ 会话文件
// 选型：POWERI_POD_PROVIDER=fake|bridge|docker

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { DATA_DIR } from "./store.mjs";

// ── 用户数据目录（PoC 的 per-user PVC 占位；生产为 K8s PVC 挂载点）─────────
export const userDir = (userId) => path.join(DATA_DIR, "users", userId);
export const userPiDir = (userId) => path.join(userDir(userId), ".pi", "agent");
export const userWorkspaceDir = (userId) => path.join(userDir(userId), "workspace");
export const sessionFileHost = (userId, sessionId) => path.join(userPiDir(userId), "sessions", `${sessionId}.jsonl`);
export const SESSION_FILE_CONTAINER = (sessionId) => `/home/piuser/.pi/agent/sessions/${sessionId}.jsonl`;

// 平台 pi 配置源（gen-pi-config 生成）：默认项目内 deploy/config/pi（不污染宿主 ~/.pi/agent），可用 POWERI_PI_CONFIG_DIR 覆盖
const HOST_PI_CONFIG = process.env.POWERI_PI_CONFIG_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "deploy", "config", "pi");

// 首次使用：建用户目录 + 播种 pi 配置（models/settings，来自宿主生成的配置）
function seedUser(userId) {
  const piDir = userPiDir(userId);
  if (!existsSync(path.join(piDir, "models.json"))) {
    mkdirSync(path.join(piDir, "sessions"), { recursive: true });
    for (const f of ["models.json", "settings.json"]) {
      const src = path.join(HOST_PI_CONFIG, f);
      if (existsSync(src)) copyFileSync(src, path.join(piDir, f));
    }
  }
  mkdirSync(userWorkspaceDir(userId), { recursive: true });
}

// ── docker：按请求调度/复用容器（PoC 版 K8s Pod 调度）───────────────────
const POD_IMAGE = process.env.POWERI_POD_IMAGE ?? "poweri-worker:local";
// 资源限额（ticket 07 容器级隔离）：默认 1 CPU / 512MB / 128 pids，可经 env 覆盖
// K8s 正式形态 = deploy/k8s/ 的 resources.limits + NetworkPolicy（docker 层无 egress 白名单）
const POD_CPUS = process.env.POWERI_POD_CPUS ?? "1";
const POD_MEM_MB = process.env.POWERI_POD_MEM_MB ?? "512";
const POD_PIDS = process.env.POWERI_POD_PIDS ?? "128";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// WS 连接带重试：容器端口映射先于内部进程就绪，首次请求需等待桥监听
async function connectWs(url) {
  for (let i = 0; i < 20; i++) {
    try {
      const ws = new WebSocket(url);
      await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
      return ws;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`WS 连接失败: ${url}`);
}

function containerPort(name) {
  const out = execFileSync("docker", ["port", name, "8081"], { encoding: "utf8" }).trim();
  // 兼容两种输出："8081/tcp -> 127.0.0.1:32768" 或 "127.0.0.1:32768"
  const hp = out.split("\n")[0].split("->").pop()?.trim();
  if (!hp) throw new Error(`no port for ${name}`);
  return `ws://${hp}`;
}

async function ensureBridgePod(userId, sessionId) {
  seedUser(userId);
  const name = `poweri-${userId}-${sessionId.slice(0, 8)}`;
  // 已有容器（上次请求留下的）→ 直接复用，会话文件已在 PVC 上
  try {
    const existing = execFileSync("docker", ["ps", "--filter", `name=^/${name}$`, "--format", "{{.Names}}"], { encoding: "utf8" }).trim();
    if (existing) return containerPort(name);
  } catch {}
  execFileSync("docker", ["run", "-d", "--rm", "--name", name,
    "--cpus", POD_CPUS, "--memory", `${POD_MEM_MB}m`, "--memory-swap", `${POD_MEM_MB}m`,
    "--pids-limit", POD_PIDS,
    "-v", `${userPiDir(userId)}:/home/piuser/.pi/agent`,
    "-v", `${userWorkspaceDir(userId)}:/workspace`,
    "-e", `POWERI_AI_MODEL=${process.env.POWERI_AI_MODEL ?? "agent"}`,
    "-e", `POWERI_SESSION_PATH=${SESSION_FILE_CONTAINER(sessionId)}`,
    "-p", "127.0.0.1::8081",
    "--entrypoint", "node",
    POD_IMAGE,
    "/bridge/server.mjs",
  ], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) {
    try { return containerPort(name); } catch {}
    await sleep(500);
  }
  throw new Error(`bridge pod ${name} 端口未就绪`);
}

// ── fake：内存假 Pod（主测试缝；echo 里带 user/session 以便断言路由）──────
// POWERI_FAKE_DELAY_MS>0 时在回复前睡眠，让并发串行/并行在时序上可观测
// POWERI_FAKE_USAGE="input/output/cacheRead/cacheWrite/reasoning" 注入确定性 usage（计量测试）
// abort() 中断睡眠并提前结束（模拟 pi abort 后停止生成）
const FAKE_DELAY = Number(process.env.POWERI_FAKE_DELAY_MS ?? 0);
const _fu = (process.env.POWERI_FAKE_USAGE ?? "").split("/").map(Number);
const FAKE_USAGE = _fu.length === 5 && _fu.every((n) => !Number.isNaN(n))
  ? { input: _fu[0], output: _fu[1], cacheRead: _fu[2], cacheWrite: _fu[3], reasoning: _fu[4], totalTokens: _fu[0] + _fu[1] }
  : null;

export function fakePodStream(userId, sessionId, message) {
  const reply = `(fake)[${userId}/${sessionId}] echo: ${message}`;
  const content = [{ type: "text", text: reply }];
  let aborted = false, wake = null;
  const abort = () => { aborted = true; if (wake) { const w = wake; wake = null; w(); } };
  const sleepAbortable = (ms) => new Promise((resolve) => {
    let timer;
    wake = () => { clearTimeout(timer); resolve(); };
    timer = setTimeout(() => { wake = null; resolve(); }, ms);
  });
  const stream = (async function* () {
    yield { type: "agent_start" };
    yield { type: "turn_start" };
    yield { type: "message_start", message: { role: "assistant" } };
    if (FAKE_DELAY > 0) await sleepAbortable(FAKE_DELAY);
    if (aborted) { yield { type: "agent_settled" }; return; } // 提前停止：回合中断但会话状态完整
    yield { type: "message_update", message: { role: "assistant", content } };
    yield { type: "message_end", message: { role: "assistant", content, usage: FAKE_USAGE } };
    yield { type: "turn_end" };
    yield { type: "agent_end" };
  })();
  return { stream, abort };
}

// ── WS → 事件异步迭代器（逐条 JSONL）─────────────────────────────────
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

function bridgePodStream(wsUrl, message, requestId) {
  let ws = null; // 连接建立后才可 abort；连接前 abort 被忽略（PoC 可接受窗口）
  const stream = (async function* () {
    ws = await connectWs(wsUrl);
    ws.on("error", () => {}); // 防未处理 error 崩溃；close 事件负责收尾
    try {
      ws.send(JSON.stringify({ id: requestId, type: "prompt", message })); // requestId 贯穿：response 事件回带同 id（trace）
      for await (const ev of wsEvents(ws)) {
        yield ev;
        if (ev.type === "agent_settled") break;
      }
    } finally {
      ws.close(); // 生成器被抛弃（客户端断开/异常）也会关 WS → 桥杀 pi，不残留进程
    }
  })();
  return { stream, abort: () => { if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "abort" })); } };
}

// ── 路由入口 ─────────────────────────────────────────────────────────
const PROVIDER = process.env.POWERI_POD_PROVIDER ?? "fake";
export const POD_PROVIDER = PROVIDER;
const BRIDGE_URL = process.env.POWERI_POD_BRIDGE_URL ?? "ws://localhost:8081";

// k8s：真实 K8s（每用户 PVC + Deployment + Service；静态映射）
// POWERI_K8S_USERS="alice:30081;bob:30082"（userId:nodePort，host 默认 POWERI_K8S_NODE_HOST）
//   或 "alice:worker-alice.poweri.svc.cluster.local:8081"（gateway 在 K8s 内时用 Service DNS）
const K8S_USERS = Object.fromEntries(
  (process.env.POWERI_K8S_USERS ?? "").split(";").filter(Boolean)
    .map((p) => { const [u, a, b] = p.split(":"); return [u, b ? `${a}:${b}` : a?.trim()]; })
);
function k8sBridgeUrl(userId, sessionId) {
  return `ws://${k8sBridgeAddr(userId)}/?session=${encodeURIComponent(SESSION_FILE_CONTAINER(sessionId))}`;
}

// k8s 会话文件 HTTP 面（bridge 的 createServer 同端口承载 HTTP+WS）：网关经此读 worker PVC
function k8sBridgeAddr(userId) {
  const target = K8S_USERS[userId];
  if (!target) throw new Error(`k8s 无该用户映射: ${userId}（POWERI_K8S_USERS）`);
  return target.includes(":") ? target : `${process.env.POWERI_K8S_NODE_HOST ?? "127.0.0.1"}:${target}`;
}

export async function fetchWorkerSessions(userId) {
  const res = await fetch(`http://${k8sBridgeAddr(userId)}/sessions`);
  if (!res.ok) throw new Error(`worker /sessions HTTP ${res.status}`);
  return (await res.json()).sessions ?? [];
}

export async function fetchWorkerSessionJsonl(userId, sessionId) {
  const res = await fetch(`http://${k8sBridgeAddr(userId)}/sessions/${encodeURIComponent(sessionId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`worker /sessions/<id> HTTP ${res.status}`);
  return (await res.json()).lines ?? "";
}

// 路由入口：统一返回 Promise<{ stream: AsyncIterable<object>, abort: () => void }>
// requestId：贯穿链路（client→网关→桥 prompt id→pi response id），供 trace 关联
export async function streamPod(userId, sessionId, message, requestId) {
  if (PROVIDER === "docker") {
    const wsUrl = await ensureBridgePod(userId, sessionId);
    return bridgePodStream(wsUrl, message, requestId);
  }
  if (PROVIDER === "bridge") return bridgePodStream(BRIDGE_URL, message, requestId);
  if (PROVIDER === "k8s") return bridgePodStream(k8sBridgeUrl(userId, sessionId), message, requestId);
  return fakePodStream(userId, sessionId, message);
}
