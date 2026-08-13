// verify-33：Local 全链路冒烟（主缝，ticket 07）——迁移成功的权威标准
// 链路：web（网关模式，浏览器/curl 认证）→ gateway（docker provider）→ worker 容器（bridge → pi）→ 真实模型
// 断言：认证 401 守卫 → 新建会话 → 流式真实回复（含工具调用可见）→ 会话续接（历史完整 + toolResult 持久化 + 与流式一致）→ 多用户隔离
// 前置：docker 可用 + poweri-worker:local 镜像 + deploy/config/pi/models.json（npm run gen:pi-config 生成，需 AI 网关可达）
// 运行：node scripts/verify-33-local-e2e.mjs
// 端口：POWERI_SMOKE_GW_PORT 默认 18080（避开常用 8080）；POWERI_SMOKE_WEB_PORT 默认 30143（避开 30141/30142）
// 清理：脚本结束自动 kill 自启进程（子进程意外退出会立刻失败并打印日志）；容器 --rm 自清，3s 后兜底 rm 残留
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GW_PORT = Number(process.env.POWERI_SMOKE_GW_PORT ?? 18080);
const WEB_PORT = Number(process.env.POWERI_SMOKE_WEB_PORT ?? 30143);
const GW_BASE = `http://127.0.0.1:${GW_PORT}`;
const WEB_BASE = `http://127.0.0.1:${WEB_PORT}`;
const USERS = { alice: { pass: "pass-a", token: "token-a" }, bob: { pass: "pass-b", token: "token-b" } };
const PROMPT = "请用 bash 工具列出 /workspace 下的文件，然后用一句话总结，用中文回答";
const TIMEOUT_MS = 300_000; // 整体上限（真实模型慢）

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m, d) => { fail++; console.log(`  ✗ ${m}${d ? ` — ${String(d).slice(0, 300)}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const auth = (u) => ({ Authorization: `Basic ${Buffer.from(`${u}:${USERS[u].pass}`).toString("base64")}` });

// ── 前置检查 ──
function preflight() {
  try { execFileSync("docker", ["info"], { stdio: "ignore" }); } catch { console.error("✗ docker 不可用（需 OrbStack/Docker 运行 worker 容器）"); process.exit(1); }
  const imgs = execFileSync("docker", ["images", "--format", "{{.Repository}}:{{.Tag}}"], { encoding: "utf8" });
  if (!imgs.includes("poweri-worker:local")) { console.error("✗ 缺 poweri-worker:local 镜像（先 node scripts/build-image.mjs）"); process.exit(1); }
  if (!existsSync(path.join(ROOT, "deploy", "config", "pi", "models.json"))) { console.error("✗ 缺 deploy/config/pi/models.json（先 npm run gen:pi-config）"); process.exit(1); }
  // 清理残留容器（同名前缀，幂等）
  try { execFileSync("docker", ["rm", "-f", ...execFileSync("docker", ["ps", "-aq", "--filter", "name=poweri-"], { encoding: "utf8" }).trim().split("\n").filter(Boolean)], { stdio: "ignore" }); } catch {}
}

// ── 进程管理 ──
const children = [];
function start(cmd, args, cwd, env) {
  // detached：独立进程组，清理时进程组 kill 可连带 next-server 等孙进程（否则孙进程存活继续占端口）
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  children.push(p);
  let log = "";
  p.stdout.on("data", (d) => { log += d; });
  p.stderr.on("data", (d) => { log += d; });
  // 子进程意外退出 → 立刻失败并打印日志（避免静默等到超时；外部 daemon 占端口等场景）
  p.on("exit", (code) => {
    if (code !== null && code !== 0 && !shuttingDown) {
      console.error(`  ✗ 子进程退出（${cmd} ${args.slice(0, 3).join(" ")}… code=${code}）`);
      console.error(log.split("\n").slice(-12).map((l) => `    | ${l}`).join("\n"));
      cleanup();
      process.exit(1);
    }
  });
  return { p };
}
async function waitFor(url, what, opts = {}) {
  const deadline = Date.now() + (opts.timeout ?? 60_000);
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, opts.req ?? {});
      if (opts.expect === undefined || opts.expect === res.status) return res;
      last = `status=${res.status}`;
    } catch (e) { last = e.message; }
    await sleep(1000);
  }
  throw new Error(`等待 ${what} 超时（${url}）：${last}`);
}
let shuttingDown = false;
function cleanup() {
  shuttingDown = true;
  for (const c of children) {
    try { process.kill(-c.p.pid, "SIGKILL"); } catch { try { c.p.kill("SIGKILL"); } catch {} }
  }
  // 容器 --rm 在进程退出后自清；sleep 等待自清，残留才兜底 rm（幂等，会顺带清掉其它遗留 poweri-* 容器）
  setTimeout(() => {
    try { execFileSync("docker", ["rm", "-f", ...execFileSync("docker", ["ps", "-aq", "--filter", "name=poweri-"], { encoding: "utf8" }).trim().split("\n").filter(Boolean)], { stdio: "ignore" }); } catch {}
  }, 3000);
}

