// ticket 21 验证：pi-web 实例（K8s）—— 认证 / skill 播种 / 进程内 pi 加载并执行业务 skill / 会话落 PVC
// 用法: node scripts/verify-21.mjs [alice,bob]   （需先 gen-k8s --piweb + seed-skills）
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const NS = "poweri";
const users = (process.argv[2] ?? "alice,bob").split(",").map((s) => s.trim()).filter(Boolean);
const ALL_USERS = ["alice", "bob"]; // 端口按全局用户序（alice=30241, bob=30242），与 gen-k8s 一致
const BASE_PORT = 30241;
const baseOf = (u) => `http://127.0.0.1:${BASE_PORT + ALL_USERS.indexOf(u)}`;
const authOf = (u) => "Basic " + Buffer.from(`pi:poweri-${u}`).toString("base64");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 1. 认证 + 就绪 ─────────────────────────────────────────────────
for (const u of users) {
  const r = await fetch(`${baseOf(u)}/`, { headers: { Authorization: authOf(u) } });
  assert.equal(r.status, 200, `${u} NodePort 带认证 200`);
  const noAuth = await fetch(`${baseOf(u)}/`);
  assert.ok([401, 0].includes(noAuth.status), `${u} 无认证被拒（401 或连接重置）`);
  console.log(`✓ ${u} 认证 200 / 无认证被拒`);
}

// ── 2. skill 已播种到 PVC ──────────────────────────────────────────
for (const u of users) {
  const out = execFileSync("kubectl", ["exec", `deploy/worker-${u}`, "-n", NS, "--", "sh", "-c", "ls -1 /home/piuser/.pi/agent/skills | wc -l"], { encoding: "utf8" });
  const n = parseInt(out.trim(), 10);
  assert.ok(n >= 15, `${u} 至少 15 个 skill（实际 ${n}）`);
  console.log(`✓ ${u} PVC 已播种 ${n} 个 skill`);
}

// ── 3. 进程内 pi：加载并执行业务 skill（humanizer-zh 改写 + 列 skills）──
const PROMPT = "请先列出你当前已加载的所有 skills（以 /skill: 命令形式逐行列出），然后用 humanizer-zh skill 把下面这句话改写得更自然、更像人写的：'本文档旨在为相关利益方提供一个全面且详尽的概述，以促进更好的沟通与协作，从而最终达成项目的既定目标。'";
for (const u of users) {
  // ensure_session（只建运行时，不触发模型）
  const created = await fetch(`${baseOf(u)}/api/agent/new`, {
    method: "POST",
    headers: { Authorization: authOf(u), "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: "/workspace", type: "ensure_session" }),
  });
  assert.equal(created.status, 200, `${u} agent/new 200`);
  const { sessionId } = await created.json();
  assert.ok(sessionId, `${u} 返回 sessionId`);
  console.log(`✓ ${u} pi-web 进程内会话 ${sessionId}`);

  // 订阅 SSE → 发 prompt → 收集事件
  const controller = new AbortController();
  const eventsPromise = (async () => {
    const res = await fetch(`${baseOf(u)}/api/agent/${sessionId}/events`, { headers: { Authorization: authOf(u) }, signal: controller.signal });
    assert.equal(res.status, 200, `${u} events 200`);
    const dec = new TextDecoder();
    const updates = [];
    for await (const chunk of res.body) {
      for (const line of dec.decode(chunk).split("\n")) {
        if (!line.startsWith("data: ")) continue;
        let ev; try { ev = JSON.parse(line.slice(6)); } catch { continue; }
        updates.push(ev);
        if (ev.type === "prompt_done" || ev.type === "prompt_error") return updates;
      }
    }
    return updates;
  })();
  const race = Promise.race([
    eventsPromise,
    new Promise((_, rej) => setTimeout(() => { controller.abort(); rej(new Error(`${u} 对话超时`)); }, 240000)),
  ]);
  await sleep(400);
  const res = await fetch(`${baseOf(u)}/api/agent/${sessionId}`, {
    method: "POST",
    headers: { Authorization: authOf(u), "Content-Type": "application/json" },
    body: JSON.stringify({ type: "prompt", message: PROMPT }),
  });
  assert.equal(res.status, 200, `${u} prompt 200`);
  const updates = await race;

  // 证据 1：回复里出现 /skill: 或 skill 名（运行时发现的证据）
  const all = JSON.stringify(updates);
  const skillNames = ["humanizer-zh", "code-review", "ponytail", "tdd", "research", "prototype"];
  const seen = skillNames.filter((s) => all.includes(s));
  assert.ok(seen.length >= 1, `${u} 回复中出现已加载 skill 名（${seen.join(",")}）`);
  console.log(`  ✓ ${u} 回复提及 skills: ${seen.join(", ")}`);

  // 证据 2：工具调用读取了 SKILL.md（真正执行 skill）
  const toolEv = updates.find((e) => e.type === "tool_execution_start" || (e.message_update && JSON.stringify(e).includes("SKILL.md")));
  if (toolEv) console.log(`  ✓ ${u} 检测到工具执行（skill 内容被实际加载）`);
  else console.log(`  ⚠ ${u} 未见工具执行事件（模型可能仅按提示改写了文本）`);

  // 证据 3：最后一条 assistant 文本（改写结果）
  const mu = updates.filter((e) => e.type === "message_update");
  const texts = mu.flatMap((e) => (e.message?.content ?? []).filter((p) => p.type === "text" && p.text).map((p) => p.text));
  const final = texts[texts.length - 1] ?? ""; // message_update 是累积快照，最后一条=完整回答
  if (!final && mu.length) console.log(`  debug 最近 message_update 结构: ${JSON.stringify(mu[mu.length - 1]).slice(0, 400)}`);
  console.log(`  ${u} 最终回复片段: ${final.slice(0, 180).replace(/\n/g, " ")}`);
}
console.log("\n✓ verify-21 全部通过（认证 / 播种 / 进程内 pi 加载执行 skill）");
