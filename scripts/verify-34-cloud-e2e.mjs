// verify-34：云端全链路冒烟（ticket 10 部署闭环）——web（网关模式）→ gateway → worker pod → pi → 真实模型
// 与 verify-33 同款断言（认证守卫/新建会话/流式/工具可见/续接/多用户隔离），但目标为云端 k3s NodePort
// 公网安全组未放行 NodePort → 自建 ssh 隧道（31080/30341）访问，结束自动清理
// 前置：node scripts/deploy-cloud.mjs <tag> 已部署（或云端已在跑）；SSH_HOST/SSH_PORT/SSH_KEY 同 deploy-cloud
// 运行：node scripts/verify-34-cloud-e2e.mjs
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SSH_HOST = process.env.SSH_HOST ?? "118.178.241.158";
const SSH_PORT = process.env.SSH_PORT ?? "10086";
const SSH_KEY = process.env.SSH_KEY ?? path.join(ROOT, ".scratch", "deploy-key", "poweri_ecs");
const GW_PORT = 31080; // 云端 NodePort（gateway）
const WEB_PORT = 30341; // 云端 NodePort（poweri-web）
const GW_BASE = `http://127.0.0.1:${GW_PORT}`;
const WEB_BASE = `http://127.0.0.1:${WEB_PORT}`;
const USERS = { alice: { pass: "poweri-alice", token: "token-a" }, bob: { pass: "poweri-bob", token: "token-b" } };
const PROMPT = "请用 bash 工具列出 /workspace 下的文件，然后用一句话总结，用中文回答";
const TIMEOUT_MS = 300_000;

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m, d) => { fail++; console.log(`  ✗ ${m}${d ? ` — ${String(d).slice(0, 300)}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const auth = (u) => ({ Authorization: `Basic ${Buffer.from(`${u}:${USERS[u].pass}`).toString("base64")}` });

// ── ssh 隧道（VERIFY_NO_TUNNEL=1 时跳过——gitlab CI 在节点本地直接访问 NodePort）──
let tunnel = null;
if (process.env.VERIFY_NO_TUNNEL !== "1") {
  tunnel = spawn("ssh", [
    "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "ExitOnForwardFailure=yes", "-o", "ConnectTimeout=8",
    "-N", "-p", SSH_PORT,
    "-L", `${GW_PORT}:127.0.0.1:${GW_PORT}`, "-L", `${WEB_PORT}:127.0.0.1:${WEB_PORT}`,
    `root@${SSH_HOST}`,
  ], { stdio: "ignore" });
  process.on("exit", () => { try { tunnel.kill(); } catch {} });
}

async function waitFor(url, label, { timeout = 30_000, expect = 200 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status === expect) return true;
    } catch {}
    await sleep(1500);
  }
  console.error(`✗ ${label} 未就绪（期望 HTTP ${expect}，${timeout / 1000}s）`);
  process.exit(1);
}

// ── SSE 事件收集（同 verify-33）──
async function collectEvents(url, init, { until, onFirst, timeout = 180_000 } = {}) {
  const events = [];
  const res = await fetch(url, init);
  if (!res.ok || !res.body) return { events, status: res.status };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const deadline = Date.now() + timeout;
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
    if (until && until(events)) break;
  }
  await reader.cancel().catch(() => {});
  return { events, status: res.status };
}

