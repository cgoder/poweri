// 构建 Gateway 镜像（独立仓库版）
// 用法：node scripts/build-gateway.mjs <tag>   （tag 默认 poweri-gateway:local）
import { execFileSync } from "node:child_process";
import path from "node:path";
const tag = process.argv[2] ?? "poweri-gateway:local";
const args = ["build", "-f", "Dockerfile.gateway", "-t", tag, "."];
console.error(`[build] ${tag}`);
execFileSync("docker", args, { stdio: "inherit", cwd: path.resolve(import.meta.dirname, "..") });
console.log(`✅ ${tag}`);
