// 构建 Worker 镜像（ticket 12：不可变 + 锁版本 tag）
// 用法：node scripts/build-image.mjs <tag> [pi版本]
//   tag 默认 local（= pi-sandbox:local，兼容现有验证脚本）；pi版本默认 0.83.0（锁版本）
//   BUILD_MARKER 可选注入镜像内 /etc/poweri-version（升级验证/溯源）
// 例：node scripts/build-image.mjs poweri-worker:0.1.1 0.83.0
import { execFileSync } from "node:child_process";
import path from "node:path";

const tag = process.argv[2] ?? "pi-sandbox:local";
const piVersion = process.argv[3] ?? "0.83.0";
const marker = process.env.POWERI_BUILD_MARKER ?? "";
const args = ["build", "-f", "deploy/docker/Dockerfile.pi", "--build-arg", `PI_VERSION=${piVersion}`];
if (marker) args.push("--build-arg", `BUILD_MARKER=${marker}`);
args.push("-t", tag, ".");
console.error(`[build] ${tag} (pi ${piVersion}${marker ? `, marker=${marker}` : ""})`);
execFileSync("docker", args, { stdio: "inherit", cwd: path.resolve(import.meta.dirname, "..") });
console.log(`✅ ${tag}`);
