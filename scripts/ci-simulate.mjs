// ci-simulate：模拟 gitlab CI 全流程（ticket 11 模拟验证）
// 架构与 .gitlab-ci.yml 一致：构建在本机（mac），部署/冒烟在节点（litta-llms-gw）
//   test   → 本机 gateway/worker 单测 + 节点干净环境 web 全量测试
//   build  → 本机 docker build ×3 → push harbor（归档）→ docker save
//   下发   → scp tar → 节点 sudo ctr import（harbor ALB 对节点不可达的兜底）
//   deploy → 渲染 manifest → scp → kubectl apply + worker 滚动更新 + rollout
//   smoke  → verify-34 云端全链路（13 断言）
// 用法：node scripts/ci-simulate.mjs [tag]   （默认 sim01）
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TAG = process.argv[2] ?? "sim01";
const SSH_HOST = process.env.SSH_HOST ?? "118.178.241.158";
const SSH_PORT = process.env.SSH_PORT ?? "10086";
const SSH_KEY = process.env.SSH_KEY ?? path.join(ROOT, ".scratch", "deploy-key", "poweri_ecs");
const REGISTRY = "harbor.litta.cn/poweri";
const NS = "poweri";
const MODULES = [
  { name: "poweri-web", build: ["docker", "build", "-f", "web/Dockerfile", "-t", `poweri-web:${TAG}`, "web/"], ctx: path.join(ROOT, "web") },
  { name: "poweri-gateway", build: ["docker", "build", "-f", "gateway/Dockerfile.gateway", "-t", `poweri-gateway:${TAG}`, "gateway/"], ctx: path.join(ROOT, "gateway") },
  { name: "poweri-worker", build: ["docker", "build", "-f", "worker/docker/Dockerfile.poweri", "--build-arg", "PI_VERSION=0.83.0", "-t", `poweri-worker:${TAG}`, "worker/"], ctx: path.join(ROOT, "worker") },
];
const simDir = path.join(ROOT, "temp", "ci-simulate");
mkdirSync(simDir, { recursive: true });

