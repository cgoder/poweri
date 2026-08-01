// ticket 15 验证：pi-web 可视化多用户（每用户实例）
// Part A: Basic Auth 实例隔离（无认证/错误密码 401；各自密码访问各自实例 200；跨实例 401）
// Part B: 数据隔离（完整对话后会话 JSONL 只落各自目录；/api/sessions 互不可见）
// Part C: 真实并发（alice+bob 同时对话，各自标记回复，互不干扰）
// Part D: 跨容器重启续接（记住 zebra → docker restart 实例 → 同会话追问 zebra）
// Part E: 配置隔离（PUT /api/models-config 写回各自 models.json，互不影响）
//
// 前置：node scripts/build-piweb.mjs（poweri-piweb:local）；模型 API 可达
//       （.env 已配置 + npm run gen:pi-config 已生成项目 deploy/config/pi/models.json）
// 运行：node scripts/verify-15.mjs
// 可选：POWERI_PIWEB_IMAGE / POWERI_PIWEB_BASE_PORT / POWERI_PIWEB_PASSWORD_<USER>

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "p15-"));
const IMAGE = process.env.POWERI_PIWEB_IMAGE ?? "poweri-piweb:local";
const BASE_PORT = Number(process.env.POWERI_PIWEB_BASE_PORT ?? 31141);
const USERS = ["alice", "bob"];
const CONTAINER_PORT = 30141;
const HOST_PI_CONFIG = process.env.POWERI_PI_CONFIG_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "deploy", "config", "pi");

const userDir = (u) => path.join(DATA_DIR, "users", u);
const userPiDir = (u) => path.join(userDir(u), ".pi", "agent");
const userWsDir = (u) => path.join(userDir(u), "workspace");
const pwOf = (u) => process.env[`POWERI_PIWEB_PASSWORD_${u.toUpperCase()}`] ?? `poweri-${u}`;
const authOf = (u) => `Basic ${Buffer.from(`pi:${pwOf(u)}`).toString("base64")}`;
const portOf = (u) => BASE_PORT + USERS.indexOf(u);
const baseOf = (u) => `http://127.0.0.1:${portOf(u)}`;
const containerName = (u) => `poweri-piweb-${u}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function docker(args, opts = {}) {
  try {
    return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
  } catch (e) { if (opts.allowFail) return ""; throw e; }
}

function seedUser(u) {
  const piDir = userPiDir(u);
  fs.mkdirSync(path.join(piDir, "sessions"), { recursive: true });
  for (const f of ["models.json", "settings.json"]) {
    const src = path.join(HOST_PI_CONFIG, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(piDir, f));
  }
  fs.mkdirSync(userWsDir(u), { recursive: true });
}

function startInstance(u) {
  seedUser(u);
  const port = portOf(u);
  docker(["run", "-d", "--rm", "--name", containerName(u),
    "-p", `127.0.0.1:${port}:${CONTAINER_PORT}`,
    "-v", `${userPiDir(u)}:/home/piuser/.pi/agent`,
    "-v", `${userWsDir(u)}:/workspace`,
    "-e", `PI_WEB_PASSWORD=${pwOf(u)}`,
    IMAGE,
  ]);
  return port;
}

function stopAll() {
  for (const u of USERS) { try { docker(["rm", "-f", containerName(u)], { allowFail: true }); } catch {} }
}

async function waitHttp(u, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseOf(u)}/api/sessions`, { headers: { Authorization: authOf(u) } });
      if (res.status === 200) return;
    } catch {}
    await sleep(1000);
  }
  throw new Error(`pi-web ${u} 未就绪`);
}

async function newSession(u) {
  const res = await fetch(`${baseOf(u)}/api/agent/new`, {
    method: "POST",
    headers: { Authorization: authOf(u), "Content-Type": "application/json" },
    // type:"ensure_session" 只创建运行时并返回 real sessionId（pi-web route 注释）
    body: JSON.stringify({ cwd: "/workspace", type: "ensure_session" }),
  });
  assert.equal(res.status, 200, `${u} agent/new 200`);
  const j = await res.json();
  assert.ok(j.success && j.sessionId, `${u} agent/new 返回 sessionId`);
  return j.sessionId;
}

