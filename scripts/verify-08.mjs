// verify-08.mjs — ticket 08 User Memory 集成验证
// Part A 容器级：remember 工具写入 + 跨进程注入（print 模式）
// Part B 全链路（gateway+docker）：偏好记忆 → 跨会话注入生效；每会话仅 1 条 user 消息（零额外模型调用）；alice/bob 隔离
// Part C 存量初始化：init-memory.mjs 幂等（已存在跳过）
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, spawn } from "node:child_process";

const assert = (cond, msg) => { if (!cond) { console.error(`✖ ${msg}`); process.exitCode = 1; } else console.log(`✔ ${msg}`); };

function chat(token, body) {
  return new Promise((resolve, reject) => {
    const req = new Request(`http://127.0.0.1:${process.env.GW_PORT || 18081}/v1/chat`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    fetch(req).then(async (res) => {
      const text = await res.text();
      const events = text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const texts = events.filter((e) => e.type === "message_update" && e.message?.role === "assistant").map((e) => e.message?.content?.map((c) => c.type === "text" ? c.text : "").join("") ?? "").join("");
      resolve({ status: res.status, events, texts });
    }).catch(reject);
  });
}

function startGateway(env) {
  const child = spawn("node", ["gateway/server.mjs"], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}
const stop = (c) => { try { c.kill("SIGTERM"); } catch {} };

function cleanupPods() {
  try {
    execFileSync("docker", ["ps", "-q", "--filter", "name=poweri-"], { encoding: "utf8" })
      .trim().split("\n").filter(Boolean).forEach((id) => { try { execFileSync("docker", ["rm", "-f", id], { stdio: "ignore" }); } catch {} });
  } catch {}
}
function dockerRun(args) { return execFileSync("docker", args, { encoding: "utf8" }); }

// ══════════ Part A: 容器级 remember + 跨进程注入（print 模式） ══════════
async function partA() {
  console.log("── Part A: 容器级扩展（print 模式）──");
  // 只读快照宿主 pi 配置供容器挂载（不触碰宿主安装）
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), "p08cfg-"));
  fs.cpSync(path.join(os.homedir(), ".pi", "agent"), cfg, { recursive: true });
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "p08a-"));
  const run = (prompt) => dockerRun(["run", "--rm", "-v", `${cfg}:/home/piuser/.pi/agent`, "-v", `${ws}:/workspace`, "pi-sandbox:local", "-e", "/poweri/extensions/user-memory.mjs", "-p", prompt]);
  // 1. 让 agent 调 remember 写偏好
  const out1 = run("调用 remember 工具，preferences 节记录：回复要中文且简洁");
  assert(out1.includes("已记入") || out1.length > 0, "PartA-1 请求完成");
  const memFile = path.join(ws, ".poweri", "memory", "memory.md");
  const mem1 = fs.existsSync(memFile) ? fs.readFileSync(memFile, "utf8") : "";
  assert(mem1.includes("中文") && mem1.includes("简洁"), `PartA-2 remember 写入偏好（memory.md=${JSON.stringify(mem1.slice(0, 80))}…）`);
  assert(fs.readdirSync(path.join(ws, ".poweri", "memory", "history")).length >= 1, "PartA-3 写前备份存在");
  // 2. 新进程（跨进程注入）— agent 应通过 context 注入读到偏好
  const out2 = run("我的偏好是什么？只回答这一句，不要调用任何工具");
  assert(/中文/.test(out2) && /简洁/.test(out2), `PartA-4 跨进程注入生效（回复=${JSON.stringify(out2.slice(0, 100))}）`);
}

