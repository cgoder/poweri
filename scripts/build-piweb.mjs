// 构建 pi-web 可视化验证镜像（ticket 15）
// 用法：node scripts/build-piweb.mjs <tag> [piweb版本]
//   tag 默认 poweri-piweb:local；piweb版本默认 0.8.6（锁版本）
// 例：node scripts/build-piweb.mjs poweri-piweb:0.8.6 0.8.6
import { execFileSync } from "node:child_process";
import path from "node:path";

const tag = process.argv[2] ?? "poweri-piweb:local";
const version = process.argv[3] ?? "0.8.6";
const args = ["build", "-f", "deploy/docker/Dockerfile.piweb", "--build-arg", `PIWEB_VERSION=${version}`, "-t", tag, "."];
console.error(`[build] ${tag} (pi-web ${version})`);
execFileSync("docker", args, { stdio: "inherit", cwd: path.resolve(import.meta.dirname, "..") });
console.log(`✅ ${tag}`);
