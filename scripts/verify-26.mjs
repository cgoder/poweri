// verify-26：PowerI-Web 容器化验证（ticket 26）
// 前置：网关在 127.0.0.1:31080（gen-k8s.mjs alice,bob 部署）；PowerI-Web 仓库在 /Users/tianzhao/code/leoao/poweri-web
// 用法：node scripts/verify-26.mjs
import { execFileSync } from "node:child_process";

const WEB_REPO = "/Users/tianzhao/code/leoao/poweri-web";
const IMG = "poweri-web:local";
const PORT = 30341; // 容器映射端口
const PASS = "poweri-alice";
const auth = `Basic ${Buffer.from(`pi:${PASS}`).toString("base64")}`;
let passed = 0, failed = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`✓ ${name}${extra ? " — " + extra : ""}`); }
  else { failed++; console.log(`✗ ${name}${extra ? " — " + extra : ""}`); }
};

function get(path, headers = {}) {
  return new Promise((resolve) => {
    const u = new URL(`http://127.0.0.1:${PORT}${path}`);
    const r = new fetch(u, { headers });
    r.then(async (res) => resolve({ status: res.status, body: await res.text() }))
      .catch((e) => resolve({ status: 0, body: String(e) }));
  });
}

try {
  // 1. 构建镜像
  console.log("── 1. 构建镜像 ──");
  execFileSync("node", ["scripts/build-image.mjs"], { cwd: WEB_REPO, stdio: "inherit" });

  // 2. 起容器（网关指向宿主机 31080）
  console.log("── 2. 起容器 ──");
  execFileSync("docker", ["rm", "-f", "poweriweb-verify"], { stdio: "ignore" });
  execFileSync("docker", [
    "run", "-d", "--name", "poweriweb-verify",
    "-p", `${PORT}:30141`,
    "-e", "POWERI_GATEWAY_URL=http://host.docker.internal:31080",
    "-e", "POWERI_GATEWAY_TOKEN=token-a",
    "-e", "POWERI_GATEWAY_CWD=/workspace",
    "-e", `POWERI_WEB_PASSWORD=${PASS}`,
    IMG,
  ], { stdio: "ignore" });

  // 3. 等启动（next start ~60s 首次编译）
  console.log("── 3. 等待就绪 ──");
  let ready = false;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const { status } = await get("/");
    if (status > 0) { ready = true; break; }
  }
  ok("容器 120s 内就绪（HTTP 可达）", ready);

  // 4. 镜像元数据
  const insp = JSON.parse(execFileSync("docker", ["inspect", IMG], { encoding: "utf8" }))[0];
  const sizeMB = Math.round(insp.Size / 1024 / 1024);
  ok("镜像构建成功且尺寸 < 1GB（上游 piweb 1.11GB）", sizeMB < 1024, `${sizeMB}MB`);
  const nodeV = execFileSync("docker", ["run", "--rm", "--entrypoint", "node", IMG, "--version"], { encoding: "utf8" }).trim();
  ok("容器内 Node 24", nodeV.startsWith("v24"), nodeV);
  const piV = execFileSync("docker", ["run", "--rm", "--entrypoint", "node", IMG, "-e",
    "console.log(JSON.parse(require('fs').readFileSync('/app/node_modules/@earendil-works/pi-coding-agent/package.json')).version)"], { encoding: "utf8" }).trim();
  ok("容器内 pi 0.83.0", piV === "0.83.0", piV);

  // 5. 认证
  const noAuth = await get("/");
  ok("无凭据拒绝（非 200）", noAuth.status !== 200, `HTTP ${noAuth.status}`);
  const authed = await get("/", { Authorization: auth });
  ok("Basic Auth 200", authed.status === 200, `HTTP ${authed.status}`);

  // 6. 网关模式接线
  const models = await get("/api/models-config", { Authorization: auth });
  ok("模型面板单 poweri-gw/agent", models.status === 200 && models.body.includes('"poweri-gw"') && models.body.includes('"agent"'));
  const sess = await get("/api/sessions", { Authorization: auth });
  let n = 0;
  try { n = JSON.parse(sess.body).sessions.length; } catch { }
  ok("会话列表经网关非空（>0）", sess.status === 200 && n > 0, `${n} 个会话`);

  console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
} finally {
  execFileSync("docker", ["rm", "-f", "poweriweb-verify"], { stdio: "ignore" });
  process.exit(failed ? 1 : 0);
}
