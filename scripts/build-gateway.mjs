// 构建 Gateway 镜像（ticket 19：无状态网关层部署形态）
// 用法：node scripts/build-gateway.mjs <tag>
//   tag 默认 poweri-gateway:local
import { execFileSync } from "node:child_process";
import path from "node:path";

const tag = process.argv[2] ?? "poweri-gateway:local";
console.error(`[build] ${tag}`);
execFileSync("docker", ["build", "-f", "deploy/docker/Dockerfile.gateway", "-t", tag, "."], {
  stdio: "inherit",
  cwd: path.resolve(import.meta.dirname, ".."),
});
console.log(`✅ ${tag}`);