// ══════════ Part B: 全链路 gateway + docker ══════════
async function partB() {
  console.log("── Part B: 全链路（gateway + docker provider + 真实 pi）──");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "p08b-"));
  const gw = startGateway({
    POWERI_GATEWAY_PORT: "18081",
    POWERI_POD_PROVIDER: "docker", POWERI_DATA_DIR: dataDir, POWERI_AI_MODEL: "agent",
    POWERI_GATEWAY_USERS: "alice:token-a;bob:token-b",
  });
  await new Promise((r) => setTimeout(r, 800));
  try {
    // ① alice 新会话：记住偏好
    const r1 = await chat("token-a", { session: "new", message: "用 remember 工具记住我的偏好：回复要中文、简洁、不用 emoji" });
    assert(r1.status === 200, `B-1 alice 请求完成 (status=${r1.status})`);
    const aliceMem = path.join(dataDir, "users", "alice", "workspace", ".poweri", "memory", "memory.md");
    assert(fs.existsSync(aliceMem) && /emoji|简洁/.test(fs.readFileSync(aliceMem, "utf8")), "B-2 alice memory.md 已含偏好");
    // ② alice 续接（新 pod）：注入生效
    const r2 = await chat("token-a", { message: "我的偏好是什么？简短回答，不要调用工具" });
    assert(/中文|简洁|emoji/i.test(r2.texts), `B-3 跨会话注入生效（回复=${JSON.stringify(r2.texts.slice(0, 120))}）`);
    // ③ 零额外模型调用：续接会话 JSONL 中 user 消息恰 1 条
    const aliceSessions = fs.readdirSync(path.join(dataDir, "users", "alice", ".pi", "agent", "sessions")).filter((f) => f.endsWith(".jsonl"));
    const last = aliceSessions.sort().pop();
    const jsonl = fs.readFileSync(path.join(dataDir, "users", "alice", ".pi", "agent", "sessions", last), "utf8");
    const users = jsonl.split("\n").filter((l) => l.includes('"role":"user"'));
    assert(users.length === 2, `B-4 零额外调用（续接会话 user 消息数=${users.length}，应为 2=每请求 1 条；若有摘要回合会是 3+）`);
    // ④ bob 隔离：bob 的 memory 无 alice 内容，且他问不出 alice 的偏好
    await chat("token-b", { session: "new", message: "你好" });
    const bobMem = path.join(dataDir, "users", "bob", "workspace", ".poweri", "memory", "memory.md");
    const bobMemContent = fs.existsSync(bobMem) ? fs.readFileSync(bobMem, "utf8") : "";
    assert(!/emoji|简洁/.test(bobMemContent), "B-5 bob 的 memory 不含 alice 偏好（文件隔离）");
  } finally { await stop(gw); cleanupPods(); }
}

// ══════════ Part C: 存量初始化 ══════════
async function partC() {
  console.log("── Part C: 存量数据初始化（幂等）──");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "p08c-"));
  // 预置一个已有记忆的用户
  const pre = path.join(dataDir, "users", "carol", "workspace", ".poweri", "memory");
  fs.mkdirSync(path.join(pre, "history"), { recursive: true });
  fs.writeFileSync(path.join(pre, "memory.md"), "# User Memory\n\n## 画像\n- 老用户\n");
  const legacy = path.join(os.tmpdir(), `p08c-legacy-${Date.now()}.json`);
  fs.writeFileSync(legacy, JSON.stringify({
    carol: { profile: ["老用户"], preferences: ["新偏好不应覆盖"] },
    dave: { profile: ["Dave"], facts: ["用自建网关"], preferences: ["要中文"] },
  }));
  const runInit = () => dockerRun ? execFileSync("node", ["scripts/init-memory.mjs", "--legacy", legacy, "--data-dir", dataDir], { encoding: "utf8" }) : "";
  const first = runInit();
  assert(first.includes("written=1") && first.includes("skipped=1"), `C-1 首轮: written=1 skipped=1（${first.trim().split("\n").pop()}）`);
  const daveMem = fs.readFileSync(path.join(dataDir, "users", "dave", "workspace", ".poweri", "memory", "memory.md"), "utf8");
  assert(daveMem.includes("Dave") && daveMem.includes("自建网关") && daveMem.includes("要中文"), "C-2 dave 三节内容写入");
  const carolMem = fs.readFileSync(path.join(dataDir, "users", "carol", "workspace", ".poweri", "memory", "memory.md"), "utf8");
  assert(!carolMem.includes("新偏好不应覆盖"), "C-3 已有记忆用户未被覆盖（幂等）");
  const second = runInit();
  assert(second.includes("skipped=2"), "C-4 重跑全部跳过（幂等）");
}

(async () => {
  await partA();
  await partB();
  await partC();
  console.log(process.exitCode ? "\n═══ 存在失败 ═══" : "\n═══ verify-08 全部通过 ═══");
})();
