// 安装 metrics-server（OrbStack k3s 本地环境必需，HPA CPU 指标依赖 metrics API）
// 背景：OrbStack k3s 默认无 metrics-server；registry.k8s.io 直连慢/被墙 → 换阿里云镜像；
// k3s 证书 SAN 不含节点 IP → 需 --kubelet-insecure-tls（见 deploy/k8s/OPERATIONS.md §6.5）。
// 幂等：已装则 apply 更新 + 校验通过；用法：node scripts/install-metrics-server.mjs
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const VERSION = "v0.9.0";
const IMAGE = `registry.aliyuncs.com/google_containers/metrics-server:${VERSION}`;
const url = `https://github.com/kubernetes-sigs/metrics-server/releases/download/${VERSION}/components.yaml`;
const file = path.join(tmpdir(), "poweri-metrics-server.yaml");

console.log(`[metrics-server] 下载 ${url}`);
const res = await fetch(url);
if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}（需外网访问 GitHub）`);
let yaml = await res.text();
if (!yaml.includes("registry.k8s.io/metrics-server")) throw new Error("manifest 内容异常，版本可能变更，勿盲打补丁");
yaml = yaml.replaceAll("registry.k8s.io/metrics-server/metrics-server:" + VERSION, IMAGE);
yaml = yaml.replace("        - --secure-port=10250", "        - --secure-port=10250\n        - --kubelet-insecure-tls");
writeFileSync(file, yaml);

execFileSync("kubectl", ["apply", "-f", file], { stdio: "inherit" });
execFileSync("kubectl", ["rollout", "status", "deploy/metrics-server", "-n", "kube-system", "--timeout=120s"], { stdio: "inherit" });
for (let i = 0; i < 3; i++) {
  try { execFileSync("kubectl", ["top", "nodes"], { stdio: "inherit" }); break; }
  catch { console.warn(`metrics 采集未就绪，${10 * (i + 1)}s 后重试…`); await new Promise((r) => setTimeout(r, 10_000)); }
}
console.log("✅ metrics-server 就绪（HPA CPU 指标可用）");
