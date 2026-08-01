// ticket 19 验证：gateway + worker 全 K8s 部署 + 密钥 Secret 化
// 流程：构造引用版 pi 配置（apiKey=$POWERI_AI_API_KEY）→ gen-k8s（Secret 含密钥、ConfigMap 无密钥）
//       → 请求 K8s 内 gateway（NodePort 31080）→ 真实模型回复 → worker PVC 落会话
// 前置：OrbStack K8s；poweri-gateway:local / poweri-worker:local 镜像；项目 deploy/config/pi/models.json（gen-pi-config 生成）
// 运行：node scripts/verify-19.mjs [alice,...]   （默认 alice,bob）
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const assert = (cond, msg) => { if (!cond) { console.error(`✖ ${msg}`); process.exitCode = 1; } else console.log(`✔ ${msg}`); };
const run = (args) => execFileSync("kubectl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const NS = "poweri";
const GATEWAY_NODEPORT = 31080;
const CONFIG_SRC = process.env.POWERI_PI_CONFIG_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "deploy", "config", "pi");
const users = (process.argv[2] ?? "alice,bob").split(",").map((s) => s.trim()).filter(Boolean);

console.log("── Part 0: 前置检查 ──");
try { run(["get", "ns", NS]); assert(true, "K8s 可用"); } catch { assert(false, "K8s 不可用（OrbStack 需启用）"); }
for (const img of ["poweri-gateway:local", "poweri-worker:local"]) {
  try { execFileSync("docker", ["image", "inspect", img], { stdio: "ignore" }); assert(true, `镜像 ${img} 存在`); }
  catch { assert(false, `镜像 ${img} 缺失（node scripts/build-gateway.mjs / build-image.mjs）`); }
}
const srcModels = path.join(CONFIG_SRC, "models.json");
if (!fs.existsSync(srcModels)) { console.error("✖ 缺少平台配置：" + srcModels + "（先 npm run gen:pi-config）"); process.exit(1); }
const modelCfg = JSON.parse(fs.readFileSync(srcModels, "utf8"));
const rawKey = modelCfg.providers?.["poweri-gw"]?.apiKey ?? "";
assert(Boolean(rawKey), "平台配置含 apiKey");

console.log("── Part 1: 引用版配置（apiKey=$POWERI_AI_API_KEY，ConfigMap 无明文）──");
const refDir = fs.mkdtempSync(path.join(os.tmpdir(), "p19-"));
const refKey = rawKey.startsWith("$") ? rawKey : "$POWERI_AI_API_KEY";
const refCfg = JSON.parse(JSON.stringify(modelCfg));
refCfg.providers["poweri-gw"].apiKey = refKey;
fs.writeFileSync(path.join(refDir, "models.json"), JSON.stringify(refCfg, null, 2) + "\n");
fs.cpSync(path.join(CONFIG_SRC, "settings.json"), path.join(refDir, "settings.json"), { force: true });
assert(true, "引用版配置已构造（apiKey=" + refKey + "）");

console.log("── Part 2: 部署（gen-k8s，Secret 从 env 提取 apiKey）──");
const gwApiKey = rawKey.startsWith("$") ? process.env.POWERI_AI_API_KEY : rawKey;
if (!gwApiKey) { console.error("✖ 无法取得 apiKey（配置为 $ENV 引用且 POWERI_AI_API_KEY 未设置）"); process.exit(1); }
try {
  execFileSync("node", ["scripts/gen-k8s.mjs", users.join(",")], {
    stdio: ["inherit"], env: { ...process.env, POWERI_PI_CONFIG_DIR: refDir, POWERI_AI_API_KEY: gwApiKey },
  });
  assert(true, "gen-k8s 部署完成");
} catch { assert(false, "gen-k8s 部署失败（见上方输出）"); }

console.log("── Part 3: 密钥位置断言 ──");
const cmYaml = run(["get", "configmap", "pi-config", "-n", NS, "-o", "yaml"]);
assert(!cmYaml.includes(gwApiKey), "ConfigMap 不含明文 apiKey");
assert(cmYaml.includes("$POWERI_AI_API_KEY"), "ConfigMap 中 apiKey 为 $ENV 引用");
const secretData = run(["get", "secret", "poweri-secrets", "-n", NS, "-o", "jsonpath={.data}"]);
const secretB64 = Buffer.from(secretData.replace(/["{}]/g, "").split(",").find((p) => p.startsWith("POWERI_AI_API_KEY")).split(":")[1], "base64").toString();
assert(secretB64 === gwApiKey, "Secret 含真实 apiKey");

console.log("── Part 4: 全链路请求（gateway pod → worker pod → pi → 模型）──");
const token = (process.env.POWERI_GATEWAY_USERS ?? "alice:token-a;bob:token-b").split(";").find((p) => p.startsWith(users[0] + ":")).split(":")[1];
// NodePort 生效有延迟，轮询就绪（最多 60s），就绪后继续用最后一次成功响应
let res = null;
for (let i = 0; i < 60 && !res; i++) {
  try {
    const c = await fetch(`http://127.0.0.1:${GATEWAY_NODEPORT}/v1/chat`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ session: "new", message: "回复两个字：收到" }),
    });
    if (c.status === 200) res = c;
  } catch {}
  if (!res) await new Promise((r) => setTimeout(r, 1000));
}
assert(Boolean(res), `gateway NodePort ${GATEWAY_NODEPORT} 就绪并响应 200`);
const body = await res.text();
const events = body.split("\n").filter((l) => l.startsWith("data: ")).map((l) => { try { return JSON.parse(l.slice(6)).type; } catch { return null; } }).filter(Boolean);
assert(events.includes("message_start") && events.includes("message_end"), `消息流事件（${events.join(",")}）`);
assert(events.includes("agent_settled"), "agent_settled（整轮完成）");

console.log("── Part 5: 会话落 worker PVC ──");
try {
  const files = run(["exec", `deploy/worker-${users[0]}`, "-n", NS, "--", "ls", "/home/piuser/.pi/agent/sessions"]).trim();
  assert(files.length > 0, `worker PVC 会话文件（${files.split("\n").length} 个）`);
} catch { assert(false, "worker PVC 会话读取失败"); }

console.log(`\n完成：gateway 在 K8s（NodePort ${GATEWAY_NODEPORT}），密钥仅存 Secret，ConfigMap 无明文。`);
console.log("清理：kubectl delete -n poweri deploy/gateway deploy/worker-alice deploy/worker-bob svc/gateway svc/worker-alice svc/worker-bob pvc/gateway-pvc pvc/alice-pvc pvc/bob-pvc configmap/pi-config secret/poweri-secrets");
