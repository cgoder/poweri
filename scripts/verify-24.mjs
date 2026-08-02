// verify-24：pi-web (agegr) 壳提炼 → 网关 → worker 全链路验证
// 前置：fork 以网关模式运行（POWERI_GATEWAY_URL/TOKEN/CWD），网关/worker 已部署（ticket 23）
// 运行：node scripts/verify-24.mjs
import { execFileSync } from "node:child_process";
import { createParser } from "eventsource-parser";

const BASE = "http://127.0.0.1:30161";
const AUTH = "Basic " + Buffer.from("pi:poweri-alice").toString("base64");
const GATEWAY = "http://127.0.0.1:31080";

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m, d) => { fail++; console.log(`  ✗ ${m}${d ? " — " + String(d).slice(0, 250) : ""}`); };

const j = async (path, opts = {}) => {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { Authorization: AUTH, ...(opts.headers ?? {}) } });
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const execK8s = (cmd) => { try { return execFileSync("kubectl", ["exec", "-n", "poweri", "deploy/worker-alice", "--", "sh", "-c", cmd], { encoding: "utf8" }); } catch { return ""; } };

// 订阅 events + prompt，等 prompt_done（浏览器真实流式路径）
async function promptAndWait(sid, message, timeoutMs = 180_000) {
  const ac = new AbortController();
  const evRes = await fetch(`${BASE}/api/agent/${encodeURIComponent(sid)}/events`, { headers: { Authorization: AUTH }, signal: ac.signal });
  const reader = evRes.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  // 增量 SSE 解析走 eventsource-parser（业界标准），不手撸切帧
  const parser = createParser({ onEvent: (msg) => {
    try { events.push(JSON.parse(msg.data)); } catch { /* 非 JSON data 帧忽略 */ }
  } });
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
    } catch { /* abort 后正常退出 */ }
  })();
  const r = await j(`/api/agent/${sid}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "prompt", message }) });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !events.some((e) => e.type === "prompt_done")) await sleep(500);
  ac.abort();
  await sleep(300); // 让上一轮残留事件 drain，避免串到下一个订阅
  const text = events.filter((e) => e.type === "message_update").map((e) => (e.message?.content ?? []).filter((p) => p.type === "text").map((p) => p.text).join("")).filter(Boolean).at(-1) ?? "";
  return { post: r, events, text };
}

console.log(`\n=== verify-24 pi-web (agegr) @ ${BASE} ===`);

// 1. 认证
const noAuth = await fetch(`${BASE}/`); noAuth.status === 401 ? ok("1 无认证 → 401") : bad("1 无认证", noAuth.status);
const authed = await fetch(`${BASE}/`, { headers: { Authorization: AUTH } });
authed.status === 200 ? ok("1b 认证 → 200") : bad("1b 认证", authed.status);

// 2. 会话树来自网关（worker PVC msb* 会话可见）
const sessions = await j("/api/sessions");
const sessArr = Array.isArray(sessions.body?.sessions) ? sessions.body.sessions : sessions.body?.data;
if (sessions.status === 200 && Array.isArray(sessArr) && sessArr.length > 0 && sessArr.some((s) => /^msb/.test(String(s.id ?? "")))) {
  ok(`2 会话树来自网关：${sessArr.length} 个会话（含 msb* worker 链会话）`);
} else bad("2 会话树", `status=${sessions.status}`);

// 3. 模型为 poweri-gw/agent（不初始化宿主 SDK）
const models = await j("/api/models");
const ml = Array.isArray(models.body?.modelList) ? models.body.modelList : [];
ml.some((m) => m.provider === "poweri-gw" && m.id === "agent")
  ? ok(`3 模型列表 ${ml.length} 项，poweri-gw/agent 在位`) : bad("3 模型", JSON.stringify(models.body).slice(0, 150));

// 4. 默认工作区 = /workspace（worker PVC 路径，免手动选目录）
const dc = await j("/api/default-cwd", { method: "POST" });
dc.body?.cwd === "/workspace" ? ok("4 default-cwd → /workspace") : bad("4 default-cwd", JSON.stringify(dc.body));

// 历史条数（轮询等 worker 落盘：prompt_done 后 JSONL 写入可能滞后数秒）
async function historyCount(sid, expectAtLeast, timeoutMs = 20_000) {
  const dl = Date.now() + timeoutMs;
  let n = 0;
  while (Date.now() < dl) {
    const h = await j(`/api/sessions/${sid}`);
    n = Array.isArray(h.body?.context?.messages) ? h.body.context.messages.length : 0;
    if (n >= expectAtLeast) return n;
    await sleep(1500);
  }
  return n;
}

// 5. 新会话（浏览器真实流程：new 带首个 prompt → 拿 sid）
const c1 = await j("/api/agent/new", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: "/workspace", type: "prompt", message: "回复一个字：壳" }) });
const realSid = c1.body?.sessionId;
if (c1.status === 200 && realSid && /^msb/.test(realSid)) {
  ok(`5a 新会话经网关创建 → ${realSid}`);

  // 5b/5c. 续聊路径流式 + 渲染文本
  const c2 = await promptAndWait(realSid, "回复两个字：流式");
  const evTypes = [...new Set(c2.events.map((e) => e.type))];
  const hasUpdate = evTypes.includes("message_update");
  const hasAgentEnd = evTypes.includes("agent_end") || evTypes.includes("agent_settled");
  hasUpdate && hasAgentEnd
    ? ok(`5b 流式事件齐（续聊路径）：${evTypes.join(",")}`) : bad("5b 流式", `types=${evTypes.join(",")}`);
  c2.text ? ok(`5c 渲染文本：${JSON.stringify(c2.text.slice(0, 40))}`) : bad("5c 渲染文本", "无 text 块");

  // 6. 历史经网关（context.messages 含 user+assistant；轮询等两轮落盘）
  const n1 = await historyCount(realSid, 2);
  n1 >= 2
    ? ok(`6 历史经网关：${n1} 条（user+assistant）`) : bad("6 历史", `n=${n1}`);

  // 7. 续接：同 id 再 prompt，历史增长且回答非空（验证点 3：上下文延续）
  const c3 = await promptAndWait(realSid, "我刚才让你回复了几个字？答一个数字，只答数字");
  const n2 = await historyCount(realSid, n1 + 2);
  c3.post.status === 200 && n2 >= n1 + 2 && c3.text
    ? ok(`7 续接同会话：历史 ${n1}→${n2} 条，模型答 "${c3.text.trim().slice(0, 30)}"（上下文延续）`)
    : bad("7 续接", `n2=${n2} text="${c3.text.trim()}"`);

  // 8. 并行：两个全新会话同时跑（验证点 4：互不阻塞）
  const t0 = Date.now();
  const [p1, p2] = await Promise.all([
    j("/api/agent/new", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: "/workspace", type: "prompt", message: "回复一个字：一" }) }),
    j("/api/agent/new", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: "/workspace", type: "prompt", message: "回复一个字：二" }) }),
  ]);
  const wall = (Date.now() - t0) / 1000;
  const ids = [p1.body?.sessionId, p2.body?.sessionId];
  ids.every((x) => x && /^msb/.test(x)) && new Set(ids).size === 2 && wall < 45
    ? ok(`8 并行：${ids.join(" / ")} 同时创建完成（${wall.toFixed(1)}s，互不阻塞）`)
    : bad("8 并行", `ids=${ids} wall=${wall.toFixed(1)}s`);

  // 9. 记忆累积（验证点 5）：worker 侧 user-memory 扩展照常工作
  const memBefore = execK8s("grep -c '幸运数字' /workspace/.poweri/memory/memory.md || true").trim() || "0";
  await promptAndWait(realSid, "记住一条事实：我的幸运数字是 42");
  await sleep(3000);
  const memAfter = execK8s("grep '幸运数字' /workspace/.poweri/memory/memory.md || true").trim();
  memAfter.includes("42")
    ? ok(`9 记忆累积：worker memory.md 已写入「${memAfter.split("\n").at(-1)?.slice(0, 50)}」（网关链实测）`)
    : bad("9 记忆累积", `before=${memBefore} after="${memAfter.slice(0, 80)}"`);

  // 10. 计量（验证点 6）：本次对话前后记录差 > 0
  const usageOf = async () => {
    const r = await fetch(`${GATEWAY}/v1/admin/usage?userId=alice`, { headers: { Authorization: "Bearer admin-token" } });
    const b = await r.json();
    return (Array.isArray(b?.records) ? b.records : []).length;
  };
  const uBefore = await usageOf();
  await promptAndWait(realSid, "回复一个字：计");
  const uAfter = await usageOf();
  uAfter > uBefore ? ok(`10 网关计量增量：${uBefore} → ${uAfter} 条（本次对话已记录）`) : bad("10 计量", `${uBefore} → ${uAfter}`);
} else {
  bad("5 新会话", `status=${c1.status} body=${JSON.stringify(c1.body).slice(0, 200)}`);
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