// ── SSE 流收集（读 data: 行；onFirst 在收到首个事件时回调，作订阅握手）──
async function collectEvents(url, req, { until, onFirst, timeout = 120_000 }) {
  const events = [];
  const deadline = Date.now() + timeout;
  const res = await fetch(url, req);
  if (!res.ok || !res.body) return { events, status: res.status };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          events.push(ev);
          if (onFirst && events.length === 1) onFirst();
        } catch {}
      }
    }
    if (until(events)) break;
  }
  await reader.cancel().catch(() => {});
  return { events, status: res.status };
}

// ── 主流程 ──
async function main() {
  let exitCode = 1;
  console.log(`\n=== verify-33 Local 全链路冒烟 @ web:${WEB_PORT} gw:${GW_PORT} ===`);
  preflight();
  console.log("  前置 OK（docker / 镜像 / 配置）");
  try {
    // 1. 启动 gateway（docker provider）
    const gw = start("node", ["server.mjs"], path.join(ROOT, "gateway"), {
      POWERI_POD_PROVIDER: "docker",
      POWERI_GATEWAY_USERS: `alice:${USERS.alice.token};bob:${USERS.bob.token}`,
      POWERI_GATEWAY_PORT: String(GW_PORT),
    });
    await waitFor(`${GW_BASE}/healthz`, "gateway", { timeout: 30_000 });

    // 2. 启动 web（网关模式）
    const web = start("node", ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(WEB_PORT)], path.join(ROOT, "web"), {
      NODE_ENV: "development",
      POWERI_GATEWAY_URL: GW_BASE,
      POWERI_GATEWAY_TOKEN: USERS.alice.token,
      POWERI_WEB_USERS: `alice:${USERS.alice.pass};bob:${USERS.bob.pass}`,
      POWERI_GATEWAY_USERS: `alice:${USERS.alice.token};bob:${USERS.bob.token}`,
    });
    await waitFor(WEB_BASE, "web", { timeout: 120_000, expect: 401 });

    // 3. 认证守卫
    const noAuth = await fetch(`${WEB_BASE}/api/sessions`);
    noAuth.status === 401 ? ok("3 无认证 → 401（proxy 网关模式守卫）") : bad("3 无认证 401", `status=${noAuth.status}`);
    const badAuth = await fetch(`${WEB_BASE}/api/sessions`, { headers: { Authorization: `Basic ${Buffer.from("alice:wrong").toString("base64")}` } });
    badAuth.status === 401 ? ok("3 错误密码 → 401") : bad("3 错误密码 401", `status=${badAuth.status}`);

    // 4. 新建会话 + 流式真实回复
    const newRes = await fetch(`${WEB_BASE}/api/agent/new`, { method: "POST", headers: { ...auth("alice"), "Content-Type": "application/json" }, body: JSON.stringify({ cwd: "/workspace", type: "ensure_session" }) });
    const newBody = await newRes.json();
    const tempKey = newBody.sessionId;
    if (!(newRes.status === 200 && tempKey)) { bad("4 新建会话", `${newRes.status} ${JSON.stringify(newBody).slice(0, 120)}`); return; }
    ok(`4 新建会话 → ${tempKey.slice(0, 20)}…`);
    // 开事件流 → 等订阅握手（首个事件 connected）→ 发消息
    let streamOpen = false;
    const streamP = collectEvents(`${WEB_BASE}/api/agent/${encodeURIComponent(tempKey)}/events`, { headers: auth("alice") }, { until: (evs) => evs.some((e) => e.type === "agent_settled" || e.type === "prompt_done"), onFirst: () => { streamOpen = true; }, timeout: 180_000 });
    const subDeadline = Date.now() + 20_000;
    while (!streamOpen && Date.now() < subDeadline) await sleep(200);
    if (!streamOpen) { bad("4 事件流订阅未建立", "20s 内未收到首个事件（connected）"); return; }
    const promptRes = await fetch(`${WEB_BASE}/api/agent/${encodeURIComponent(tempKey)}`, { method: "POST", headers: { ...auth("alice"), "Content-Type": "application/json" }, body: JSON.stringify({ type: "prompt", message: PROMPT }) });
    const promptBody = await promptRes.json();
    if (!(promptRes.status === 200 && promptBody.success)) { bad("4 发消息", `${promptRes.status} ${JSON.stringify(promptBody).slice(0, 120)}`); return; }
    const { events } = await streamP;
    const types = {};
    for (const e of events) types[e.type] = (types[e.type] ?? 0) + 1;
    const msb = events.find((e) => e.type === "session_created")?.sessionId;
    const textDelta = events.filter((e) => e.type === "message_update" && e.assistantMessageEvent?.type === "text_delta").map((e) => e.assistantMessageEvent.delta).join("");
    const toolRun = events.some((e) => e.type === "tool_execution_start" || e.type === "tool_execution_end");
    const gotEvents = events.some((e) => e.type === "agent_settled" || e.type === "prompt_done");
    (msb && /^msr/.test(msb)) ? ok(`4 事件流 → session_created ${msb.slice(0, 18)}…`) : bad("4 session_created msb id", `msb=${msb}`);
    gotEvents ? ok(`4 事件流完整（${JSON.stringify(types)}）`) : bad("4 事件流未收敛", `types=${JSON.stringify(types)}`);
    toolRun ? ok("4 工具调用过程可见（tool_execution_start/end）") : bad("4 工具调用事件缺失", "模型可能未触发工具；检查 POWERI_AI_MODEL 与工作区内容");
    textDelta.length > 0 ? ok(`4 流式文本 ${textDelta.length} 字符：${textDelta.slice(0, 60)}…`) : bad("4 流式文本为空", "真实模型未输出文本 delta");
    const msbId = msb;
    console.log(`  回复预览: ${textDelta.slice(0, 120)}`);

    // 5. 会话续接（重开页面：历史读取）
    const histRes = await fetch(`${WEB_BASE}/api/sessions/${msbId}?deferThinking=1&deferMedia=1`, { headers: auth("alice") });
    const hist = await histRes.json();
    const msgs = hist.context?.messages ?? [];
    const hasUser = msgs.some((m) => m.role === "user" && JSON.stringify(m.content ?? "").includes("bash 工具"));
    // 真实 pi：thinking 与 text 是两条独立 assistant 消息（非同一消息双块），需合并全部 assistant 的 text 块
    const assistantTexts = msgs.filter((m) => m.role === "assistant").flatMap((m) => m.content ?? []).filter((c) => c.type === "text").map((c) => c.text);
    const hasAssistant = assistantTexts.some((t) => t.length > 20);
    const hasToolResult = msgs.some((m) => m.role === "toolResult");
    const histAssistant = assistantTexts.join("").replace(/\s+/g, "");
    const histMatchesStream = histAssistant.length > 20 && histAssistant.includes(textDelta.replace(/\s+/g, "").slice(0, 20));
    (histRes.status === 200 && msgs.length >= 2) ? ok(`5 历史读取 ${msgs.length} 条消息（重开页面续接）`) : bad("5 历史读取", `status=${histRes.status} n=${msgs.length}`);
    hasUser && hasAssistant ? ok("5 历史内容完整（user 原文 + assistant 回复）") : bad("5 历史内容", `hasUser=${hasUser} hasAssistant=${hasAssistant}`);
    hasToolResult ? ok("5 历史含 toolResult（工具调用输出持久化）") : bad("5 历史 toolResult", "无 toolResult 消息");
    histMatchesStream ? ok("5 历史 assistant 文本与流式回复一致") : bad("5 历史与流式一致性", `hist=${histAssistant.slice(0, 30)}… vs stream=${textDelta.slice(0, 30)}…`);

    // 6. 多用户隔离
    const bobList = await (await fetch(`${WEB_BASE}/api/sessions?force=1`, { headers: auth("bob") })).json();
    const bobN = (bobList.sessions ?? []).length;
    bobN === 0 ? ok("6 bob 会话列表为空（token 隔离）") : bad("6 bob 列表", `n=${bobN}`);
    const bobRead = await fetch(`${WEB_BASE}/api/sessions/${msbId}?deferThinking=1`, { headers: auth("bob") });
    bobRead.status === 404 ? ok("6 bob 读 alice 会话 → 404（跨用户隔离）") : bad("6 bob 跨用户读", `status=${bobRead.status}`);

    console.log(`\n结果：${fail === 0 ? "PASS" : "FAIL"}（${pass} 通过 / ${fail} 失败，上限 ${TIMEOUT_MS / 1000}s 内完成）`);
    console.log("说明：本脚本为真实链路回归基准（每次迁移/升级后运行）；浏览器人工确认步骤见 docs/local-e2e-smoke.md");
    exitCode = fail === 0 ? 0 : 1;
  } finally {
    // process.exit 会跳过 finally（Node 陷阱），故退出码先赋值、退出在函数返回后统一执行
    cleanup();
    console.log("  清理完成（进程 + 容器）");
  }
  process.exit(exitCode);
}

main().catch((e) => { console.error(`✗ 冒烟异常：${e.message}`); cleanup(); process.exit(1); });
