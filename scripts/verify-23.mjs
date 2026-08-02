// verify-23：Gateway 会话列表/历史 API（k8s provider）集成验证
// 前置：worker+gateway 已用新镜像 rollout（bridge HTTP 面 + /v1/sessions + messages 修复）
// 运行：node scripts/verify-23.mjs
const BASE = "http://127.0.0.1:31080";
const USERS = { alice: "token-a", bob: "token-b" };
const NEW_SESSION_MARKER = `v23-${Date.now().toString(36)}`;

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m, detail) => { fail++; console.log(`  ✗ ${m}${detail ? ` — ${String(detail).slice(0, 300)}` : ""}`); };

async function api(path, token) {
  const res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

console.log(`\n=== verify-23 @ ${BASE} ===`);

// 1. 无 token → 401
const noAuth = await api("/v1/sessions");
noAuth.status === 401 ? ok("1 无 token → 401") : bad("1 无 token", `status=${noAuth.status}`);

// 2. alice 会话列表（k8s 经 bridge HTTP 面读 PVC）
const list = await api("/v1/sessions", USERS.alice);
const sessions = Array.isArray(list.body?.sessions) ? list.body.sessions : null;
if (list.status === 200 && sessions) {
  const wellFormed = sessions.every((s) => typeof s.id === "string" && s.id && typeof s.modified === "string");
  const hasGatewayFlat = sessions.some((s) => /^msb/.test(s.id)); // alice 有 worker 链平铺 gateway 会话
  const fieldsComplete = sessions.some((s) => typeof s.created === "string" && s.created && typeof s.messageCount === "number" && s.messageCount > 0 && typeof s.firstMessage === "string");
  wellFormed && hasGatewayFlat && fieldsComplete
    ? ok(`2 GET /v1/sessions (alice) → ${sessions.length} 个会话（含 msb* 平铺，字段完整）`)
    : bad("2 列表字段", `wellFormed=${wellFormed} hasMsb=${hasGatewayFlat} fields=${fieldsComplete} 样例=${JSON.stringify(sessions[0])}`);
  const sample = sessions[0];
  console.log(`  样例: id=${sample.id} cwd=${sample.cwd} count=${sample.messageCount} first="${(sample.firstMessage ?? "").slice(0, 30)}"`);
} else {
  bad("2 GET /v1/sessions (alice)", `status=${list.status} body=${JSON.stringify(list.body).slice(0, 200)}`);
}

// 3. 会话历史（修复 k8s 404）
const sid = sessions?.[0]?.id;
if (sid) {
  const hist = await api(`/v1/sessions/${sid}/messages`, USERS.alice);
  const msgs = Array.isArray(hist.body?.messages) ? hist.body.messages : null;
  hist.status === 200 && msgs && msgs.length > 0
    ? ok(`3 GET /v1/sessions/${sid}/messages → ${msgs.length} 条真实消息（不再 404）`)
    : bad("3 会话历史", `status=${hist.status} body=${JSON.stringify(hist.body).slice(0, 200)}`);
} else {
  bad("3 会话历史", "无会话可测（列表为空）");
}

// 4. 用户隔离（双向非空洞：先给 bob 建一个会话，再交叉断言双方列表无泄漏）
const bobChat = await fetch(`${BASE}/v1/chat`, {
  method: "POST",
  headers: { Authorization: `Bearer ${USERS.bob}`, "Content-Type": "application/json" },
  body: JSON.stringify({ session: "new", message: "回复一个字：bob" }),
});
const bobRaw = await bobChat.text();
let bobNewId = null;
const bl = bobRaw.split("\n");
for (let i = 0; i < bl.length; i++) if (bl[i] === "event: ready" && bl[i + 1]?.startsWith("data: ")) bobNewId = JSON.parse(bl[i + 1].slice(6)).sessionId;
const bobList2 = await api("/v1/sessions", USERS.bob);
const bobSessions2 = Array.isArray(bobList2.body?.sessions) ? bobList2.body.sessions : [];
const aliceIds2 = new Set((await api("/v1/sessions", USERS.alice)).body?.sessions?.map((s) => s.id) ?? []);
const leakAtoB = bobSessions2.filter((s) => aliceIds2.has(s.id));
const leakBtoA = bobNewId ? [...aliceIds2].filter((id) => id === bobNewId) : [];
bobSessions2.length > 0 && leakAtoB.length === 0 && leakBtoA.length === 0
  ? ok(`4 用户隔离：bob ${bobSessions2.length} 个会话（含新建 ${bobNewId}），双向无泄漏`)
  : bad("4 用户隔离", `bob=${bobSessions2.length} leakAtoB=${leakAtoB.map((s) => s.id).join(",")} leakBtoA=${leakBtoA.join(",")}`);

// 5. 端到端：新建会话后出现在列表（bridge HTTP 面读到新文件）
console.log("\n  …发起一次新会话（session:new）…");
const chat = await fetch(`${BASE}/v1/chat`, {
  method: "POST",
  headers: { Authorization: `Bearer ${USERS.alice}`, "Content-Type": "application/json" },
  body: JSON.stringify({ session: "new", message: `回复两个字：${NEW_SESSION_MARKER}` }),
});
let readyId = null, text = "";
// 手写 SSE 帧解析（event: ready + data 行）
const raw = await chat.text();
const lines = raw.split("\n");
for (let i = 0; i < lines.length; i++) {
  if (lines[i] === "event: ready" && lines[i + 1]?.startsWith("data: ")) readyId = JSON.parse(lines[i + 1].slice(6)).sessionId;
  if (lines[i].startsWith("data: ")) {
    try {
      const d = JSON.parse(lines[i].slice(6));
      if (d.type === "message_end" && d.message?.role === "assistant") text = d.message.content?.map((c) => c.type === "text" ? c.text : "").join("") ?? "";
    } catch {}
  }
}
if (readyId) {
  ok(`5 新会话创建 → sessionId=${readyId}`);
  const list2 = await api("/v1/sessions", USERS.alice);
  const found = (list2.body?.sessions ?? []).some((s) => s.id === readyId);
  found ? ok(`  新会话出现在 /v1/sessions（count=${list2.body.sessions.length}）`) : bad("  新会话出现在列表", `id=${readyId}`);
  const hist2 = await api(`/v1/sessions/${readyId}/messages`, USERS.alice);
  (hist2.status === 200 && hist2.body?.messages?.length >= 2) ? ok(`  新会话历史 ${hist2.body.messages.length} 条（user+assistant）`) : bad("  新会话历史", `status=${hist2.status} len=${hist2.body?.messages?.length}`);
} else {
  bad("5 新会话创建", `无 ready 事件（chat HTTP ${chat.status}）`);
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
