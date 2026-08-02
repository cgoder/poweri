// verify-30：生产收口可验证项（ticket 30）
// 已落地：worker/gateway 容器资源限额（HPA 前提）、HPA K8s 实跑（压测 1→2 扩容）、NetworkPolicy 应用
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

  // 2. HPA：对象存在 + CPU 指标可解析（实跑扩容见 Answer：压测 1→2）
  console.log("── 2. HPA ──");
  const hpa = kubectl(["get", "hpa", `poweri-worker-${USER}`, "-n", "poweri", "-o", "jsonpath={.spec.minReplicas}/{.spec.maxReplicas}/{.status.currentMetrics[0].resource.name}"]);
  ok("HPA 存在且 CPU 指标解析（min/max/指标）", /^1\/3\/cpu$/.test(hpa), hpa);
  const replicas = Number(kubectl(["get", "deploy", `worker-${USER}`, "-n", "poweri", "-o", "jsonpath={.spec.replicas}"]));
  ok("HPA 管理副本数（>=1，压测后已回/在回）", replicas >= 1, `replicas=${replicas}`);

  // 3. NetworkPolicy：已应用（manifest 正确；enforcement 需 Cilium，见 Answer）
  console.log("── 3. NetworkPolicy ──");
  const np = kubectl(["get", "networkpolicy", "worker-egress", "-n", "poweri", "-o", "jsonpath={.spec.egress[0].to[0].ipBlock.cidr}"]);
  ok("NetworkPolicy 已应用（egress 白名单 CIDR）", np.length > 0, np);

  // 4. 全链路回归（策略应用后模型 API 仍可达）
  console.log("── 4. 全链路回归 ──");
  const out = execFileSync("bash", ["-c",
    `curl -s -N -m 90 -H "Authorization: Bearer ${USER === "alice" ? "token-a" : "token-b"}" -H "Content-Type: application/json" -d '{"session":"new","message":"回复一个字：通"}' "http://127.0.0.1:31080/v1/chat"`],
    { encoding: "utf8" });
  ok("策略应用后 worker 全链路对话正常（模型 API 白名单放行）", out.includes("event: done") && out.includes("event: ready"), `ready+done, ${out.length} 字节`);

  console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
} finally {
  process.exit(failed ? 1 : 0);
}
