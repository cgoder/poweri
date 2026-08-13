// PowerI Pod 提供者：把请求路由到能处理该 (userId, sessionId) 的 Pod，产出一条事件流。
// Pod 抽象 = stream(userId, sessionId, message) → AsyncIterable<object>（上游事件）。
// 实现：
//   fake   — 内存假 Pod（主测试缝，无真实 pi）
//   bridge — 经 WS 连单个已运行桥（快速链路调试）
//   docker — 按请求调度一个容器：挂载该用户数据目录（PoC 版 per-user PVC）+ 会话文件
// 选型：POWERI_POD_PROVIDER=fake|bridge|docker

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
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
    // message_update 对齐真实 pi 事件形状（含 assistantMessageEvent 增量；v0.8.8 web 端 toClientAgentEvent 依赖）
    yield { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: reply, partial: { role: "assistant" } }, message: { role: "assistant", content } };
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

function bridgePodStream(userId, wsUrl, message, requestId) {
  let ws = null; // 连接建立后才可 abort；连接前 abort 被忽略（PoC 可接受窗口）
  const stream = (async function* () {
    ws = await connectWs(wsUrl);
    ws.on("error", () => {}); // 防未处理 error 崩溃；close 事件负责收尾
    try {
      ws.send(JSON.stringify({ id: requestId, type: "prompt", message })); // requestId 贯穿：response 事件回带同 id（trace）
      for await (const ev of wsEvents(ws)) {
        touch(userId); // 长回合逐事件续活，防空闲超时误杀
        yield ev;
        if (ev.type === "agent_settled") break;
      }
    } finally {
      ws.close(); // 生成器被抛弃（客户端断开/异常）也会关 WS → 桥杀 pi，不残留进程
    }
  })();
  return { stream, abort: () => { if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "abort" })); } };
}

// ── k8s 按需开通（on-demand provisioning）：新用户首次请求自动建 PVC+Deployment+Service ──
// 背景：gen-k8s 只预置存量用户（POWERI_K8S_USERS 静态映射）；新用户（业务网关验签通过后）
// 首次接入时网关经 K8s API（in-cluster SA token，Node fetch 零依赖）创建其 worker，幂等可重入。
// 模板与 gen-k8s 的 worker 模板同构（subPath 挂载/initContainer 播种/Secret 注入），仅 Service 用 ClusterIP（动态 worker 不对外暴露）。
// RBAC：deploy/k8s/gateway.yaml 的 Role poweri-gateway（get/create deployments/pvc/services）；缺失时 403 报错提示。
const K8S_NS = process.env.POWERI_K8S_NAMESPACE ?? "poweri";
const K8S_API = process.env.POWERI_K8S_API ?? "https://kubernetes.default.svc";
const SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";
const DYNAMIC_IMAGE = process.env.POWERI_POD_IMAGE ?? "poweri-worker:local";
const DYNAMIC_MODEL = process.env.POWERI_AI_MODEL ?? "agent";
// ECS 类环境公网域名不可解析：POWERI_LLMS_EXTRA_HOSTS="<ip>:<host>" 时给 worker pod 注入 hostAliases（如 172.16.123.89:llms.litta.cn）
const [aliasIp, aliasHost] = (process.env.POWERI_LLMS_EXTRA_HOSTS ?? "").split(":");
const HOST_ALIASES = aliasIp && aliasHost ? { hostAliases: [{ ip: aliasIp, hostnames: [aliasHost] }] } : {};

function readFileIfExists(p) { try { return readFileSync(p, "utf8"); } catch { return null; } }
// SA token 启动竞态防护：kubelet 写 token 文件与容器启动有时序，重试 + 区分缺文件/空/不可读
async function k8sToken() {
  if (process.env.POWERI_K8S_TOKEN) return process.env.POWERI_K8S_TOKEN;
  const f = path.join(SA_DIR, "token");
  for (let i = 0; i < 10; i++) {
    const t = readFileIfExists(f);
    if (t) return t;
    await sleep(500);
  }
  const why = (() => { try { readFileSync(f); return "文件为空"; } catch (e) { return `不可读: ${e.code}`; } })();
  throw new Error(`k8s API 无凭据：${f} 不存在或 ${why}（需 in-cluster SA token 或 POWERI_K8S_TOKEN）`);
}

