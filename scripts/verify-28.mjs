// verify-28：UI↔网关认证打通验证（ticket 28）
// 每用户账号（POWERI_WEB_USERS）→ 网关 token 映射 → 各自 worker PVC 数据隔离
// 前置：POWERI_AI_API_KEY 在环境；poweri-web:local 镜像已重建（ticket 28 认证改造）
// 用法：node scripts/verify-28.mjs [users]
import { execFileSync } from "node:child_process";

const users = (process.argv[2] ?? "alice,bob").split(",");
const [U1, U2] = [users[0], users[1]];
const P1 = `poweri-${U1}`, P2 = `poweri-${U2}`;
const UI_PORT = 30341;
const auth = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;
let passed = 0, failed = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`✓ ${name}${extra ? " — " + extra : ""}`); }
  else { failed++; console.log(`✗ ${name}${extra ? " — " + extra : ""}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(path, headers = {}) {
  try {
    const res = await fetch(`http://127.0.0.1:${UI_PORT}${path}`, { headers });
    return { status: res.status, body: await res.text() };
  } catch (e) { return { status: 0, body: String(e) }; }
}
async function post(path, body, headers = {}) {
  try {
    const res = await fetch(`http://127.0.0.1:${UI_PORT}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.text() };
  } catch (e) { return { status: 0, body: String(e) }; }
}
function sessionIds(body) {
  try { return (JSON.parse(body).sessions ?? []).map((s) => s.id); } catch { return []; }
}
async function chatRound(u, p) {
  const nw = await post("/api/agent/new", { type: "prompt", message: "回复一个字：好" }, { Authorization: auth(u, p) });
  let sid = "";
  try { sid = JSON.parse(nw.body).sessionId ?? ""; } catch { }
  if (nw.status !== 200 || !sid.startsWith("msb")) return { status: nw.status, msgs: 0, answer: "" };
  let msgs = 0, answer = "";
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    const h = await get(`/api/sessions/${sid}`, { Authorization: auth(u, p) });
    try {
      const d = JSON.parse(h.body);
      msgs = (d.context?.messages ?? []).length;
      answer = d.context?.messages?.filter((m) => m.role === "assistant").map((m) => (m.content ?? []).filter((p2) => p2.type === "text").map((p2) => p2.text).join("")).join("") ?? "";
    } catch { }
    if (msgs >= 2) break;
  }
  return { status: 200, msgs, answer, sid };
}

try {
  // 1. 部署（--ui，每用户账号表默认 alice:poweri-alice;bob:poweri-bob）
  console.log("── 1. 部署 gen-k8s.mjs --ui ──");
  execFileSync("node", ["scripts/gen-k8s.mjs", users.join(","), "--ui"], { stdio: "inherit" });

  // 等 UI pod Ready（next start 首次编译 ~60s）
  console.log("── 等待 poweri-web pod Ready ──");
  let uiReady = false;
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    const st = execFileSync("kubectl", ["get", "deploy", "poweri-web", "-n", "poweri", "-o", "jsonpath={.status.readyReplicas}"], { encoding: "utf8" }).trim();
    if (st === "1") { uiReady = true; break; }
  }
  ok("poweri-web pod Ready", uiReady);

  // 2. 认证边界
  console.log("── 2. 认证边界 ──");
  ok("无凭据 401", (await get("/")).status !== 200);
  ok("未知用户 401", (await get("/", { Authorization: auth("carol", "x") })).status !== 200);
  ok("密码错误 401", (await get("/", { Authorization: auth(U1, "wrong") })).status !== 200);
  ok(`${U1} 正确凭据 200`, (await get("/", { Authorization: auth(U1, P1) })).status === 200);
  ok(`${U2} 正确凭据 200`, (await get("/", { Authorization: auth(U2, P2) })).status === 200);

  // 3. 数据隔离：各自会话列表（请求级 token 路由到各自 worker）
  console.log("── 3. 会话隔离 ──");
  const s1 = await get("/api/sessions", { Authorization: auth(U1, P1) });
  const s2 = await get("/api/sessions", { Authorization: auth(U2, P2) });
  const ids1 = sessionIds(s1.body), ids2 = sessionIds(s2.body);
  ok(`${U1} 会话列表非空`, s1.status === 200 && ids1.length > 0, `${ids1.length} 个`);
  ok(`${U2} 会话列表非空`, s2.status === 200 && ids2.length > 0, `${ids2.length} 个`);
  const overlap = ids1.filter((id) => ids2.includes(id));
  ok(`两用户会话 id 完全不重叠（token 路由隔离）`, overlap.length === 0, `交集 ${overlap.length}`);

  // 4. 各自对话回合 → 各自 worker 落盘
  console.log("── 4. 各自对话回合 ──");
  const c1 = await chatRound(U1, P1);
  ok(`${U1} 对话成功且有回答`, c1.status === 200 && c1.msgs >= 2 && c1.answer.length > 0, `「${c1.answer.slice(0, 10)}…」`);
  const c2 = await chatRound(U2, P2);
  ok(`${U2} 对话成功且有回答`, c2.status === 200 && c2.msgs >= 2 && c2.answer.length > 0, `「${c2.answer.slice(0, 10)}…」`);

  // 5. 会话落各自 PVC（网关会话文件在工作目录）
  console.log("── 5. 落盘位置 ──");
  for (const [u, sid] of [[U1, c1.sid], [U2, c2.sid]]) {
    let found = "";
    try {
      const out = execFileSync("kubectl", ["exec", `deploy/worker-${u}`, "-n", "poweri", "--", "ls", "/home/piuser/.pi/agent/sessions"], { encoding: "utf8" });
      found = out.split("\n").find((l) => l.includes(sid)) ?? "";
    } catch { }
    ok(`${u} 的新会话落在 ${u} 的 worker PVC`, found.length > 0, sid);
  }

  console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
} finally {
  process.exit(failed ? 1 : 0);
}
