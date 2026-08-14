// deploy-cloud：云端部署闭环（ticket 10）——构建/推送完成后，把正式镜像部署到内网 k3s 并冒烟
// 用法：
//   node scripts/deploy-cloud.mjs <tag>            # 部署指定 tag 的三镜像（默认 20260814）
//   node scripts/deploy-cloud.mjs <tag> --smoke    # 部署 + 云端冒烟（认证/模型/会话链路探测）
// 环境：
//   SSH_HOST  默认 118.178.241.158（litta-llms-gw，k3s 单节点）
//   SSH_PORT  默认 10086
//   SSH_KEY   默认 .scratch/deploy-key/poweri_ecs（deploy 专用私钥）
//   USERS     默认 "alice:token-a;bob:token-b;carol:token-carol"（网关用户表，同 K8S_USERS 映射）
// 前置：
//   - 镜像已推送 harbor.litta.cn/poweri/<模块>:<tag>（见 README 部署章节的构建推送命令）
//   - 云端 Secret poweri-secrets 已存在（POWERI_AI_API_KEY/POWERI_GATEWAY_USERS/POWERI_UI_TOKEN/POWERI_WEB_PASSWORD）
//   - 云端 poweri namespace、PVC、gateway Service 已就位（首次部署先跑 gen-k8s 的 PVC/Secret 部分或手工创建）
// 职责：渲染 manifest（gateway.yaml / poweri-web.yaml）→ scp 上云 → kubectl apply →
//       滚动更新静态 worker Deployment 镜像 → 等待 rollout → （可选）冒烟验证
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TAG = process.argv[2] ?? "20260814";
const SMOKE = process.argv.includes("--smoke");
const SSH_HOST = process.env.SSH_HOST ?? "118.178.241.158";
const SSH_PORT = process.env.SSH_PORT ?? "10086";
const SSH_KEY = process.env.SSH_KEY ?? path.join(ROOT, ".scratch", "deploy-key", "poweri_ecs");
// 网关用户表（user:token）；同表也用于 web 的 GW_USERS 与 worker 静态映射（worker-<user>）
const GW_USERS = process.env.USERS ?? "alice:token-a;bob:token-b;carol:token-carol";
const WEB_USERS = process.env.WEB_USERS ?? "alice:poweri-alice;bob:poweri-bob;carol:poweri-carol";
const LLMS_EXTRA_HOSTS = process.env.LLMS_EXTRA_HOSTS ?? "172.16.123.89:llms.litta.cn";
const IDLE_MINUTES = process.env.IDLE_MINUTES ?? "30";
const REGISTRY = "harbor.litta.cn/poweri";
const NS = "poweri";

const sshBase = [
  "ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=8", "-o", "BatchMode=yes",
  "-p", SSH_PORT, `root@${SSH_HOST}`,
];
const run = (args, opts = {}) => execFileSync(args[0], args.slice(1), { encoding: "utf8", stdio: opts.silent ? "pipe" : "inherit", ...opts });
const sshRun = (cmd, opts = {}) => run([...sshBase, cmd], opts);

// ── 1. 渲染 manifest ──
function render(file, vars) {
  return readFileSync(file, "utf8").replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => vars[k] ?? "");
}
const deployDir = path.join(ROOT, "temp", "deploy-cloud");
mkdirSync(deployDir, { recursive: true });
const K8S_USERS = GW_USERS.split(";").map((u) => {
  const [user, token] = u.split(":");
  return `${user}:worker-${user}.${NS}.svc.cluster.local:8081`;
}).join(";");
const gwYaml = render(path.join(ROOT, "gateway", "deploy", "k8s", "gateway.yaml"), {
  GATEWAY_IMAGE: `${REGISTRY}/poweri-gateway:${TAG}`,
  WORKER_IMAGE: `${REGISTRY}/poweri-worker:${TAG}`,
  K8S_USERS,
  LLMS_EXTRA_HOSTS,
  IDLE_MINUTES,
});
const webYaml = render(path.join(ROOT, "web", "deploy", "k8s", "poweri-web.yaml"), {
  WEB_IMAGE: `${REGISTRY}/poweri-web:${TAG}`,
  WEB_USERS,
  GW_USERS,
});
writeFileSync(path.join(deployDir, "gateway.yaml"), gwYaml);
writeFileSync(path.join(deployDir, "poweri-web.yaml"), webYaml);
console.log(`✓ manifest 渲染完成（tag=${TAG}，users=${GW_USERS.split(";").map((u) => u.split(":")[0]).join(",")}）`);