async function k8sApi(method, apiPath, body, contentType = "application/json") {
  const token = await k8sToken();
  if (!token) throw new Error("k8s API 无凭据：缺少 in-cluster SA token 或 POWERI_K8S_TOKEN");
  const res = await fetch(`${K8S_API}${apiPath}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": contentType, accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`k8s API ${method} ${apiPath} → ${res.status}：${detail}（网关 SA 缺权限？更新 gateway.yaml 的 Role poweri-gateway）`);
  }
  return res.json();
}

// 与 gen-k8s 同构的每用户 worker（仅 Service 用 ClusterIP，动态 worker 不对外暴露）
function workerObjects(userId) {
  const labels = { app: "poweri", role: "worker", user: userId };
  return [
    { kind: "PersistentVolumeClaim", apiVersion: "v1", metadata: { name: `${userId}-pvc`, namespace: K8S_NS }, spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: "1Gi" } } } },
    { kind: "Deployment", apiVersion: "apps/v1", metadata: { name: `worker-${userId}`, namespace: K8S_NS }, spec: {
      replicas: 1, selector: { matchLabels: { app: "poweri", user: userId } },
      template: { metadata: { labels }, spec: {
        initContainers: [{ name: "seed", image: DYNAMIC_IMAGE, imagePullPolicy: "IfNotPresent", securityContext: { runAsUser: 0 }, command: ["sh", "-c", "mkdir -p /agent/sessions && cp /config/models.json /config/settings.json /agent/ || true; chown -R 1000:1000 /agent /workspace || true"], volumeMounts: [
          { name: "pi", mountPath: "/agent", subPath: "pi-agent" }, { name: "pi", mountPath: "/workspace", subPath: "workspace" }, { name: "config", mountPath: "/config" }] }],
        ...(HOST_ALIASES.hostAliases ? { hostAliases: HOST_ALIASES.hostAliases } : {}),
        containers: [{ name: "bridge", image: DYNAMIC_IMAGE, imagePullPolicy: "IfNotPresent", command: ["node", "/bridge/server.mjs"], resources: { requests: { cpu: "250m", memory: "256Mi" }, limits: { cpu: "1", memory: "512Mi" } }, env: [
          { name: "POWERI_AI_MODEL", value: DYNAMIC_MODEL },
          { name: "POWERI_AI_API_KEY", valueFrom: { secretKeyRef: { name: "poweri-secrets", key: "POWERI_AI_API_KEY" } } }],
          ports: [{ containerPort: 8081 }], securityContext: { runAsNonRoot: true, runAsUser: 1000, allowPrivilegeEscalation: false }, volumeMounts: [
            { name: "pi", mountPath: "/home/piuser/.pi/agent", subPath: "pi-agent" }, { name: "pi", mountPath: "/workspace", subPath: "workspace" }] }],
        volumes: [{ name: "pi", persistentVolumeClaim: { claimName: `${userId}-pvc` } }, { name: "config", configMap: { name: "pi-config" } }],
      } } } },
    { kind: "Service", apiVersion: "v1", metadata: { name: `worker-${userId}`, namespace: K8S_NS }, spec: { selector: labels, ports: [{ port: 8081, targetPort: 8081 }] } },
  ];
}

const dynamicAddr = (userId) => `worker-${userId}.${K8S_NS}.svc.cluster.local:8081`;
const provisioning = new Map(); // 并发去重：同用户首次接入只建一次

async function ensureK8sWorker(userId) {
  if (K8S_USERS[userId]) return; // 静态预置用户直接路由
  if (provisioning.has(userId)) return provisioning.get(userId);
  const p = (async () => {
    console.error(`[provision] 新用户 ${userId} 按需开通 worker…`);
    let exist = await k8sApi("GET", `/apis/apps/v1/namespaces/${K8S_NS}/deployments/worker-${userId}`).catch(() => null);
    if (exist?.spec?.replicas === 0) {
      // 之前缩容过（ticket 32）：PVC/Service 保留，只恢复副本，等 Ready
      console.error(`[provision] ${userId} worker 已缩容 → 拉起（replicas 1）`);
      await scaleWorker(userId, 1);
    } else if (!exist) for (const obj of workerObjects(userId)) {
      const apiPath = obj.kind === "Deployment"
        ? `/apis/apps/v1/namespaces/${K8S_NS}/deployments`
        : `/api/v1/namespaces/${K8S_NS}/${obj.kind === "PersistentVolumeClaim" ? "persistentvolumeclaims" : "services"}`;
      await k8sApi("POST", apiPath, obj).catch((e) => { if (!`${e}`.includes("already exists")) throw e; });
    }
    for (let i = 0; i < 60; i++) { // 等 Deployment Ready（seed initContainer + bridge 启动）
      const d = await k8sApi("GET", `/apis/apps/v1/namespaces/${K8S_NS}/deployments/worker-${userId}`).catch(() => null);
      if (d?.status?.readyReplicas >= 1) { K8S_USERS[userId] = dynamicAddr(userId); return; }
      await sleep(1500);
    }
    throw new Error(`worker-${userId}（${DYNAMIC_IMAGE}）90s 未就绪`);
  })().finally(() => provisioning.delete(userId));
  provisioning.set(userId, p);
  return p;
}

// ── 缩容（ticket 31 遗留 → 32）：worker 空闲超时 scale-to-0，PVC/Service 保留，下次请求自动拉起 ──
// 所有用户行为统一（动态+静态）：空闲超时都缩到 0，请求时自动拉起；孤儿 worker（网关重启残留）一并回收。
// 空闲判定：k8sBridgeAddr 入口触达 + 长回合逐事件触达（防超长回合被误杀）。
// 局限（ponytail: 单网关进程内 Map）：多副本网关需共享 lastSeen（生产：Redis/DB），届时孤儿扫描仍兜底。
const IDLE_MIN = Math.max(1, Number(process.env.POWERI_WORKER_IDLE_MINUTES ?? 30) || 30);
const lastSeen = new Map(); // userId → lastActiveMs（仅 k8s provider 用户）
function touch(userId) { if (PROVIDER === "k8s") lastSeen.set(userId, Date.now()); }
async function scaleWorker(userId, replicas) {
  await k8sApi("PATCH", `/apis/apps/v1/namespaces/${K8S_NS}/deployments/worker-${userId}`,
    { spec: { replicas } }, "application/merge-patch+json")
    .catch((e) => { if (!`${e}`.includes("404")) throw e; });
}
async function sweepIdleWorkers() {
  const now = Date.now();
  for (const [userId, t] of lastSeen) { // 1) 本进程见过的用户（动态+静态，行为统一）：空闲超时 → 0
    if (now - t <= IDLE_MIN * 60_000) continue;
    lastSeen.delete(userId);
    if (provisioning.has(userId)) continue;
    // 从路由表摘除：下次请求走 ensureK8sWorker → 检测 0 副本 → PATCH 1 拉起（否则提前返回永远连 0 副本 worker）
    if (K8S_USERS[userId]) delete K8S_USERS[userId];
    console.error(`[scale-down] ${userId} 空闲 ${IDLE_MIN}min，worker 缩容 0（PVC 保留，下次请求自动拉起）`);
    await scaleWorker(userId, 0);
  }
  const list = await k8sApi("GET", `/apis/apps/v1/namespaces/${K8S_NS}/deployments?labelSelector=${encodeURIComponent("role=worker")}`).catch(() => null);
  for (const d of list?.items ?? []) { // 2) 孤儿动态 worker（本进程从未触达，如网关重启残留）→ 回收
    const userId = d.metadata?.labels?.user;
    if (userId && !K8S_USERS[userId] && !lastSeen.has(userId) && !provisioning.has(userId) && d.spec?.replicas !== 0) {
      console.error(`[scale-down] ${userId} 孤儿 worker（网关重启残留），缩容 0`);
      await scaleWorker(userId, 0);
    }
  }
}

// ── 路由入口 ─────────────────────────────────────────────────────────
const PROVIDER = process.env.POWERI_POD_PROVIDER ?? "fake";
export const POD_PROVIDER = PROVIDER;
const BRIDGE_URL = process.env.POWERI_POD_BRIDGE_URL ?? "ws://localhost:8081";

// k8s：真实 K8s（每用户 PVC + Deployment + Service；静态预置 + 新用户按需开通）
// POWERI_K8S_USERS="alice:worker-alice.poweri.svc.cluster.local:8081"（gateway 在 K8s 内时用 Service DNS）
//   或 "alice:30081"（userId:nodePort，host 默认 POWERI_K8S_NODE_HOST）
const K8S_USERS = Object.fromEntries(
  (process.env.POWERI_K8S_USERS ?? "").split(";").filter(Boolean)
    .map((p) => { const [u, a, b] = p.split(":"); return [u, b ? `${a}:${b}` : a?.trim()]; })
);
if (PROVIDER === "k8s") setInterval(sweepIdleWorkers, 60_000).unref(); // 缩容巡检（60s）
if (PROVIDER === "k8s") setInterval(sweepIdleWorkers, 60_000).unref(); // 缩容巡检（60s）
function k8sBridgeUrl(userId, sessionId) {
  return k8sBridgeAddr(userId).then((addr) => `ws://${addr}/?session=${encodeURIComponent(SESSION_FILE_CONTAINER(sessionId))}`);
}

// k8s 会话文件 HTTP 面（bridge 的 createServer 同端口承载 HTTP+WS）：网关经此读 worker PVC
async function k8sBridgeAddr(userId) {
  touch(userId); // 缩容判定：任何用户请求即标记活跃
  await ensureK8sWorker(userId); // 静态预置秒回；新用户触发按需开通
  const target = K8S_USERS[userId];
  if (!target) throw new Error(`k8s 无该用户映射: ${userId}`);
  return target.includes(":") ? target : `${process.env.POWERI_K8S_NODE_HOST ?? "127.0.0.1"}:${target}`;
}

export async function fetchWorkerSessions(userId) {
  const res = await fetch(`http://${await k8sBridgeAddr(userId)}/sessions`);
  if (!res.ok) throw new Error(`worker /sessions HTTP ${res.status}`);
  return (await res.json()).sessions ?? [];
}

export async function fetchWorkerSessionJsonl(userId, sessionId) {
  const res = await fetch(`http://${await k8sBridgeAddr(userId)}/sessions/${encodeURIComponent(sessionId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`worker /sessions/<id> HTTP ${res.status}`);
  return (await res.json()).lines ?? "";
}

export async function fetchWorkerSessionRename(userId, sessionId, name) {
  const res = await fetch(`http://${await k8sBridgeAddr(userId)}/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`worker PATCH /sessions/<id> HTTP ${res.status}`);
  return (await res.json()).name ?? "";
}

export async function fetchWorkerSessionDelete(userId, sessionId) {
  const res = await fetch(`http://${await k8sBridgeAddr(userId)}/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`worker DELETE /sessions/<id> HTTP ${res.status}`);
  return true;
}

// 工作区文件/技能：网关代理到 worker bridge HTTP 面（读用户 PVC）
export async function fetchWorkerFiles(userId, path, recursive) {
  const res = await fetch(`http://${await k8sBridgeAddr(userId)}/files?path=${encodeURIComponent(path ?? "/")}&recursive=${recursive ? "1" : "0"}`);
  if (!res.ok) throw new Error(`worker /files HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return res.json();
}

export async function fetchWorkerFile(userId, path) {
  const res = await fetch(`http://${await k8sBridgeAddr(userId)}/file?path=${encodeURIComponent(path ?? "")}`);
  if (res.status === 400) { const j = await res.json(); throw new Error(j.error ?? "file error"); }
  if (!res.ok) throw new Error(`worker /file HTTP ${res.status}`);
  return (await res.json()).content ?? "";
}

export async function fetchWorkerSkills(userId) {
  const res = await fetch(`http://${await k8sBridgeAddr(userId)}/skills`);
  if (!res.ok) throw new Error(`worker /skills HTTP ${res.status}`);
  return (await res.json()).skills ?? [];
}

// 路由入口：统一返回 Promise<{ stream: AsyncIterable<object>, abort: () => void }>
// requestId：贯穿链路（client→网关→桥 prompt id→pi response id），供 trace 关联
export async function streamPod(userId, sessionId, message, requestId) {
  if (PROVIDER === "docker") {
    const wsUrl = await ensureBridgePod(userId, sessionId);
    return bridgePodStream(userId, wsUrl, message, requestId);
  }
  if (PROVIDER === "bridge") return bridgePodStream(userId, BRIDGE_URL, message, requestId);
  if (PROVIDER === "k8s") return bridgePodStream(userId, await k8sBridgeUrl(userId, sessionId), message, requestId);
  return fakePodStream(userId, sessionId, message);
}
