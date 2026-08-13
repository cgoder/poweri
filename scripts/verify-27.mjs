// verify-27：PowerI-Web UI 部署形态验证（ticket 27）
// 产品路径唯一化：K8s 内的 poweri-web（网关模式壳）→ 集群内 gateway Service → worker → 真实 pi
// 前置：POWERI_AI_API_KEY 在环境（gen-k8s 需要）；poweri-web:local 镜像已构建（ticket 26）
// 用法：node scripts/verify-27.mjs [users]
import { execFileSync } from "node:child_process";

const users = (process.argv[2] ?? "alice,bob").split(",");
const UI_USER = users[0];
const UI_PORT = 30341;
const PASS = process.env.POWERI_WEB_PASSWORD ?? `poweri-${UI_USER}`;
const auth = `Basic ${Buffer.from(`${UI_USER}:${PASS}`).toString("base64")}`; // ticket 28：每用户账号（POWERI_WEB_USERS 默认 poweri-<user>）
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

try {
  // 0. 旧形态废弃警告（先跑：gen-k8s 会重建 Secret，需在 --ui 部署前验证，避免丢 UI 键）
  // 注：旧形态镜像（poweri-piweb*:local）缺失时 rollout 等待会超时，仅验证警告文本故 25s 超时杀 + 吞退出码
  console.log("── 0. 旧形态废弃 ──");
  const deprecated = execFileSync("bash", ["-c", `timeout 25 node scripts/gen-k8s.mjs ${users.join(",")} --piweb 2>&1 || true`], { encoding: "utf8" });
  ok("--piweb 打印废弃警告", deprecated.includes("已废弃"));
  const deprecated2 = execFileSync("bash", ["-c", `timeout 25 node scripts/gen-k8s.mjs ${users.join(",")} --piweb2 2>&1 || true`], { encoding: "utf8" });
  ok("--piweb2 打印废弃警告", deprecated2.includes("已废弃"));

  // 1. 部署（含 --ui）
  console.log("── 1. 部署 gen-k8s.mjs --ui ──");
  execFileSync("node", ["scripts/gen-k8s.mjs", users.join(","), "--ui"], { stdio: "inherit" });

  // 2. 等 UI pod Ready（next start 首次编译 ~60s）
  console.log("── 2. 等待 poweri-web pod Ready ──");
  let ready = false;
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    const st = execFileSync("kubectl", ["get", "deploy", "poweri-web", "-n", "poweri", "-o", "jsonpath={.status.readyReplicas}"], { encoding: "utf8" }).trim();
    if (st === "1") { ready = true; break; }
  }
  ok("poweri-web Deployment Ready（replicas=1）", ready);

  // 3. 认证 + 接线
  console.log("── 3. 认证与网关接线 ──");
  const noAuth = await get("/");
  ok("无凭据拒绝（非 200）", noAuth.status !== 200, `HTTP ${noAuth.status}`);
  const authed = await get("/", { Authorization: auth });
  ok("Basic Auth 200", authed.status === 200, `HTTP ${authed.status}`);
  const models = await get("/api/models-config", { Authorization: auth });
  ok("模型面板单 poweri-gw/agent", models.status === 200 && models.body.includes('"poweri-gw"'));
  const sess = await get("/api/sessions", { Authorization: auth });
  let n = 0;
  try { n = JSON.parse(sess.body).sessions.length; } catch { }
  ok("会话列表经集群内网关非空（UI→gateway svc→worker）", sess.status === 200 && n > 0, `${n} 个会话`);

  // 4. 真实对话回合（经 UI 自身路由 → 网关 → worker → 真实 pi）
  console.log("── 4. 经 UI 的对话回合 ──");
  const nw = await post("/api/agent/new", { type: "prompt", message: "回复一个字：好" }, { Authorization: auth });
  let sid = "";
  try { sid = JSON.parse(nw.body).sessionId ?? ""; } catch { }
  ok("POST /api/agent/new 返回会话 id", nw.status === 200 && /^[0-9a-z]{6,9}-[0-9a-f]{8}$/.test(sid), sid ? `HTTP ${nw.status} sid=${sid}` : `HTTP ${nw.status}`);
  let msgs = 0, answer = "";
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    const h = await get(`/api/sessions/${sid}`, { Authorization: auth });
    try {
      const d = JSON.parse(h.body);
      msgs = (d.context?.messages ?? []).length;
      answer = d.context?.messages?.filter((m) => m.role === "assistant").map((m) => (m.content ?? []).filter((p) => p.type === "text").map((p) => p.text).join("")).join("") ?? "";
    } catch { }
    if (msgs >= 2) break;
  }
  ok("对话历史 >= 2 条（user+assistant）", msgs >= 2, `${msgs} 条`);
  ok("assistant 有真实回答", answer.length > 0, `「${answer.slice(0, 20)}…」`);


  console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
} finally {
  process.exit(failed ? 1 : 0);
}