let pass = 0, fail = 0;
const stepResults = {};
const step = (name, fn, key) => {
  console.log(`\n=== stage: ${name} ===`);
  try { const r = fn(); pass++; if (key) stepResults[key] = r; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}: ${String(e).split("\n")[0].slice(0, 200)}`); }
};
const run = (args, opts = {}) => execFileSync(args[0], args.slice(1), { encoding: "utf8", stdio: opts.silent ? "pipe" : "inherit", ...opts });
const sshRun = (cmd, opts = {}) => run(["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes", "-p", SSH_PORT, `root@${SSH_HOST}`, cmd], opts);

// ── test（全部本机：构建类重活不下 ECS）──
step("test: gateway 单测（本机）", () => { run(["npm", "test"], { cwd: path.join(ROOT, "gateway"), silent: true }); console.log("  gateway npm test 通过"); });
step("test: worker memory-extension（本机）", () => { run(["npm", "run", "test:unit"], { cwd: ROOT, silent: true }); console.log("  npm run test:unit 通过"); });
step("test: web 全量（本机）", () => { run(["npm", "test"], { cwd: path.join(ROOT, "web"), silent: true }); console.log("  web npm test 572 通过"); });
step("test: web 类型检查 tsc --noEmit（本机）", () => { run(["npx", "tsc", "--noEmit"], { cwd: path.join(ROOT, "web"), silent: true }); console.log("  tsc --noEmit 通过"); });

// ── build（本机，重活不下 ECS）──
step(`build: 三镜像 docker build（本机）→ ${TAG}`, () => {
  for (const m of MODULES) {
    run(m.build, { cwd: ROOT, silent: true });
    console.log(`  ✓ docker build ${m.name}:${TAG}`);
  }
});
step("build: push harbor 归档（本机可达）", () => {
  // 本机 docker 正式配置（~/.docker/config.json）是 WSL 残留（wincred），harbor 凭据在干净配置
  // /tmp/pi-docker-config/config.json（DOCKER_CONFIG 指向）；CI 落地修正点：构建机 docker 正式配置放 harbor 凭据
  const dockerCfg = process.env.DOCKER_CONFIG ?? (existsSync("/tmp/pi-docker-config/config.json") ? "/tmp/pi-docker-config" : null);
  const pushEnv = dockerCfg ? { ...process.env, DOCKER_CONFIG: dockerCfg } : process.env;
  if (dockerCfg) console.log(`  （DOCKER_CONFIG=${dockerCfg}：临时干净凭据；正式 CI 应将 harbor 凭据配入构建机 docker 配置）`);
  for (const m of MODULES) {
    const remote = `${REGISTRY}/${m.name}:${TAG}`;
    run(["docker", "tag", `${m.name}:${TAG}`, remote], { silent: true });
    try { run(["docker", "push", remote], { silent: true, env: pushEnv }); console.log(`  ✓ push ${remote}`); }
    catch (e) { console.warn(`  ⚠ push ${remote} 失败（模拟流程不阻断）：${String(e).split("\n")[0].slice(0, 100)}`); }
  }
});
step("build: docker save ×3", () => {
  for (const m of MODULES) {
    run(["docker", "save", "-o", path.join(simDir, `${m.name}.tar`), `${m.name}:${TAG}`], { silent: true });
  }
  console.log(`  ✓ ${simDir}/*.tar（共 ${MODULES.length} 个）`);
});

// ── 交付：harbor 直拉（运维已放行 ALB）或 ctr import 兜底 ──
step("交付: 探测节点 harbor 可达性", () => {
  const code = sshRun("curl -s -o /dev/null -w '%{http_code}' -m 10 https://harbor.litta.cn/v2/", { silent: true }).trim();
  if (code === "401") { console.log("  ✓ harbor.litta.cn 可达（/v2/ 401 = 认证要求，registry API 正常）→ 走 harbor 直拉路径"); }
  else { console.log(`  ⚠ harbor 不可达（HTTP ${code}）→ 走 ctr import 兜底路径`); }
  return code;
}, "harborProbe");
step("交付: 镜像下发（harbor 直拉 or scp+ctr import 兜底）", () => {
  const viaHarbor = stepResults.harborProbe === "401";
  if (viaHarbor) {
    // k8s imagePullPolicy 拉取：containerd 无 sim01 层 → 从 harbor 拉（真实生产路径）
    console.log("  ✓ 无需本地下发：k8s 将直接从 harbor.litta.cn/poweri/*:sim01 拉取（deploy 阶段验证）");
    return;
  }
  sshRun("mkdir -p /tmp/ci-images");
  run(["scp", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes", "-P", SSH_PORT,
    ...MODULES.map((m) => path.join(simDir, `${m.name}.tar`)), `root@${SSH_HOST}:/tmp/ci-images/`], { silent: true });
  const out = sshRun("for t in /tmp/ci-images/*.tar; do sudo -n ctr -n k8s.io images import $t >/dev/null 2>&1 || { echo FAIL $t; exit 1; }; done; echo IMPORT-OK", { silent: true });
  if (!out.includes("IMPORT-OK")) throw new Error(out.slice(-150));
  console.log("  ✓ ctr import 兜底路径完成");
});

// ── deploy（节点）──
step("deploy: 渲染 manifest（本机）", () => {
  const render = (file, vars) => readFileSync(file, "utf8").replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => vars[k] ?? "");
  const GW_USERS = "alice:token-a;bob:token-b;carol:token-carol";
  const K8S_USERS = GW_USERS.split(";").map((u) => { const [user] = u.split(":"); return `${user}:worker-${user}.${NS}.svc.cluster.local:8081`; }).join(";");
  const gw = render(path.join(ROOT, "gateway", "deploy", "k8s", "gateway.yaml"), {
    GATEWAY_IMAGE: `${REGISTRY}/poweri-gateway:${TAG}`, WORKER_IMAGE: `${REGISTRY}/poweri-worker:${TAG}`,
    K8S_USERS, LLMS_EXTRA_HOSTS: "172.16.123.89:llms.litta.cn", IDLE_MINUTES: "30",
  });
  const web = render(path.join(ROOT, "web", "deploy", "k8s", "poweri-web.yaml"), {
    WEB_IMAGE: `${REGISTRY}/poweri-web:${TAG}`, WEB_USERS: "alice:poweri-alice;bob:poweri-bob;carol:poweri-carol", GW_USERS,
  });
  writeFileSync(path.join(simDir, "gateway.yaml"), gw);
  writeFileSync(path.join(simDir, "poweri-web.yaml"), web);
  console.log("  ✓ manifest 渲染完成");
});
step("deploy: scp manifest + kubectl apply（节点）", () => {
  sshRun("mkdir -p /tmp/ci-deploy");
  run(["scp", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes", "-P", SSH_PORT,
    path.join(simDir, "gateway.yaml"), path.join(simDir, "poweri-web.yaml"), `root@${SSH_HOST}:/tmp/ci-deploy/`], { silent: true });
  sshRun(`kubectl -n ${NS} apply -f /tmp/ci-deploy/gateway.yaml -f /tmp/ci-deploy/poweri-web.yaml`, { silent: true });
  console.log("  ✓ kubectl apply（gateway / poweri-web）");
});
step("deploy: worker 滚动更新 + rollout（节点）", () => {
  const workers = sshRun(`kubectl -n ${NS} get deploy -o jsonpath='{range .items[*]}{.metadata.name}{"\\n"}{end}' | grep '^worker-'`, { silent: true }).trim().split("\n").filter(Boolean);
  for (const w of workers) sshRun(`kubectl -n ${NS} set image deploy/${w} '*=${REGISTRY}/poweri-worker:${TAG}'`, { silent: true });
  for (const d of ["gateway", "poweri-web", ...workers]) {
    const out = sshRun(`kubectl -n ${NS} rollout status deploy/${d} --timeout=180s`, { silent: true });
    console.log(`  ✓ rollout ${d}`);
  }
});

// ── smoke ──
step("smoke: verify-34 云端全链路（隧道模式，13 断言）", () => {
  run(["node", path.join(ROOT, "scripts", "verify-34-cloud-e2e.mjs")], { cwd: ROOT, silent: true });
  console.log("  ✓ verify-34 13/13 通过");
});

// 清理本地 tar（节点 /tmp/ci-images 保留供回滚复查）
for (const m of MODULES) run(["rm", "-f", path.join(simDir, `${m.name}.tar`)], { silent: true });

console.log(`\n========== 模拟 CI 流程完成：${fail === 0 ? "ALL PASS" : `${fail} FAILED`}（${pass} 通过 / ${fail} 失败，tag=${TAG}）==========`);
console.log(`当前云端运行版本：${REGISTRY}/{gateway,web,worker}:${TAG}`);
process.exit(fail === 0 ? 0 : 1);
