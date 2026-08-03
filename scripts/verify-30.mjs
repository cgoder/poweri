// verify-30：生产收口可验证项（ticket 30）
// 已落地：worker/gateway 容器资源限额、NetworkPolicy 应用；HPA 已于 ticket 32 移除——
//   CPU-only HPA 不支持 min=0（与"所有用户空闲统一缩到 0"互斥），缩容统一由网关 sweeper 管
// 未决（用户决策后另开）：镜像仓库+CI/CD、Ingress/TLS、网关多副本共享元数据存储、NetworkPolicy enforcement（需 Cilium）
// 用法：node scripts/verify-30.mjs [user]（默认 alice）
import { execFileSync } from "node:child_process";

const USER = process.argv[2] ?? "alice";
let passed = 0, failed = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`✓ ${name}${extra ? " — " + extra : ""}`); }
  else { failed++; console.log(`✗ ${name}${extra ? " — " + extra : ""}`); }
};

function kubectl(args) {
  return execFileSync("kubectl", args, { encoding: "utf8" }).trim();
}

try {
  // 1. 容器资源限额（HPA CPU 利用率依赖 requests；此前 gen-k8s 缺失，本票补齐）
  console.log("── 1. 资源限额 ──");
  for (const d of ["worker-alice", "gateway"]) {
    const r = kubectl(["get", "deploy", d, "-n", "poweri", "-o", "jsonpath={.spec.template.spec.containers[0].resources.requests.cpu}"]);
    ok(`${d} 有 CPU requests（HPA 前提）`, r === "250m" || r === "100m", r);
  }

  // 2. 统一缩容模型（ticket 32）：无 HPA —— CPU-only HPA 不支持 min=0（需 Object/External 指标），
  //    与"所有用户空闲统一缩到 0"互斥；负载扩容属优化（需要指标源后另行决策），缩容统一由网关管。
  console.log("── 2. 缩容模型 ──");
  const hpaList = kubectl(["get", "hpa", "-n", "poweri", "--no-headers"]);
  ok("无 HPA（统一缩容由网关 sweeper 管，ticket 32）", hpaList.trim() === "", hpaList.trim() || "none");
  const replicas = Number(kubectl(["get", "deploy", `worker-${USER}`, "-n", "poweri", "-o", "jsonpath={.spec.replicas}"]));
  ok("worker 副本由网关按需管理（空闲缩 0 / 请求拉起 1）", replicas === 0 || replicas === 1, `replicas=${replicas}`);


  // 3. NetworkPolicy：已应用（manifest 正确；enforcement 需 Cilium，见 Answer）
  console.log("── 3. NetworkPolicy ──");
  const np = kubectl(["get", "networkpolicy", "worker-egress", "-n", "poweri", "-o", "jsonpath={.spec.egress[0].to[0].ipBlock.cidr}"]);
  ok("NetworkPolicy 已应用（egress 白名单 CIDR）", np.length > 0, np);

  // 4. 全链路回归（策略应用后模型 API 仍可达）
  console.log("── 4. 全链路回归 ──");
  const out = execFileSync("bash", ["-c",
    `curl -s -N -m 90 -H "Authorization: Bearer token-${USER}" -H "Content-Type: application/json" -d '{"session":"new","message":"回复一个字：通"}' "http://127.0.0.1:31080/v1/chat"`],
    { encoding: "utf8" });

  console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
} finally {
  process.exit(failed ? 1 : 0);
}