// ── 2. 传上云并 apply ──
const remoteDir = `/tmp/poweri-deploy-${TAG}`;
run(["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes", "-p", SSH_PORT, `root@${SSH_HOST}`, `mkdir -p ${remoteDir}`], { silent: true });
run(["scp", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes", "-P", SSH_PORT, path.join(deployDir, "gateway.yaml"), path.join(deployDir, "poweri-web.yaml"), `root@${SSH_HOST}:${remoteDir}/`], { silent: true });
console.log(`✓ manifest 已上传（${SSH_HOST}:${remoteDir}）`);
sshRun(`kubectl -n ${NS} apply -f ${remoteDir}/gateway.yaml -f ${remoteDir}/poweri-web.yaml`);
console.log("✓ kubectl apply 完成（gateway / poweri-web）");

// ── 3. 滚动更新静态 worker Deployment（动态开通的 worker 由 gateway env POWERI_POD_IMAGE 驱动）──
const workers = sshRun(`kubectl -n ${NS} get deploy -o jsonpath='{range .items[*]}{.metadata.name}{"\\n"}{end}' | grep '^worker-'`, { silent: true }).trim().split("\n").filter(Boolean);
for (const w of workers) {
  sshRun(`kubectl -n ${NS} set image deploy/${w} '*=${REGISTRY}/poweri-worker:${TAG}'`);
  console.log(`✓ worker 镜像更新：${w} → ${REGISTRY}/poweri-worker:${TAG}`);
}

// ── 4. 等待 rollout ──
for (const d of ["gateway", "poweri-web", ...workers]) {
  const out = sshRun(`kubectl -n ${NS} rollout status deploy/${d} --timeout=180s`, { silent: true });
  console.log(`✓ rollout ${d}: ${out.trim().split("\n").pop()}`);
}

// ── 5. 冒烟（可选）──
if (SMOKE) {
  console.log("── 冒烟验证 ──");
  const base = `http://${SSH_HOST}`;
  const curl = (args) => { try { return run(["curl", "-s", "-m", "10", "-o", "/dev/null", "-w", "%{http_code}", ...args], { silent: true }); } catch { return "000"; } };
  // gateway readyz（无认证；网关不暴露模型列表路由）
  const ready = curl([`${base}:31080/readyz`]);
  console.log(`gateway /readyz → HTTP ${ready}`);
  // web 网关模式守卫：无认证 401
  const anon = curl([`${base}:30341/`]);
  console.log(`web /（无认证）→ HTTP ${anon}`);
  // web 认证（Basic）
  const wu = WEB_USERS.split(";")[0];
  const [wuName, wuPass] = wu.split(":");
  const auth = curl(["-u", `${wuName}:${wuPass}`, `${base}:30341/`]);
  console.log(`web /（${wuName} Basic 认证）→ HTTP ${auth}`);
  console.log(ready === "200" && anon === "401" && auth === "200" ? "✅ 冒烟通过" : "⚠ 冒烟有异常（见上方状态码；NodePort 公网可达性受安全组限制时可改用 verify-34 隧道验证）");
}
console.log(`\n完成：harbor.litta.cn/poweri/{gateway,web,worker}:${TAG} 已部署到 ${SSH_HOST} k3s（${NS} namespace）`);
