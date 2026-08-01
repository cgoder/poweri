// 生成并应用 K8s 资源（ticket 16 PoC：每用户 PVC + worker Deployment + NodePort Service）
// 用法：node scripts/gen-k8s.mjs [alice,bob,...]   （默认 alice,bob；nodePort 从 30081 起）
// 前置：OrbStack K8s 已启用；poweri-worker:local 镜像可拉（OrbStack 共享镜像）；项目 deploy/config/pi 有 gen-pi-config 生成的 models.json/settings.json（或 POWERI_PI_CONFIG_DIR 指定）
// 配置播种：ConfigMap 由 pi 配置生成，initContainer 复制进各用户 PVC（每用户隔离副本，可各自在界面改）
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const users = (process.argv[2] ?? "alice,bob").split(",").map((s) => s.trim()).filter(Boolean);
const NODE_PORT_BASE = 30081;
const NS = "poweri";
const IMAGE = process.env.POWERI_POD_IMAGE ?? "poweri-worker:local";
const MODEL = process.env.POWERI_AI_MODEL ?? "agent";
const GW_USERS = process.env.POWERI_GATEWAY_USERS ?? "alice:token-a;bob:token-b";
const CONFIG_SRC = process.env.POWERI_PI_CONFIG_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "deploy", "config", "pi");

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

// ── 1b. Secret：模型 apiKey + 网关用户 token（ticket 19：密钥不进 ConfigMap）────────
// apiKey 值优先取进程 env（.env），否则从 models.json 字面量提取（$ENV 引用时必须有 env）
let gwApiKey = process.env.POWERI_AI_API_KEY ?? "";
if (!gwApiKey) {
  try {
    const m = JSON.parse(readFileSync(path.join(CONFIG_SRC, "models.json"), "utf8"));
    gwApiKey = m.providers?.["poweri-gw"]?.apiKey ?? "";
    if (gwApiKey.startsWith("$")) gwApiKey = ""; // $ENV 引用不是值
  } catch {}
}
if (!gwApiKey) { console.error("缺少模型 apiKey：POWERI_AI_API_KEY 未设置且 models.json 无字面量密钥"); process.exit(1); }
run(["delete", "secret", "poweri-secrets", "-n", NS, "--ignore-not-found=true"]);
execFileSync("kubectl", ["create", "secret", "generic", "poweri-secrets", "--from-literal", `POWERI_AI_API_KEY=${gwApiKey}`, "--from-literal", `POWERI_GATEWAY_USERS=${GW_USERS}`, "-n", NS], { stdio: "ignore" });
console.log(`✓ Secret poweri-secrets（模型 apiKey + 网关用户 token）`);

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
            - name: POWERI_AI_API_KEY
              valueFrom: { secretKeyRef: { name: poweri-secrets, key: POWERI_AI_API_KEY } }
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

// ── 3. gateway：Deployment + PVC + NodePort Service（ticket 19 部署形态）──
// 数据挂独立 PVC（meta/计量不丢）；多副本水平扩展需共享元数据存储（生产：数据库，store.mjs 注释）
const k8sUsers = users.map((u) => `${u}:worker-${u}.${NS}.svc.cluster.local:8081`).join(";");
out.length = 0;
out.push(`---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: gateway-pvc, namespace: ${NS} }
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 1Gi } }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: gateway, namespace: ${NS} }
spec:
  replicas: 1
  selector: { matchLabels: { app: poweri, role: gateway } }
  template:
    metadata: { labels: { app: poweri, role: gateway } }
    spec:
      containers:
        - name: gateway
          image: poweri-gateway:local
          imagePullPolicy: IfNotPresent
          ports: [{ containerPort: 8080 }]
          env:
            - { name: POWERI_GATEWAY_PORT, value: "8080" }
            - { name: POWERI_POD_PROVIDER, value: "k8s" }
            - { name: POWERI_K8S_USERS, value: "${k8sUsers}" }
            - name: POWERI_GATEWAY_USERS
              valueFrom: { secretKeyRef: { name: poweri-secrets, key: POWERI_GATEWAY_USERS } }
            - { name: POWERI_DATA_DIR, value: "/app/gateway/data" }
          volumeMounts: [{ name: data, mountPath: /app/gateway/data }]
          securityContext:
            runAsNonRoot: true
            runAsUser: 1000
            allowPrivilegeEscalation: false
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: gateway-pvc }
---
apiVersion: v1
kind: Service
metadata: { name: gateway, namespace: ${NS} }
spec:
  type: NodePort
  selector: { app: poweri, role: gateway }
  ports:
    - { port: 8080, targetPort: 8080, nodePort: 31080 }`);
execFileSync("kubectl", ["apply", "-f", "-"], { input: out.join("\n"), stdio: ["pipe", "ignore", "inherit"] });
console.log(`✓ gateway 已部署（NodePort 31080）`);

// ── 4. 等待 Ready ──────────────────────────────────────────────────────
for (const u of users) {
  run(["rollout", "status", `deploy/worker-${u}`, "-n", NS, "--timeout=120s"]);
  console.log(`✓ worker-${u} Ready`);
}
run(["rollout", "status", "deploy/gateway", "-n", NS, "--timeout=120s"]);
console.log(`✓ gateway Ready\n访问: http://127.0.0.1:31080/v1/chat（NodePort 31080）\nK8s 内: http://gateway.poweri.svc.cluster.local:8080`);
