// 把宿主业务 skill 播种进各用户 PVC 的 pi agent 目录（ticket 21）
// 用法: node worker/scripts/seed-skills.mjs [alice,bob] [skill1,skill2,...]
// 默认播种集：轻量自包含业务技能（纯 SKILL.md + 小脚本，无外部凭据）；
// 重技能（data-analyzer 2925 文件 / aliyun-cost / litta-* 等）同样方式播种，另需数据源与凭据。
// 来源: ~/.agents/skills/<name> 与 ~/.pi/agent/git/github.com/DietrichGebert/ponytail/skills/<name>
// 方法: tar 管道经 kubectl exec（worker pod 作 PVC 代理）写入 /home/piuser/.pi/agent/skills/，
//       随后重启 piweb 部署让进程内 pi 启动时重扫 skill 位置。
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const NS = "poweri";
const users = (process.argv[2] ?? "alice,bob").split(",").map((s) => s.trim()).filter(Boolean);
const CUSTOM = (process.argv[3] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SKILLS = CUSTOM.length ? CUSTOM : [
  "code-review", "codebase-design", "diagnosing-bugs", "domain-modeling", "grilling",
  "humanizer-zh", "prototype", "research", "tdd",
  "ponytail", "ponytail-audit", "ponytail-debt", "ponytail-gain", "ponytail-help", "ponytail-review",
];
const SRCS = [
  path.join(os.homedir(), ".agents", "skills"),
  path.join(os.homedir(), ".pi", "agent", "git", "github.com", "DietrichGebert", "ponytail", "skills"),
];

const found = [];
for (const s of SKILLS) {
  const dir = SRCS.find((d) => existsSync(path.join(d, s, "SKILL.md")));
  if (dir) found.push({ name: s, dir });
  else console.warn(`⚠ 跳过 ${s}（宿主无 SKILL.md）`);
}
if (!found.length) { console.error("没有可播种的 skill（检查宿主 ~/.agents/skills）"); process.exit(1); }

const target = (u) => `/home/piuser/.pi/agent/skills`;
// 真正执行：逐 skill tar 管道写入（幂等，覆盖同名）
for (const u of users) {
  const pod = `deploy/worker-${u}`;
  const sh = `mkdir -p ${target(u)} && tar xzf - -C ${target(u)}`;
  for (const { name, dir } of found) {
    const tar = execFileSync("tar", ["czf", "-", "-C", dir, name], { encoding: "buffer" });
    execFileSync("kubectl", ["exec", "-i", pod, "-n", NS, "--", "sh", "-c", sh], { input: tar, stdio: ["pipe", "inherit", "inherit"] });
  }
  console.log(`✓ ${u}: ${found.length} 个 skill → ${target(u)}`);
  const list = execFileSync("kubectl", ["exec", pod, "-n", NS, "--", "sh", "-c", `ls -1 ${target(u)}`], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  console.log(`   ${list.join(", ")}`);
}

// 重启 piweb（进程内 pi 启动时重扫 skill 位置；worker 每连接新起 pi 无需重启）
for (const u of users) {
  execFileSync("kubectl", ["rollout", "restart", `deploy/piweb-${u}`, "-n", NS], { stdio: "ignore" });
}
for (const u of users) {
  execFileSync("kubectl", ["rollout", "status", `deploy/piweb-${u}`, "-n", NS, "--timeout=180s"], { stdio: ["ignore", "inherit", "inherit"] });
  console.log(`✓ piweb-${u} 已重启（skill 重扫）`);
}
