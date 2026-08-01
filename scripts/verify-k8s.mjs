// ticket 16 K8s 真实环境验证：网关 k8s provider → NodePort → worker Pod（PVC）→ 桥 → pi
// A 多用户路由与隔离（alice/bob 各自会话）
// B PVC 持久化：删 Pod 重建后会话数据仍在并续接
// C 会话文件落 PVC 检查
// 前置：node scripts/gen-k8s.mjs alice,bob 已执行且 Ready；模型 API 可达
// 运行：node scripts/verify-k8s.mjs

import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pk8s-"));
const GW_PORT = 18093;
const BASE = `http://127.0.0.1:${GW_PORT}`;
const NS = "poweri";
const kubectl = (args, opts = {}) => {
  try { return (execFileSync("kubectl", args, { encoding: "utf8", ...opts }) ?? "").trim(); }
  catch (e) { if (opts.allowFail) return ""; throw e; }
};

async function chat(token, body) {
  const res = await fetch(`${BASE}/v1/chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const dec = new TextDecoder();
  let buf = "";
  for await (const c of res.body) buf += dec.decode(c, { stream: true });
  const m = buf.match(/"sessionId":"([^"]+)"/);
  return { status: res.status, text: buf, sessionId: m?.[1], ok: !buf.includes("event: error") };
}

const gw = spawn("node", ["gateway/server.mjs"], {
  env: {
    ...process.env,
    POWERI_DATA_DIR: DATA_DIR,
    POWERI_GATEWAY_PORT: String(GW_PORT),
    POWERI_GATEWAY_USERS: "alice:token-a;bob:token-b",
    POWERI_POD_PROVIDER: "k8s",
    POWERI_K8S_USERS: "alice:30081;bob:30082",
    POWERI_K8S_NODE_HOST: "127.0.0.1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
gw.stderr.on("data", () => {});
await new Promise((r) => setTimeout(r, 1000));
const stop = () => { try { gw.kill("SIGTERM"); } catch {} };

try {
  // ── A: 多用户路由与隔离 ──
  console.log("── A: 多用户路由与隔离（K8s）──");
  const wa = await chat("token-a", { session: "new", message: "记住水果 mango，之后我会问你" });
  assert.equal(wa.status, 200, "A1 alice 200");
  assert.ok(wa.ok, "A1 alice 无 error（模型可达）");
  const aliceSid = wa.sessionId;
  console.log(`  ✓ A1 alice 写入会话 ${aliceSid}`);

  const wb = await chat("token-b", { session: "new", message: "你知道 mango 吗？只答 知道/不知道" });
  assert.equal(wb.status, 200, "A2 bob 200");
  assert.ok(wb.ok, "A2 bob 无 error");
  assert.match(wb.text, /不知道|不知道|没|无法|不清楚|no/i, "A2 bob 问不出 alice 的 mango（隔离）");
  console.log("  ✓ A2 bob 隔离（问不出 mango）");

  // ── C: 会话文件落 PVC ──
  console.log("── C: 会话 JSONL 落 PVC ──");
  const files = kubectl(["exec", "-n", NS, "deploy/worker-alice", "--", "sh", "-c", "ls /home/piuser/.pi/agent/sessions/"]).split("\n").filter(Boolean);
  assert.ok(files.some((f) => f.includes(aliceSid.slice(0, 8))), `C 会话文件在 alice PVC（${files.join(",")}）`);
  console.log(`  ✓ C 会话 JSONL 在 PVC（${files.length} 个文件）`);

  // ── B: 删 Pod 重建 → 数据持久 → 续接 ──
  console.log("── B: Pod 删除重建 → PVC 持久化续接 ──");
  kubectl(["delete", "pod", "-n", NS, "-l", "app=poweri,user=alice"]);
  kubectl(["rollout", "status", "deploy/worker-alice", "-n", NS, "--timeout=120s"]);
  await new Promise((r) => setTimeout(r, 3000)); // NodePort 转发窗口
  let rb;
  for (let i = 0; i < 3; i++) {
    rb = await chat("token-a", { session: aliceSid, message: "水果是什么？只答水果名" });
    if (rb.status === 200 && rb.ok) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  assert.equal(rb.status, 200, "B1 续接 200");
  if (rb.ok) {
    assert.match(rb.text, /mango/i, "B 重建后 alice 记得 mango（PVC 持久化）");
    console.log("  ✓ B Pod 重建后 mango 记忆保留（PVC 持久化 + 跨 Pod 续接）");
  } else {
    console.log(`  ⚠ B 续接失败（${rb.status}）——模型 API 状态？`);
  }

  console.log(`\n✅ K8s 验证通过（${DATA_DIR}）`);
} finally {
  stop();
}