// 就绪探针：POST get_state 直到模型就绪且空闲（同进程会话已在注册表，直接可用）
async function waitReady(u, sid, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseOf(u)}/api/agent/${sid}`, {
        method: "POST",
        headers: { Authorization: authOf(u), "Content-Type": "application/json" },
        body: JSON.stringify({ type: "get_state" }),
      });
      if (res.status === 200) {
        const d = (await res.json())?.data;
        if (d && d.model && !d.isStreaming && !d.isPromptRunning) return d;
      }
    } catch {}
    await sleep(1000);
  }
  throw new Error(`${u} 会话 ${sid} 未就绪（模型加载/上下文构建超时）`);
}

// 对话：先订阅 SSE（prompt 是 fire-and-forget，回复走事件流），再发 prompt，等 prompt_done
async function chat(u, sid, message, timeoutMs = 180000) {
  const controller = new AbortController();
  // 1) 先挂 SSE 事件流（fetch 立即发出；race 先建好以吞掉早期 reject）
  const eventsPromise = (async () => {
    const res = await fetch(`${baseOf(u)}/api/agent/${sid}/events`, {
      headers: { Authorization: authOf(u) },
      signal: controller.signal,
    });
    assert.equal(res.status, 200, `${u} events 200`);
    const dec = new TextDecoder();
    let buf = "";
    const updates = [];
    let done = false;
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data: ")) continue; // 心跳 ":\n\n" 跳过
          let ev; try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          if (ev.type === "message_update") updates.push(ev);
          if (ev.type === "prompt_done" || ev.type === "prompt_error") { done = true; break; }
        }
        if (done) break;
      }
      if (done) break;
    }
    return updates;
  })();
  const race = Promise.race([
    eventsPromise,
    new Promise((_, rej) => setTimeout(() => { controller.abort(); rej(new Error(`${u} 对话超时（${timeoutMs}ms）`)); }, timeoutMs)),
  ]);

  // 2) 等订阅挂上后发 prompt
  await sleep(400);
  const res = await fetch(`${baseOf(u)}/api/agent/${sid}`, {
    method: "POST",
    headers: { Authorization: authOf(u), "Content-Type": "application/json" },
    body: JSON.stringify({ type: "prompt", message }),
  });
  assert.equal(res.status, 200, `${u} prompt 200`);
  assert.equal((await res.json())?.success, true, `${u} prompt success`);

  // 3) 等回合结束，提取助手文本
  const updates = await race;
  return updates
    .map((e) => (e.message?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join(""))
    .join("");
}

// pi 0.83 经 SessionManager 把会话写在 sessions/<slug>/<时间戳>_<sessionId>.jsonl（嵌套+前缀），
// 故递归查找、按 sessionId 前缀匹配。
function sessionFiles(u) {
  const dir = path.join(userPiDir(u), "sessions");
  const out = [];
  const walk = (d) => {
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".jsonl")) out.push(p);
    }
  };
  walk(dir);
  return out;
}
const hasSession = (u, sid) => sessionFiles(u).some((f) => path.basename(f).includes(sid.slice(0, 8)));

async function main() {
  console.log(`pi-web 可视化多用户验证（DATA_DIR=${DATA_DIR}）`);
  docker(["images", "-q", IMAGE], { allowFail: true }) || (() => { throw new Error(`镜像 ${IMAGE} 不存在：先 node scripts/build-piweb.mjs`); })();

  for (const u of USERS) startInstance(u);
  try {
    await Promise.all(USERS.map((u) => waitHttp(u)));

    // ── A: Basic Auth 实例隔离 ──
    console.log("── A: Basic Auth 实例隔离 ──");
    for (const u of USERS) {
      const noAuth = await fetch(`${baseOf(u)}/`);
      assert.equal(noAuth.status, 401, `${u} 无认证 401`);
      const badPw = await fetch(`${baseOf(u)}/`, { headers: { Authorization: `Basic ${Buffer.from("pi:wrong-password").toString("base64")}` } });
      assert.equal(badPw.status, 401, `${u} 错误密码 401`);
      const ok = await fetch(`${baseOf(u)}/`, { headers: { Authorization: authOf(u) } });
      assert.equal(ok.status, 200, `${u} 正确密码 200`);
    }
    // 跨实例：alice 的密码访问 bob 的实例 → 401（每实例独立 Basic Auth）
    const cross = await fetch(`${baseOf("bob")}/`, { headers: { Authorization: authOf("alice") } });
    assert.equal(cross.status, 401, "alice 密码访问 bob 实例 401");
    console.log("  ✓ A1/A2 无认证/错误密码 401，正确密码 200");
    console.log("  ✓ A3 跨实例认证隔离（alice 密码不能进 bob）");

    // ── B: 数据隔离（alice 一轮对话，bob 尚未有任何会话）──
    console.log("── B: 数据隔离 ──");
    const bSid = await newSession("alice");
    await waitReady("alice", bSid);
    const bReply = await chat("alice", bSid, "请只回答一个词：苹果");
    assert.ok(bReply.length > 0, `B1 alice 有回复（${bReply.slice(0, 40)}…）`);
    assert.match(bReply, /苹果/, "B1 alice 回复含苹果");
    await sleep(500); // 等 JSONL 落盘
    const aliceFiles = sessionFiles("alice");
    const bobFiles = sessionFiles("bob");
    assert.ok(hasSession("alice", bSid), `B2 alice 会话 JSONL 落 alice 目录（${aliceFiles.join(",")}）`);
    assert.equal(bobFiles.length, 0, `B3 bob 目录无任何会话（${bobFiles.join(",")}）`);
    const bobSessions = await (await fetch(`${baseOf("bob")}/api/sessions`, { headers: { Authorization: authOf("bob") } })).json();
    assert.equal(Array.isArray(bobSessions) ? bobSessions.length : 0, 0, "B4 bob /api/sessions 为空（看不到 alice 会话）");
    console.log(`  ✓ B1 alice 真实回复（${bReply.slice(0, 30)}…）`);
    console.log(`  ✓ B2 会话 ${bSid.slice(0, 8)} JSONL 只落 alice 目录`);
    console.log("  ✓ B3/B4 bob 目录与 /api/sessions 均无 alice 痕迹（数据隔离）");

    // ── C: 真实并发（alice+bob 同时对话，各自标记）──
    console.log("── C: 真实并发 ──");
    const cSidA = await newSession("alice");
    const cSidB = await newSession("bob");
    await Promise.all([waitReady("alice", cSidA), waitReady("bob", cSidB)]);
    const t0 = Date.now();
    const [cA, cB] = await Promise.all([
      chat("alice", cSidA, "请只回答一个词：红队"),
      chat("bob", cSidB, "请只回答一个词：蓝队"),
    ]);
    const elapsed = Date.now() - t0;
    assert.match(cA, /红队/, `C1 alice 回复含红队（${cA.slice(0, 40)}…）`);
    assert.match(cB, /蓝队/, `C2 bob 回复含蓝队（${cB.slice(0, 40)}…）`);
    assert.ok(!cA.includes("蓝队"), "C3 alice 回复不含 bob 标记（互不干扰）");
    assert.ok(!cB.includes("红队"), "C4 bob 回复不含 alice 标记（互不干扰）");
    assert.ok(hasSession("alice", cSidA), "C5 alice 会话落各自目录");
    assert.ok(hasSession("bob", cSidB), "C6 bob 会话落各自目录");
    console.log(`  ✓ C 双用户同时对话（${elapsed}ms），红队/蓝队各自收到、互不混淆`);

    // ── D: 跨容器重启续接（同会话数据在挂载目录，跨进程可恢复）──
    console.log("── D: 跨容器重启续接 ──");
    const dSid = await newSession("alice");
    await waitReady("alice", dSid);
    const d1 = await chat("alice", dSid, "记住验证码 zebra，之后我会问你");
    assert.ok(d1.length > 0, "D1 首轮有回复");
    await sleep(1000); // 等 JSONL 完整落盘
    docker(["restart", containerName("alice")]); // 杀掉进程内 pi，验证从挂载目录恢复
    await waitHttp("alice");
    await waitReady("alice", dSid); // 新进程从 JSONL 重建上下文，等模型就绪
    const d2 = await chat("alice", dSid, "验证码是什么？只答验证码");
    assert.match(d2, /zebra/i, `D2 重启后同会话追问仍记得 zebra（${d2.slice(0, 40)}…）`);
    console.log("  ✓ D1 首轮记住 zebra");
    console.log("  ✓ D2 docker restart 后同会话追问答出 zebra（跨进程续接）");

    // ── E: 配置隔离（界面改配置写回各自 models.json）──
    console.log("── E: 配置隔离 ──");
    const getCfg = async (u) => (await fetch(`${baseOf(u)}/api/models-config`, { headers: { Authorization: authOf(u) } })).json();
    const putCfg = async (u, body) => {
      const res = await fetch(`${baseOf(u)}/api/models-config`, {
        method: "PUT",
        headers: { Authorization: authOf(u), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 200, `${u} PUT models-config 200`);
    };
    const eOrigA = await getCfg("alice");
    const eOrigB = await getCfg("bob");
    assert.ok(eOrigA.providers, "E0 alice 初始 models.json 有 providers");
    await putCfg("alice", { ...eOrigA, "poweri-verify-marker": "alice改过" });
    const eAfterA = await getCfg("alice");
    const eAfterB = await getCfg("bob");
    assert.equal(eAfterA["poweri-verify-marker"], "alice改过", "E1 alice 实例读回自己的改动");
    assert.equal(eAfterB["poweri-verify-marker"], undefined, "E2 bob 实例配置未被 alice 改动影响");
    const onDiskA = fs.readFileSync(path.join(userPiDir("alice"), "models.json"), "utf8");
    const onDiskB = fs.readFileSync(path.join(userPiDir("bob"), "models.json"), "utf8");
    assert.ok(onDiskA.includes("alice改过"), "E3 改动已写回 alice 的 PVC models.json");
    assert.ok(!onDiskB.includes("alice改过"), "E4 bob 的 PVC models.json 未被写");
    console.log("  ✓ E1/E3 alice 界面配置改动写回自己 models.json");
    console.log("  ✓ E2/E4 bob 配置与文件均不受影响（配置隔离）");
  } finally {
    stopAll();
  }
  console.log(`\n✅ ticket 15 验证全部通过（${DATA_DIR}）`);
}

await main();
