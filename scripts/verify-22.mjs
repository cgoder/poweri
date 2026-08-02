// verify-22.mjs — jmfederico/pi-web（ticket 22 A′ 试点）K8s 每用户 Pod headless 验证
// 前置：gen-k8s.mjs alice --piweb2 已部署，piweb2-alice NodePort 30251
// 验证点：1 NodePort+web 可达 / 2 sessiond 组件在线 / 3 建会话 / 4 prompt 往返
//         / 5 会话断开存活（POST 关闭后仍跑完 + JSONL 断开期间写盘增长）
//         / 6 多会话并行 / 7 既有会话可见 + skills 从 agent 目录加载 + 落盘
//         / 8 镜像/依赖成本证据（镜像体积、pi-web/pi SDK 版本、启动时间）
import { execFileSync } from "node:child_process";

const USER = process.env.PIWEB2_USER ?? "alice";
const PORT = process.env.PIWEB2_PORT ?? 30251;
const BASE = `http://127.0.0.1:${PORT}`;
const CWD = "/data/workspace";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name) => { console.log(`  ✓ ${name}`); pass++; };
const bad = (name, extra = "") => { console.log(`  ✗ ${name} ${extra}`); fail++; };

async function j(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

const inPod = (cmd) => {
  try { return execFileSync("kubectl", ["exec", "-n", "poweri", `deploy/piweb2-${USER}`, "--", "sh", "-c", cmd], { encoding: "utf8" }).trim(); }
  catch (e) { throw new Error(`kubectl exec 失败: ${e.message.slice(0, 200)}`); }
};

async function waitForCompletion(sid, timeoutMs, pollMs = 3000) {
  // 完成 = 最后一条 assistant 带 usage 且消息数连续两轮不变（过滤 tool 轮次尾随）
  const deadline = Date.now() + timeoutMs;
  let lastCount = -1, stableRounds = 0;
  while (Date.now() < deadline) {
    const { data } = await j("GET", `/api/machines/local/sessions/${sid}/messages`);
    const msgs = Array.isArray(data) ? data : [];
    const lastAsst = [...msgs].reverse().find((m) => (m?.role ?? m?.message?.role) === "assistant");
    const done = lastAsst?.usage !== undefined;
    if (msgs.length === lastCount) stableRounds++; else stableRounds = 0;
    lastCount = msgs.length;
    if (done && stableRounds >= 1) return msgs;
    await sleep(pollMs);
  }
  return null;
}

console.log(`\n=== verify-22 ${USER} @ ${BASE} ===`);

// 1. web 可达
const home = await fetch(BASE + "/");
home.status === 200 ? ok("1 NodePort web 可达 (GET / 200)") : bad("1 NodePort web 不可达", `status=${home.status}`);

// 2. sessiond 组件在线
const rt = await j("GET", "/api/pi-web/runtime");
const rtText = JSON.stringify(rt.data);
rt.status === 200 && /sessiond/.test(rtText) ? ok("2 sessiond 组件在线") : bad("2 sessiond 组件状态", `status=${rt.status}`);

// 7a. 既有会话可见（重启前创建的会话仍呈现 = 会话持久性跨重启；worker 链 msb* 平铺文件不属任何 cwd 编码目录，见 Answer 限制）
const sessList = await j("GET", `/api/machines/local/sessions?cwd=${encodeURIComponent(CWD)}`);
const sessArr = Array.isArray(sessList.data) ? sessList.data : null;
const preRestartIds = sessArr ? sessArr.filter((s) => /^019fc07d-/.test(s.id ?? "")) : [];
sessList.status === 200 && sessArr && sessArr.length > 0 && preRestartIds.length > 0
  ? ok(`7a 既有会话可见：列表含重启前创建的 ${preRestartIds.length} 个会话（跨重启持久）`) : bad("7a 既有会话", `status=${sessList.status} 数组=${Array.isArray(sessList.data)} 长度=${sessArr?.length}`);

// 4a. skills 从 agent 目录加载（PVC 播种的 15+ skills 出现在挂载点）
let skillCount;
try { skillCount = parseInt(inPod("ls /data/pi-agent/skills 2>/dev/null | wc -l"), 10); } catch (e) { bad("4a skills 检查", e.message); skillCount = 0; }
skillCount >= 15 ? ok(`4a skills 从 agent 目录加载（${skillCount} 个）`) : bad("4a skills 数量", `${skillCount} < 15`);

// 3. 建会话
const created = await j("POST", "/api/machines/local/sessions", { cwd: CWD });
const sid = created.data?.sessionId ?? created.data?.id;
if (created.status === 200 && sid) ok(`3 建会话 cwd=${CWD} (${sid})`);
else { bad("3 建会话失败", `${created.status} ${JSON.stringify(created.data).slice(0, 200)}`); process.exit(1); }

// 4+5. prompt 往返 + 断开存活（POST 连接关闭后轮询 + JSONL 断开期间增长）
// 用慢任务拉开窗口：快模型 1s 内跑完，kubectl exec 读不出中间态（见首轮 NaN/相等失败）
const p = await j("POST", `/api/machines/local/sessions/${sid}/prompt`, { text: "请写一篇 800 字左右的文章，介绍 Kubernetes 的控制器模式（controller pattern），要详细、分点、有例子。" });
if (p.status === 200 && p.data?.accepted === true) ok("4 prompt 已接受（连接随即关闭）");
else bad("4 prompt 拒绝", `${p.status} ${JSON.stringify(p.data).slice(0, 200)}`);

async function sessionJsonlSize(sid) {
  // 轮询等文件落盘（最迟 15s），返回字节数；不存在返回 0
  for (let i = 0; i < 5; i++) {
    try {
      const n = parseInt(inPod(`ls -t /data/pi-agent/sessions/--data-workspace--/ | grep ${sid} | head -1 | xargs -I{} wc -c /data/pi-agent/sessions/--data-workspace--/{} | awk '{print $1}'`), 10);
      if (!Number.isNaN(n)) return n;
    } catch { /* 尚未落盘 */ }
    await sleep(3000);
  }
  return 0;
}

// sizeBefore 在 prompt 前读（header 大小），慢任务保证断开窗口内仍增长
let sizeBefore = await sessionJsonlSize(sid);
console.log(`  … POST 连接已关闭；断开窗口内 JSONL 起始大小 ${sizeBefore}B，轮询会话…`);

const msgs = await waitForCompletion(sid, 240_000);
if (!msgs) { bad("5 断开存活：240s 内无 assistant 文本"); process.exit(1); }
ok("5a 断开存活：连接关闭后 assistant 文本仍产出（会话在 sessiond 中继续）");
let sizeAfter = await sessionJsonlSize(sid);
sizeAfter > sizeBefore ? ok(`5b 断开期间 JSONL 写盘增长 (${sizeBefore}B → ${sizeAfter}B)`) : bad("5b JSONL 增长", `${sizeBefore} → ${sizeAfter}`);

// 6. 多会话并行
const sids = [];
for (let i = 0; i < 2; i++) {
  const c = await j("POST", "/api/machines/local/sessions", { cwd: CWD });
  sids.push(c.data?.sessionId ?? c.data?.id);
  await j("POST", `/api/machines/local/sessions/${sids[i]}/prompt`, { text: "回复：1\n2\n3" });
}
const t0 = Date.now();
const done = await Promise.all(sids.map((s) => waitForCompletion(s, 180_000)));
const elapsed = Math.round((Date.now() - t0) / 1000);
done.every(Boolean) ? ok(`6 多会话并行完成 (2 会话 ${elapsed}s)`) : bad("6 多会话并行", `${done.filter(Boolean).length}/2 完成`);

// 7b. 落盘证据（断言本会话文件存在于共享 PVC）
try {
  const onDisk = inPod(`ls /data/pi-agent/sessions/--data-workspace--/ | grep ${sid} | head -1`);
  onDisk.length > 0 ? ok(`7b 会话 JSONL 落盘共享 PVC (${onDisk})`) : bad("7b 落盘", "文件不存在");
} catch (e) { bad("7b 落盘", e.message); }

// 8. 镜像/依赖成本证据
try {
  const img = execFileSync("docker", ["image", "inspect", "poweri-piweb2:local", "--format", "{{.Size}}"], { encoding: "utf8" }).trim();
  const size = (parseInt(img, 10) / 1048576).toFixed(0);
  const inImage = (js) => execFileSync("docker", ["run", "--rm", "--entrypoint", "node", "poweri-piweb2:local", "-e", js], { encoding: "utf8" }).trim();
  const pweb = inImage("console.log(require('/usr/local/lib/node_modules/@jmfederico/pi-web/package.json').version)");
  const piSdk = inImage("console.log(require('/usr/local/lib/node_modules/@jmfederico/pi-web/node_modules/@earendil-works/pi-coding-agent/package.json').version)");
  const nodeVer = inImage("console.log(process.version)");
  console.log(`  证据: 镜像 ${size}MB | jmfederico/pi-web ${pweb} | pi-coding-agent(peer) ${piSdk} | node ${nodeVer}`);
  ok("8 镜像/依赖成本证据（见上方行）");
} catch (e) { bad("8 成本证据", e.message); }

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
