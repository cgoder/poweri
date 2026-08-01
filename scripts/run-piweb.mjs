// ticket 15 每测试用户一个 pi-web 实例的编排脚本
// pi-web（进程内 SDK 驱动 pi@0.83.0）直接读/写该用户 PVC 布局的 .pi/agent 与 workspace，
// 每实例独立 Basic Auth → 多用户可视化并发、隔离与续接验证的落地工具。
//
// 用法：
//   node scripts/run-piweb.mjs start alice,bob,carol   # 播种用户目录 + 启动每用户实例
//   node scripts/run-piweb.mjs stop [users]            # 停止实例（默认全部 poweri-piweb-*）
//   node scripts/run-piweb.mjs status                  # 实例/端口/密码表
//   node scripts/run-piweb.mjs seed alice,bob          # 仅播种用户目录（不启动）
//
// 约定：
//   - 用户目录布局与网关 docker provider 一致：<POWERI_DATA_DIR>/users/<user>/{.pi/agent,workspace}
//   - 端口矩阵：POWERI_PIWEB_BASE_PORT（默认 30141）+ 用户序号（alice→30141, bob→30142, …）
//   - 密码：POWERI_PIWEB_PASSWORD_<USER> 可覆盖，默认 poweri-<user>（测试环境，仅提示勿外泄）
//   - 镜像：POWERI_PIWEB_IMAGE（默认 poweri-piweb:local，node scripts/build-piweb.mjs 构建）

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const DATA_DIR = process.env.POWERI_DATA_DIR ?? path.join(process.cwd(), "data");
const IMAGE = process.env.POWERI_PIWEB_IMAGE ?? "poweri-piweb:local";
const BASE_PORT = Number(process.env.POWERI_PIWEB_BASE_PORT ?? 30141);
const CONTAINER_PORT = 30141; // 镜像内 pi-web 默认监听端口
const HOST_PI_CONFIG = path.join(homedir(), ".pi", "agent"); // 宿主已由 gen-pi-config 生成的 pi 配置

const userDir = (u) => path.join(DATA_DIR, "users", u);
const userPiDir = (u) => path.join(userDir(u), ".pi", "agent");
const userWsDir = (u) => path.join(userDir(u), "workspace");
const containerName = (u) => `poweri-piweb-${u}`;
const portOf = (u, idx) => BASE_PORT + idx;
const pwOf = (u) => process.env[`POWERI_PIWEB_PASSWORD_${u.toUpperCase()}`] ?? `poweri-${u}`;

function seedUser(u) {
  const piDir = userPiDir(u);
  mkdirSync(path.join(piDir, "sessions"), { recursive: true });
  for (const f of ["models.json", "settings.json"]) {
    const src = path.join(HOST_PI_CONFIG, f);
    if (existsSync(src)) copyFileSync(src, path.join(piDir, f));
  }
  mkdirSync(userWsDir(u), { recursive: true });
  const missing = ["models.json", "settings.json"].filter((f) => !existsSync(path.join(piDir, f)));
  if (missing.length) {
    console.warn(`  ⚠ ${u} 缺少 ${missing.join("/")}（宿主 ~/.pi/agent 未生成配置；先 npm run gen:pi-config）`);
  }
}

function docker(args) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function startInstance(u, idx) {
  seedUser(u);
  const port = portOf(u, idx);
  docker(["run", "-d", "--rm", "--name", containerName(u),
    "-p", `127.0.0.1:${port}:${CONTAINER_PORT}`,
    "-v", `${userPiDir(u)}:/home/piuser/.pi/agent`,
    "-v", `${userWsDir(u)}:/workspace`,
    "-e", `PI_WEB_PASSWORD=${pwOf(u)}`,
    IMAGE,
  ]);
  return port;
}

function listRunning() {
  try {
    return docker(["ps", "--filter", "name=^/poweri-piweb-", "--format", "{{.Names}}"]).split("\n").filter(Boolean);
  } catch { return []; }
}

const [cmd, argList] = process.argv.slice(2);
const users = (argList ?? "").split(",").filter(Boolean);

switch (cmd) {
  case "start": {
    if (!users.length) { console.error("用法：node scripts/run-piweb.mjs start alice,bob"); process.exit(1); }
    const table = [];
    for (const [i, u] of users.entries()) {
      const port = startInstance(u, i);
      table.push({ user: u, url: `http://127.0.0.1:${port}`, password: pwOf(u) });
      console.log(`  ▶ ${u} → http://127.0.0.1:${port}（容器 ${containerName(u)}，密码 ${pwOf(u)}）`);
    }
    console.log("\n各实例等待几秒就绪后浏览器打开上表 URL，用户名固定为 pi。");
    break;
  }
  case "stop": {
    const targets = users.length ? users.map(containerName) : listRunning();
    if (!targets.length) { console.log("无运行中的 pi-web 实例"); break; }
    for (const t of targets) {
      try { docker(["rm", "-f", t]); console.log(`  ✕ 已停止 ${t}`); }
      catch { console.log(`  无 ${t}`); }
    }
    break;
  }
  case "status": {
    const running = listRunning();
    if (!running.length) { console.log("无运行中的 pi-web 实例（node scripts/run-piweb.mjs start alice,bob）"); break; }
    console.log("运行中的 pi-web 实例：");
    for (const name of running) {
      const u = name.replace(/^poweri-piweb-/, "");
      const idx = 0; // status 无法可靠回溯序号；从容器内取监听端口
      let port = "";
      try { port = docker(["port", name, "30141/tcp"]).split("->").pop()?.trim() ?? ""; } catch {}
      console.log(`  ${name}  ${port ? "http://" + port : "(端口未知)"}  密码 ${pwOf(u)}`);
    }
    break;
  }
  case "seed": {
    if (!users.length) { console.error("用法：node scripts/run-piweb.mjs seed alice,bob"); process.exit(1); }
    for (const u of users) { seedUser(u); console.log(`  ✔ ${u} → ${userDir(u)}`); }
    break;
  }
  default: {
    console.log(`未知命令 "${cmd}"。可用：start <users> | stop [users] | status | seed <users>`);
    process.exit(1);
  }
}
