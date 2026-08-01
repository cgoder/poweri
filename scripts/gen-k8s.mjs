// 生成并应用 K8s 资源（ticket 16 PoC：每用户 PVC + worker Deployment + NodePort Service）
// 用法：node scripts/gen-k8s.mjs [alice,bob,...]   （默认 alice,bob；nodePort 从 30081 起）
// 前置：OrbStack K8s 已启用；poweri-worker:local 镜像可拉（OrbStack 共享镜像）；宿主 ~/.pi/agent 有 gen-pi-config 生成的 models.json/settings.json
// 配置播种：ConfigMap 由宿主配置生成，initContainer 复制进各用户 PVC（每用户隔离副本，可各自在界面改）
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const users = (process.argv[2] ?? "alice,bob").split(",").map((s) => s.trim()).filter(Boolean);
const NODE_PORT_BASE = 30081;
const NS = "poweri";
const IMAGE = process.env.POWERI_POD_IMAGE ?? "poweri-worker:local";
const MODEL = process.env.POWERI_AI_MODEL ?? "agent";
const CONFIG_SRC = path.join(homedir(), ".pi", "agent");

const run = (args) => execFileSync("kubectl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

// ── 1. ConfigMap：播种配置（models.json / settings.json）────────────────
const cmFiles = ["models.json", "settings.json"].filter((f) => existsSync(path.join(CONFIG_SRC, f)));
if (!cmFiles.includes("models.json")) {
  console.error("缺少宿主模型配置：请先 bun run gen:pi-config");
  process.exit(1);
}
run(["create", "namespace", NS, "--dry-run=client", "-o", "yaml"]); // 确保 ns 存在检查
execFileSync("kubectl", ["apply", "-f", "-"], { input: `apiVersion: v1\nkind: Namespace\nmetadata: { name: ${NS} }\n`, stdio: ["pipe", "ignore", "inherit"] });
run(["delete", "configmap", "pi-config", "-n", NS, "--ignore-not-found=true"]);
execFileSync("kubectl", ["create", "configmap", "pi-config", ...cmFiles.map((f) => `--from-file=${f}=${path.join(CONFIG_SRC, f)}`), "-n", NS], { stdio: "ignore" });
console.log(`✓ ConfigMap pi-config（${cmFiles.join(", ")}）`);

// ── 2. 每用户：PVC + Deployment + NodePort Service ─────────────────────
const out = [];
for (const u of users) {
  const port = NODE_PORT_BASE + users.indexOf(u);
  out.push(`---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: ${u}-pvc, namespace: ${NS} }
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 1Gi } }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: worker-${u}, namespace: ${NS} }
spec:
  replicas: 1
  selector: { matchLabels: { app: poweri, user: ${u} } }
  template:
    metadata: { labels: { app: poweri, role: worker, user: ${u} } }
    spec:
      initContainers:
        - name: seed
          image: busybox
          command: ["sh", "-c", "mkdir -p /agent/sessions && cp /config/models.json /config/settings.json /agent/ || true; chown -R 1000:1000 /agent /workspace || true"]
          volumeMounts:
            - { name: pi, mountPath: /agent, subPath: pi-agent }
            - { name: pi, mountPath: /workspace, subPath: workspace }
            - { name: config, mountPath: /config }
      containers:
        - name: bridge
          image: ${IMAGE}
          imagePullPolicy: IfNotPresent
          command: ["node", "/bridge/server.mjs"]
          env:
            - { name: POWERI_AI_MODEL, value: "${MODEL}" }
          ports: [{ containerPort: 8081 }]
          securityContext:
            runAsNonRoot: true
            runAsUser: 1000
            allowPrivilegeEscalation: false
          volumeMounts:
            - { name: pi, mountPath: /home/piuser/.pi/agent, subPath: pi-agent }
            - { name: pi, mountPath: /workspace, subPath: workspace }
      volumes:
        - name: pi
          persistentVolumeClaim: { claimName: ${u}-pvc }
        - name: config
          configMap: { name: pi-config }
---
apiVersion: v1
kind: Service
metadata: { name: worker-${u}, namespace: ${NS} }
spec:
  type: NodePort
  selector: { app: poweri, user: ${u} }
  ports:
    - { port: 8081, targetPort: 8081, nodePort: ${port} }`);
}
execFileSync("kubectl", ["apply", "-f", "-"], { input: out.join("\n"), stdio: ["pipe", "ignore", "inherit"] });
console.log(`✓ 资源已应用：${users.map((u) => `worker-${u} (nodePort ${NODE_PORT_BASE + users.indexOf(u)})`).join(", ")}`);

// ── 3. 等待 Ready ──────────────────────────────────────────────────────
for (const u of users) {
  run(["rollout", "status", `deploy/worker-${u}`, "-n", NS, "--timeout=120s"]);
  console.log(`✓ worker-${u} Ready`);
}
console.log(`\n网关接入：POWERI_POD_PROVIDER=k8s POWERI_K8S_USERS="${users.map((u, i) => `${u}:${NODE_PORT_BASE + i}`).join(";")}"`);
