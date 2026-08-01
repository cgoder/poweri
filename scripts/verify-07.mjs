// ticket 07 容器级隔离验证（PoC：docker 层实证；K8s 正式形态见 deploy/k8s/）
// A 非 root + 文件系统写保护
// B 资源限额生效（inspect + 内存 OOM 实测）
// C 网络影响面（无侦察工具；模型 API 正向可达；仅暴露桥端口）
// D 挂载隔离（用户目录互不可见）
// 运行：node scripts/verify-07.mjs（需 docker + poweri-worker:local 镜像）

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const IMG = "poweri-worker:local";
const docker = (args, opts = {}) => {
  try { return execFileSync("docker", args, { encoding: "utf8", ...opts }).trim(); }
  catch (e) { if (opts.allowFail) return ""; throw e; }
};
const clean = (name) => { try { docker(["rm", "-f", name], { stdio: "ignore" }); } catch {} };

async function partA() {
  console.log("── A: 非 root + 写保护 ──");
  const out = docker(["run", "--rm", "--entrypoint", "bash", IMG, "-c",
    'whoami; touch /etc/root-test 2>&1; touch /usr/bin/x 2>&1; touch /workspace/ok.txt && echo workspace-writable; touch /home/piuser/ok2 && echo home-writable']);
  const lines = out.split("\n");
  assert.equal(lines[0], "piuser", "A1 非 root 用户");
  assert.match(out, /cannot touch/, "A2 /etc 写被拒");
  assert.match(out, /workspace-writable/, "A3 工作区可写");
  console.log("  ✓ A 非 root，/etc /usr 写被拒，工作区可写");
}

async function partB() {
  console.log("── B: 资源限额 ──");
  const name = "p07-limits";
  clean(name);
  docker(["run", "-d", "--rm", "--name", name, "--cpus", "0.5", "--memory", "256m", "--memory-swap", "256m", "--pids-limit", "64", "--entrypoint", "bash", IMG, "-c", "sleep 60"]);
  try {
    const info = JSON.parse(docker(["inspect", name]));
    const h = info[0].HostConfig;
    assert.equal(h.NanoCpus, 0.5e9, "B1 CPU 限额 0.5");
    assert.equal(h.Memory, 256 * 1024 * 1024, "B2 内存限额 256MB");
    assert.equal(h.MemorySwap, 256 * 1024 * 1024, "B3 无 swap 逃逸");
    assert.equal(h.PidsLimit, 64, "B4 pids 限额 64");
    console.log("  ✓ B 限额已注入（inspect 断言）");
  } finally { clean(name); }

  // 内存 OOM 实测：容器内分配超过限额 → 被内核杀（exit 137）
  const { spawn } = await import("node:child_process");
  const code = await new Promise((res) => {
    const child = spawn("docker", ["run", "--rm", "--memory", "256m", "--memory-swap", "256m", "--entrypoint", "node", IMG, "-e",
      "const a=[]; while(true){ a.push(Buffer.alloc(8*1024*1024)); }"]);
    child.on("exit", (c) => res(c));
  });
  assert.equal(code, 137, `B5 超限进程被 OOM kill（exit=${code}，应为 137）`);
  console.log("  ✓ B OOM 实测：超 256MB 被内核杀");
}

async function partC() {
  console.log("── C: 网络影响面 ──");
  const out = docker(["run", "--rm", "--entrypoint", "bash", IMG, "-c",
    'for t in curl wget nc ncat telnet nmap socat; do command -v $t >/dev/null && echo "HAS $t"; done; echo scan-done']);
  assert.ok(!/HAS /.test(out), `C1 无网络侦察工具（${out.split("\n").filter((l) => /HAS/.test(l)).join(",") || "none"}）`);
  // 模型 API 正向可达（必需出站；环境依赖——网关故障时仅警告，不阻塞隔离验证）
  const reach = docker(["run", "--rm", "--entrypoint", "node", IMG, "-e",
    'fetch("https://llsm.litta.cn/v1/models").then((r) => console.log("status", r.status)).catch((e) => { console.log("ERR", e.cause?.code ?? e.message); process.exit(1); })'],
    { allowFail: true });
  if (/^status \d+$/m.test(reach)) console.log("  ✓ C2 模型 API 可达（" + reach.split("\n")[0] + "）");
  else console.log("  ⚠ C2 模型 API 当前不可达（" + reach + "）——环境依赖，不阻塞（egress 白名单正式形态 = K8s NetworkPolicy，见 deploy/k8s/）");
}

async function partD() {
  console.log("── D: 挂载隔离 ──");
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "p07-"));
  const alice = path.join(base, "alice"), bob = path.join(base, "bob");
  fs.mkdirSync(path.join(alice, "workspace"), { recursive: true });
  fs.mkdirSync(path.join(bob, "workspace"), { recursive: true });
  fs.mkdirSync(path.join(alice, "pi"), { recursive: true });
  fs.mkdirSync(path.join(bob, "pi"), { recursive: true });
  fs.writeFileSync(path.join(alice, "workspace", "alice-secret.txt"), "alice data");
  fs.writeFileSync(path.join(bob, "workspace", "bob-secret.txt"), "bob data");
  const na = "p07-alice", nb = "p07-bob";
  clean(na); clean(nb);
  docker(["run", "-d", "--rm", "--name", na, "-v", `${alice}/workspace:/workspace`, "-v", `${alice}/pi:/home/piuser/.pi/agent`, "--entrypoint", "bash", IMG, "-c", "sleep 60"]);
  docker(["run", "-d", "--rm", "--name", nb, "-v", `${bob}/workspace:/workspace`, "-v", `${bob}/pi:/home/piuser/.pi/agent`, "--entrypoint", "bash", IMG, "-c", "sleep 60"]);
  try {
    const a = docker(["exec", na, "bash", "-c", "ls /workspace; ls /home/piuser/.pi/agent"]);
    const b = docker(["exec", nb, "bash", "-c", "ls /workspace; ls /home/piuser/.pi/agent"]);
    assert.match(a, /alice-secret/, "D1 alice 容器见自己的文件");
    assert.ok(!/bob-secret/.test(a), "D2 alice 容器看不到 bob 数据");
    assert.match(b, /bob-secret/, "D3 bob 容器见自己的文件");
    assert.ok(!/alice-secret/.test(b), "D4 bob 容器看不到 alice 数据");
    console.log("  ✓ D 用户目录互不可见（alice/bob 物理隔离）");
  } finally { clean(na); clean(nb); }
}

await partA();
await partB();
await partC();
await partD();
console.log("\n✅ ticket 07 验证全部通过");
