// verify-32：空闲超时缩容（ticket 31 遗留 → 32）
// 场景：动态用户 carol 按需开通 worker（verify-31 的"开"）→ 空闲超过 POWERI_WORKER_IDLE_MINUTES
// → 网关缩容 worker-carol 到 0（PVC 保留，数据不丢）→ carol 再次对话自动拉起（replicas 1，会话仍在）。
// 附带断言：静态预置用户 alice 常驻（HPA min=1 热备），不被缩容。
// 前置：poweri-worker / poweri-gateway / poweri-web 镜像已构建；POWERI_AI_API_KEY 在环境。
// 用法：node scripts/verify-32.mjs [存量用户,新用户]（默认 alice,carol）
import { execFileSync } from "node:child_process";

const [OLD, NEW] = (process.argv[2] ?? "alice,carol").split(",").map((s) => s.trim());
const IDLE_MIN = "1"; // 验证用短阈值；生产默认 30（gen-k8s 注入）
const GW_USERS = process.env.POWERI_GATEWAY_USERS ?? `${OLD}:token-${OLD};${NEW}:token-${NEW}`;
const WEB_USERS = process.env.POWERI_WEB_USERS ?? `${OLD}:poweri-${OLD};${NEW}:poweri-${NEW}`;
const UI_PORT = 30341;
const NS = "poweri";
const auth = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;
let passed = 0, failed = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`✓ ${name}${extra ? " — " + extra : ""}`); }
  else { failed++; console.log(`✗ ${name}${extra ? " — " + extra : ""}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kubectl = (args) => execFileSync("kubectl", args, { encoding: "utf8" }).trim();
const deployExists = (name) => { try { return kubectl(["get", "deploy", name, "-n", NS]).length > 0; } catch { return false; } };
const deployReplicas = (name) => { try { return Number(kubectl(["get", "deploy", name, "-n", NS, "-o", "jsonpath={.spec.replicas}"])); } catch { return -1; } };
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
async function chatRound(u, p) {
  const nw = await post("/api/agent/new", { type: "prompt", message: "回复一个字：好" }, { Authorization: auth(u, p) });
  let sid = "";
  try { sid = JSON.parse(nw.body).sessionId ?? ""; } catch { }
  if (nw.status !== 200 || !sid) return { status: nw.status, sid: "", msgs: 0, answer: "" };
  for (let i = 0; i < 60; i++) { // 拉起/开通的 worker Ready（冷启动 30-90s）
    let r = "";
    try { r = kubectl(["get", "deploy", `worker-${u}`, "-n", NS, "-o", "jsonpath={.status.readyReplicas}"]); } catch {}
    if (r === "1") break;
    await sleep(2000);
  }
  for (let i = 0; i < 60; i++) {
    await sleep(2500);
    const h = await get(`/api/sessions/${sid}`, { Authorization: auth(u, p) });
    try {
      const d = JSON.parse(h.body);
      const msgs = (d.context?.messages ?? []).length;
      const answer = (d.context?.messages ?? []).filter((m) => m.role === "assistant")
        .map((m) => (m.content ?? []).filter((p) => p.type === "text").map((p) => p.text).join("")).join("");
      if (msgs >= 2) return { status: h.status, sid, msgs, answer };
    } catch { }
  }
  return { status: 0, sid, msgs: 0, answer: "" };
}
const waitReplicas = async (name, want, tries, gap) => {
  for (let i = 0; i < tries; i++) {
    if (deployReplicas(name) === want) return true;
    await sleep(gap);
  }
  return deployReplicas(name) === want;
};

try {
  // 0. 预清理：删除新用户上次验证残留（模拟真实首次接入）
  console.log(`── 0. 预清理 ${NEW} 残留资源 ──`);
  for (const kind of ["deploy", "pvc", "svc"]) {
    const name = kind === "pvc" ? `${NEW}-pvc` : `worker-${NEW}`;
    execFileSync("kubectl", ["delete", kind, name, "-n", NS, "--ignore-not-found=true"], { stdio: "ignore" });
  }

  // 1. 部署：预置 OLD；NEW 仅认证表；空闲阈值压到 1min 以便验证
  console.log(`── 1. 部署（预置 ${OLD}；${NEW} 仅认证表；空闲阈值 ${IDLE_MIN}min）──`);
  execFileSync("node", ["scripts/gen-k8s.mjs", OLD, "--ui"],
    { env: { ...process.env, POWERI_GATEWAY_USERS: GW_USERS, POWERI_WEB_USERS: WEB_USERS, POWERI_WORKER_IDLE_MINUTES: IDLE_MIN }, stdio: "inherit" });
  execFileSync("kubectl", ["rollout", "restart", "deploy/gateway", "-n", NS], { stdio: "ignore" });
  execFileSync("kubectl", ["rollout", "status", "deploy/gateway", "-n", NS, "--timeout=120s"], { stdio: "inherit" });
  for (let i = 0; i < 30; i++) { // 等旧网关 pod 完全退出（避免请求打到正在被杀、provision 中断的旧 pod）
    const n = (() => { try { return kubectl(["get", "pods", "-n", NS, "-l", "role=gateway", "--no-headers"]).split("\n").filter((l) => l && l.includes("Running")).length; } catch { return 0; } })();
    if (n === 1) break;
    await sleep(2000);
  }
  for (let i = 0; i < 24; i++) { // 等 UI pod Ready（next 首次编译较慢）
    if (kubectl(["get", "deploy", "poweri-web", "-n", NS, "-o", "jsonpath={.status.readyReplicas}"]) === "1") break;
    await sleep(5000);
  }

  // 2. 前置断言
  console.log(`── 2. 前置：${NEW} 无预置 worker，${OLD} 常驻 ──`);
  ok(`部署后 ${NEW} 无 worker Deployment`, !deployExists(`worker-${NEW}`));
  ok(`部署后 ${OLD} worker 存在`, deployExists(`worker-${OLD}`));

  // 3. 新用户首次接入（按需开通，"开"）
  console.log(`── 3. ${NEW} 首次对话（按需开通）──`);
  const c1 = await chatRound(NEW, `poweri-${NEW}`);
  ok(`${NEW} 首次对话成功且有回答`, c1.status === 200 && c1.msgs >= 2 && c1.answer.length > 0, `「${c1.answer.slice(0, 10)}…」`);
  ok(`${NEW} worker 自动开通且 Ready`, await waitReplicas(`worker-${NEW}`, 1, 10, 2000), `replicas=${deployReplicas(`worker-${NEW}`)}`);

  // 4. 空闲超时 → 缩容到 0（PVC 保留）
  console.log(`── 4. 空闲 ${IDLE_MIN}min 后缩容 ──`);
  ok(`${NEW} worker 空闲后缩容到 0`, await waitReplicas(`worker-${NEW}`, 0, 45, 5000), `replicas=${deployReplicas(`worker-${NEW}`)}`);
  ok(`${NEW} 的 PVC 保留（数据不随缩容删除）`, (() => { try { return kubectl(["get", "pvc", `${NEW}-pvc`, "-n", NS]).length > 0; } catch { return false; } })());
  ok(`${OLD} 静态 worker 常驻（未被缩容）`, deployReplicas(`worker-${OLD}`) >= 1, `replicas=${deployReplicas(`worker-${OLD}`)}`);

  // 5. 再次对话 → 自动拉起（"关"后能再"开"，数据不丢）
  console.log(`── 5. ${NEW} 再次对话（自动拉起）──`);
  const c2 = await chatRound(NEW, `poweri-${NEW}`);
  ok(`${NEW} worker 自动拉起且 Ready`, await waitReplicas(`worker-${NEW}`, 1, 10, 2000), `replicas=${deployReplicas(`worker-${NEW}`)}`);
  ok(`${NEW} 再次对话成功`, c2.status === 200 && c2.msgs >= 2 && c2.answer.length > 0, `「${c2.answer.slice(0, 10)}…」`);
  const sessionsNow = (() => {
    try { return kubectl(["exec", `deploy/worker-${NEW}`, "-n", NS, "--", "ls", "/home/piuser/.pi/agent/sessions"]).split("\n").map((s) => s.replace(/\.jsonl$/, "")).filter(Boolean); } catch { return []; }
  })();
  ok(`缩容前会话仍在 PVC 上（数据未丢）`, sessionsNow.includes(c1.sid), `${c1.sid} → ${sessionsNow.join(",") || "无"}`);

  console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
} finally {
  process.exit(failed ? 1 : 0);
}
