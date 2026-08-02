// verify-31：新用户按需开通（on-demand provisioning，ticket 31）
// 场景：仅预置存量用户 alice；新用户 carol 在认证表（POWERI_GATEWAY_USERS/WEB_USERS）但无 worker。
// carol 从 PowerI-Web 首次接入 → 网关自动创建 worker-carol + carol-pvc → 路由 → 数据落自己 PVC。
// 验证：新用户自动开新 worker / 与老用户数据不混淆 / 跑在另一个 worker 上。
// 前置：poweri-worker / poweri-gateway / poweri-web 镜像已构建；POWERI_AI_API_KEY 在环境。
// 用法：node scripts/verify-31.mjs [存量用户,新用户]（默认 alice,carol）
import { execFileSync } from "node:child_process";

const [OLD, NEW] = (process.argv[2] ?? "alice,carol").split(",").map((s) => s.trim());
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
  // 新用户首启：先等按需开通的 worker Ready（建 PVC/Deploy + pi 冷启动 ~1-2min），再轮询会话消息
  for (let i = 0; i < 60; i++) {
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

try {
  // 0. 预清理：删除新用户上次验证残留（模拟真实首次接入），并重置网关进程内缓存（rollout restart）
  console.log(`── 0. 预清理 ${NEW} 残留资源 ──`);
  for (const kind of ["deploy", "pvc", "svc"]) {
    const name = kind === "deploy" ? `worker-${NEW}` : kind === "pvc" ? `${NEW}-pvc` : `worker-${NEW}`;
    execFileSync("kubectl", ["delete", kind, name, "-n", NS, "--ignore-not-found=true"], { stdio: "ignore" });
  }

  // 1. 部署：只预置存量用户；新用户在认证表但无 worker
  console.log(`── 1. 部署（预置 ${OLD}；${NEW} 仅认证表）──`);
  execFileSync("node", ["scripts/gen-k8s.mjs", OLD, "--ui"],
    { env: { ...process.env, POWERI_GATEWAY_USERS: GW_USERS, POWERI_WEB_USERS: WEB_USERS }, stdio: "inherit" });
  // Secret 重建后网关 env 不热更：强制滚动以加载含新用户的 token 表
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

  // 2. 前置断言：新用户没有预置 worker，老用户有
  console.log(`── 2. 前置：${NEW} 无预置 worker ──`);
  ok(`部署后 ${NEW} 无 worker Deployment（未预置）`, !deployExists(`worker-${NEW}`));
  ok(`部署后 ${OLD} worker 存在（预置）`, deployExists(`worker-${OLD}`));

  // 3. 新用户首次接入：Web 登录 → 对话
  console.log(`── 3. ${NEW} 经 PowerI-Web 首次接入 ──`);
  const c = await chatRound(NEW, `poweri-${NEW}`);
  ok(`${NEW} 首次对话成功且有回答`, c.status === 200 && c.msgs >= 2 && c.answer.length > 0, `「${c.answer.slice(0, 10)}…」`);

  // 4. 按需开通生效：worker 自动出现
  console.log("── 4. 按需开通结果 ──");
  ok(`${NEW} 的 worker Deployment 自动创建`, deployExists(`worker-${NEW}`));
  ok(`${NEW} 的 PVC 自动创建`, (() => { try { return kubectl(["get", "pvc", `${NEW}-pvc`, "-n", NS]).length > 0; } catch { return false; } })());
  const ready = await (async () => {
    for (let i = 0; i < 20; i++) {
      const r = kubectl(["get", "deploy", `worker-${NEW}`, "-n", NS, "-o", "jsonpath={.status.readyReplicas}"]);
      if (r === "1") return true;
      await sleep(2000);
    }
    return false;
  })();
  ok(`${NEW} 的 worker Ready`, ready);

  // 5. 数据不混淆：各自会话只在自己 PVC
  console.log("── 5. 数据隔离 ──");
  const sessionsOn = (u) => {
    try { return kubectl(["exec", `deploy/worker-${u}`, "-n", NS, "--", "ls", "/home/piuser/.pi/agent/sessions"]).split("\n").map((s) => s.replace(/\.jsonl$/, "")).filter(Boolean); } catch { return []; }
  };
  const sNew = sessionsOn(NEW), sOld = sessionsOn(OLD);
  ok(`${NEW} 的会话落在 ${NEW} 的 worker PVC`, sNew.includes(c.sid), c.sid);
  ok(`${OLD} 的会话落在 ${OLD} 的 worker PVC（不受影响）`, sOld.length > 0 && !sOld.includes(c.sid), `${sOld.length} 个`);
  ok(`两 worker PVC 会话零重叠（数据不混淆）`, sNew.filter((s) => sOld.includes(s)).length === 0, `交集 0`);

  // 6. 跑在另一个 worker：Pod 不同
  console.log("── 6. 不同 worker ──");
  const podNew = kubectl(["get", "pods", "-n", NS, "-l", `user=${NEW}`, "-o", "jsonpath={.items[0].metadata.name}"]).split(" ")[0];
  const podOld = kubectl(["get", "pods", "-n", NS, "-l", `user=${OLD}`, "-o", "jsonpath={.items[0].metadata.name}"]).split(" ")[0];
  ok(`${NEW} 与 ${OLD} 运行在不同 worker Pod`, podNew && podOld && podNew !== podOld, `${podNew} vs ${podOld}`);

  console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
} finally {
  process.exit(failed ? 1 : 0);
}
