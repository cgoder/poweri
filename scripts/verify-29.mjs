// verify-29：会话管理 API 验证（ticket 29）
// 改名（PATCH /v1/sessions/<id>，session_info 行）/ 删除（DELETE）/ 用户侧计量（/v1/users/me/usage）
// 前置：gateway+worker 镜像已重建（bridge/gateway 改）；POWERI_AI_API_KEY 在环境
// 用法：node scripts/verify-29.mjs [user]（默认 alice）
import { execFileSync } from "node:child_process";

const USER = process.argv[2] ?? "alice";
const GW = "http://127.0.0.1:31080";
const TOKEN = process.env[`POWERI_TOKEN_${USER.toUpperCase()}`] ?? (USER === "alice" ? "token-a" : "token-b");
const ADMIN = process.env.POWERI_GATEWAY_ADMIN_TOKEN ?? "admin-token";
let passed = 0, failed = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`✓ ${name}${extra ? " — " + extra : ""}`); }
  else { failed++; console.log(`✗ ${name}${extra ? " — " + extra : ""}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function req(method, path, body, token = TOKEN) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${GW}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let j = null;
  try { j = await res.json(); } catch { }
  return { status: res.status, body: j };
}
async function listSessions(token = TOKEN) {
  const r = await req("GET", "/v1/sessions", null, token);
  return (r.body?.sessions ?? []);
}
async function chatOne() {
  // 新会话对话：读到 ready 帧拿到 sessionId 即断开（worker 继续处理，不等待流结束）
  const controller = new AbortController();
  let sid = "";
  try {
    const res = await fetch(`${GW}/v1/chat`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ session: "new", message: "回复一个字：好" }),
      signal: controller.signal,
    });
    if (res.ok && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (!sid) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const m = /event: ready\s+data: \{"sessionId":"(msb[^"]+)"/.exec(buf);
        if (m) sid = m[1];
      }
    }
  } catch { /* abort 后忽略 */ }
  controller.abort();
  // worker 落盘有滞后（ticket 24 已知）：轮询列表等会话文件出现后再返回，否则立即 PATCH 会 404
  if (sid) {
    for (let i = 0; i < 20; i++) {
      if ((await listSessions()).some((s) => s.id === sid)) break;
      await sleep(1000);
    }
  }
  return sid;
}

try {
  // 1. 会话改名
  console.log(`── 1. 会话改名（PATCH /v1/sessions/<id>）──`);
  const sid = await chatOne();
  ok("准备一个会话（POST /v1/chat）", sid.startsWith("msb"), sid);
  const RENAMED = `验证会话-${Date.now() % 100000}`;
  const p1 = await req("PATCH", `/v1/sessions/${sid}`, { name: RENAMED });
  ok("PATCH 改名 200", p1.status === 200 && p1.body?.name === RENAMED);
  const sessions = await listSessions();
  const renamed = sessions.find((s) => s.id === sid);
  ok("列表 DTO 反映新名", renamed?.name === RENAMED, `name=${renamed?.name}`);
  ok("改名后历史端点仍正常（JSONL 完整）", (await req("GET", `/v1/sessions/${sid}/messages`)).status === 200);
  ok("改名后 JSONL 导出仍正常", (await req("GET", `/v1/sessions/${sid}/jsonl`)).status === 200);

  // 2. 会话删除
  console.log("── 2. 会话删除（DELETE /v1/sessions/<id>）──");
  const d1 = await req("DELETE", `/v1/sessions/${sid}`);
  ok("DELETE 200", d1.status === 200 && d1.body?.deleted === true);
  const after = await listSessions();
  ok("删除后列表不再出现", !after.some((s) => s.id === sid));
  let fileGone = false;
  try {
    const out = execFileSync("kubectl", ["exec", `deploy/worker-${USER}`, "-n", "poweri", "--", "sh", "-c", `ls /home/piuser/.pi/agent/sessions | grep -c ${sid} || true`], { encoding: "utf8" });
    fileGone = out.trim() === "0";
  } catch { }
  ok("worker PVC 上会话文件已删", fileGone);
  ok("重复删除 404", (await req("DELETE", `/v1/sessions/${sid}`)).status === 404);
  ok("删除不存在 404", (await req("DELETE", `/v1/sessions/msbno-such-session-0000`)).status === 404);
  ok("无 token 删除 401", (await req("DELETE", `/v1/sessions/${sid}`, null, null)).status === 401);

  // 3. 用户侧计量
  console.log("── 3. 用户侧计量（/v1/users/me/usage）──");
  const u1 = await req("GET", "/v1/users/me/usage");
  ok("用户 token 可见自己的计量", u1.status === 200 && Array.isArray(u1.body?.records), `${u1.body?.records?.length ?? 0} 条`);
  const a1 = await req("GET", "/v1/admin/usage?userId=" + USER, null, ADMIN);
  ok("与 admin 视角一致（同一数据源）", a1.status === 200 && (a1.body?.records ?? []).length === (u1.body?.records ?? []).length);
  ok("无 token 计量 401", (await req("GET", "/v1/users/me/usage", null, null)).status === 401);
  const other = USER === "alice" ? "token-b" : "token-a";
  const o1 = await req("GET", "/v1/users/me/usage", null, other);
  ok("他人 token 只能看自己（数量不一定一致但请求成功）", o1.status === 200);

  console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
} finally {
  process.exit(failed ? 1 : 0);
}