// ── 主流程 ──
async function main() {
  let exitCode = 1;
  console.log(`\n=== verify-34 云端全链路冒烟 @ web:${WEB_PORT} gw:${GW_PORT}（${SSH_HOST} 隧道） ===`);
  try {
    await waitFor(`${GW_BASE}/readyz`, "gateway", { timeout: 30_000 });
    await waitFor(WEB_BASE, "web", { timeout: 60_000, expect: 401 });
    console.log("  隧道就绪（gateway readyz + web 守卫在线）");

    // 1. 认证守卫
    const noAuth = await fetch(`${WEB_BASE}/api/sessions`);
    noAuth.status === 401 ? ok("1 无认证 → 401（proxy 网关模式守卫）") : bad("1 无认证 401", `status=${noAuth.status}`);
    const badAuth = await fetch(`${WEB_BASE}/api/sessions`, { headers: { Authorization: `Basic ${Buffer.from("alice:wrong").toString("base64")}` } });
    badAuth.status === 401 ? ok("1 错误密码 → 401") : bad("1 错误密码 401", `status=${badAuth.status}`);

    // 2. 新建会话 + 流式真实回复（云端 worker pod 链路）
    const newRes = await fetch(`${WEB_BASE}/api/agent/new`, { method: "POST", headers: { ...auth("alice"), "Content-Type": "application/json" }, body: JSON.stringify({ cwd: "/workspace", type: "ensure_session" }) });
    const newBody = await newRes.json();
    const tempKey = newBody.sessionId;
    if (!(newRes.status === 200 && tempKey)) { bad("2 新建会话", `${newRes.status} ${JSON.stringify(newBody).slice(0, 120)}`); return; }
    ok(`2 新建会话 → ${tempKey.slice(0, 20)}…`);

    let streamOpen = false;
    const streamP = collectEvents(`${WEB_BASE}/api/agent/${encodeURIComponent(tempKey)}/events`, { headers: auth("alice") }, { until: (evs) => evs.some((e) => e.type === "agent_settled" || e.type === "prompt_done"), onFirst: () => { streamOpen = true; }, timeout: 180_000 });
    const subDeadline = Date.now() + 20_000;
    while (!streamOpen && Date.now() < subDeadline) await sleep(200);
    if (!streamOpen) { bad("2 事件流订阅未建立", "20s 内未收到首个事件（connected）"); return; }

    const promptRes = await fetch(`${WEB_BASE}/api/agent/${encodeURIComponent(tempKey)}`, { method: "POST", headers: { ...auth("alice"), "Content-Type": "application/json" }, body: JSON.stringify({ type: "prompt", message: PROMPT }) });
    const promptBody = await promptRes.json();
    if (!(promptRes.status === 200 && promptBody.success)) { bad("2 发消息", `${promptRes.status} ${JSON.stringify(promptBody).slice(0, 120)}`); return; }
    const { events } = await streamP;
    const types = {};
    for (const e of events) types[e.type] = (types[e.type] ?? 0) + 1;
    const msb = events.find((e) => e.type === "session_created")?.sessionId;
    const textDelta = events.filter((e) => e.type === "message_update" && e.assistantMessageEvent?.type === "text_delta").map((e) => e.assistantMessageEvent.delta).join("");
    const toolRun = events.some((e) => e.type === "tool_execution_start" || e.type === "tool_execution_end");
    const gotEvents = events.some((e) => e.type === "agent_settled" || e.type === "prompt_done");
    (msb && /^[a-z0-9]{6,10}-[a-z0-9]{8}$/.test(msb)) ? ok(`2 事件流 → session_created ${msb.slice(0, 18)}…`) : bad("2 session_created msb id", `msb=${msb}`);
    gotEvents ? ok(`2 事件流完整（${JSON.stringify(types)}）`) : bad("2 事件流未收敛", `types=${JSON.stringify(types)}`);
    toolRun ? ok("2 工具调用过程可见（tool_execution_start/end）") : bad("2 工具调用事件缺失", "模型可能未触发工具");
    textDelta.length > 0 ? ok(`2 流式文本 ${textDelta.length} 字符：${textDelta.slice(0, 60)}…`) : bad("2 流式文本为空", "真实模型未输出文本 delta");
    const msbId = msb;
    console.log(`  回复预览: ${textDelta.slice(0, 120)}`);

    // 3. 会话续接（重开页面：历史读取）
    const histRes = await fetch(`${WEB_BASE}/api/sessions/${msbId}?deferThinking=1&deferMedia=1`, { headers: auth("alice") });
    const hist = await histRes.json();
    const msgs = hist.context?.messages ?? [];
    const hasUser = msgs.some((m) => m.role === "user" && JSON.stringify(m.content ?? "").includes("bash 工具"));
    const assistantTexts = msgs.filter((m) => m.role === "assistant").flatMap((m) => m.content ?? []).filter((c) => c.type === "text").map((c) => c.text);
    const hasAssistant = assistantTexts.some((t) => t.length > 20);
    const hasToolResult = msgs.some((m) => m.role === "toolResult");
    const histAssistant = assistantTexts.join("").replace(/\s+/g, "");
    const histMatchesStream = histAssistant.length > 20 && histAssistant.includes(textDelta.replace(/\s+/g, "").slice(0, 20));
    (histRes.status === 200 && msgs.length >= 2) ? ok(`3 历史读取 ${msgs.length} 条消息（重开页面续接）`) : bad("3 历史读取", `status=${histRes.status} n=${msgs.length}`);
    (hasUser && hasAssistant) ? ok("3 历史内容完整（user 原文 + assistant 回复）") : bad("3 历史内容", `user=${hasUser} assistant=${hasAssistant}`);
    hasToolResult ? ok("3 历史含 toolResult（工具调用输出持久化）") : bad("3 历史 toolResult 缺失");
    histMatchesStream ? ok("3 历史 assistant 文本与流式回复一致") : bad("3 历史与流式不一致", `hist=${histAssistant.slice(0, 60)} stream=${textDelta.replace(/\s+/g, "").slice(0, 60)}`);

    // 4. 多用户隔离（云端用户可能有历史会话：断言 bob 列表不含 alice 会话 + 跨用户读取 404）
    const bobList = await (await fetch(`${WEB_BASE}/api/sessions?force=1`, { headers: auth("bob") })).json();
    const bobIds = (bobList.sessions ?? []).map((s) => s.id);
    !bobIds.includes(msbId) ? ok(`4 bob 列表不含 alice 会话（${bobIds.length} 个 bob 会话，token 隔离）`) : bad("4 bob 列表含 alice 会话", `n=${bobIds.length}`);
    const bobRead = await fetch(`${WEB_BASE}/api/sessions/${msbId}?deferThinking=1`, { headers: auth("bob") });
    bobRead.status === 404 ? ok("4 bob 读 alice 会话 → 404（跨用户隔离）") : bad("4 bob 跨用户读", `status=${bobRead.status}`);

    console.log(`\n结果：${fail === 0 ? "PASS" : "FAIL"}（${pass} 通过 / ${fail} 失败，上限 ${TIMEOUT_MS / 1000}s 内完成）`);
    exitCode = fail === 0 ? 0 : 1;
  } finally {
    if (tunnel) tunnel.kill();
  }
  process.exit(exitCode);
}
main();
