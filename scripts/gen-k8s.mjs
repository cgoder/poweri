// 生成并应用 K8s 资源（ticket 16 PoC：每用户 PVC + worker Deployment + NodePort Service；ticket 27：--ui 部署 PowerI-Web 网关模式壳）
// 三模块架构（2026-08）：worker 模板本仓库自持（参数化）；gateway/Web 的 manifest 归各自独立仓库（deploy/k8s/），此处聚合引用（注入占位符 + Secret/ConfigMap）
// 用法：node scripts/gen-k8s.mjs [alice,bob,...] [--piweb|--piweb2|--ui]   （默认 alice,bob；worker nodePort 从 30081 起；piweb 30241 起；jmfederico 30251 起；ui 30341）
// 前置：OrbStack K8s 已启用；poweri-worker:local 镜像可拉（OrbStack 共享镜像）；项目 deploy/config/pi 有 gen-pi-config 生成的 models.json/settings.json（或 POWERI_PI_CONFIG_DIR 指定）
// 配置播种：ConfigMap 由 pi 配置生成，initContainer 复制进各用户 PVC（每用户隔离副本，可各自在界面改）
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const users = (process.argv[2] ?? "alice,bob").split(",").map((s) => s.trim()).filter(Boolean);
const PIWEB = process.argv.includes("--piweb"); // ticket 21：追加每用户 pi-web 可视化实例（ticket 27 起废弃：上游进程内形态与产品路径不符，保留可回滚）
const PIWEB2 = process.argv.includes("--piweb2"); // ticket 22 试点：追加每用户 jmfederico/pi-web（sessiond 分裂形态）实例（ticket 27 起废弃）
const UI = process.argv.includes("--ui"); // ticket 27：部署 PowerI-Web（网关模式壳，单一 UI 指向网关，数据全在 worker 侧）
if (PIWEB) console.warn("⚠ --piweb 已废弃（ticket 27）：上游 @agegr/pi-web 进程内形态旁路网关，产品路径为 PowerI-Web 网关壳；仅保留可回滚");
if (PIWEB2) console.warn("⚠ --piweb2 已废弃（ticket 27）：jmfederico 试点（ticket 22）已收口；仅保留可回滚");
const NODE_PORT_BASE = 30081;
const NS = "poweri";
const IMAGE = process.env.POWERI_POD_IMAGE ?? "poweri-worker:local";
const MODEL = process.env.POWERI_AI_MODEL ?? "agent";
const GW_USERS = process.env.POWERI_GATEWAY_USERS ?? "alice:token-a;bob:token-b";
const CONFIG_SRC = process.env.POWERI_PI_CONFIG_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "deploy", "config", "pi");
// 三模块独立仓库路径（gateway/Web 的 K8s manifest 归各自仓库自描述，控制面聚合引用）
const GW_DIR = process.env.POWERI_GATEWAY_DIR || "/Users/tianzhao/code/leoao/poweri-gateway";
const WEB_DIR = process.env.POWERI_WEB_DIR || "/Users/tianzhao/code/leoao/poweri-web";
// 读模板 manifest 并替换占位符 ${KEY}（值来自本脚本运行时计算）
const applyManifest = (file, vars) => {
  const raw = readFileSync(file, "utf8");
  const yaml = raw.replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => vars[k] ?? "");
  execFileSync("kubectl", ["apply", "-f", "-"], { input: yaml, stdio: ["pipe", "ignore", "inherit"] });
};

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
const secretLiterals = [`POWERI_AI_API_KEY=${gwApiKey}`, `POWERI_GATEWAY_USERS=${GW_USERS}`];
// ticket 21：pi-web 每实例 Basic Auth 密码（Secret 化，不进 ConfigMap；默认 poweri-<user>，可 POWERI_PIWEB_PASSWORD_<USER> 覆盖）
if (PIWEB) for (const u of users) secretLiterals.push(`PI_WEB_PASSWORD_${u.toUpperCase()}=${process.env[`POWERI_PIWEB_PASSWORD_${u.toUpperCase()}`] ?? `poweri-${u}`}`);
// ticket 27/28：PowerI-Web UI 凭据 — 无条件创建（防未带 --ui 的 gen-k8s 重建 Secret 丢键，pod 进 CreateContainerConfigError）
// POWERI_WEB_PASSWORD=单用户回退密码；POWERI_UI_TOKEN=该用户网关 token（POWERI_UI_USER 可选，默认首个）
const uiUser = process.env.POWERI_UI_USER ?? users[0];
const uiToken = GW_USERS.split(";").map((p) => p.split(":")).find(([u]) => u === uiUser)?.[1] ?? "";
secretLiterals.push(`POWERI_WEB_PASSWORD=${process.env.POWERI_WEB_PASSWORD ?? `poweri-${uiUser}`}`);
secretLiterals.push(`POWERI_UI_TOKEN=${uiToken}`);
execFileSync("kubectl", ["create", "secret", "generic", "poweri-secrets", ...secretLiterals.map((l) => `--from-literal=${l}`), "-n", NS], { stdio: "ignore" });
console.log(`✓ Secret poweri-secrets（模型 apiKey + 网关用户 token${PIWEB ? " + pi-web 密码" : ""}${UI ? " + PowerI-Web 密码/token" : ""}）`);

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
          # ticket 07 规格（此前 gen-k8s 未应用，HPA CPU 利用率依赖 requests 字段）
          resources:
            requests: { cpu: 250m, memory: 256Mi }
            limits: { cpu: "1", memory: 512Mi }
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
  selector: { app: poweri, role: worker, user: ${u} }
  ports:
    - { port: 8081, targetPort: 8081, nodePort: ${port} }`);
}
execFileSync("kubectl", ["apply", "-f", "-"], { input: out.join("\n"), stdio: ["pipe", "ignore", "inherit"] });
console.log(`✓ 资源已应用：${users.map((u) => `worker-${u} (nodePort ${NODE_PORT_BASE + users.indexOf(u)})`).join(", ")}`);

// ── 3. gateway：manifest 归独立仓库（poweri-gateway/deploy/k8s/gateway.yaml），此处聚合引用 ──
// 数据挂独立 PVC（meta/计量不丢）；多副本水平扩展需共享元数据存储（生产：数据库，store.mjs 注释）
const k8sUsers = users.map((u) => `${u}:worker-${u}.${NS}.svc.cluster.local:8081`).join(";");
applyManifest(path.join(GW_DIR, "deploy", "k8s", "gateway.yaml"), { K8S_USERS: k8sUsers });
console.log(`✓ gateway 已部署（NodePort 31080，manifest 来自 poweri-gateway 仓库 ${path.join(GW_DIR, "deploy", "k8s", "gateway.yaml")}）`);

// ── 2c. PowerI-Web UI（ticket 27：单一网关模式壳，指向网关 Service；无 PVC——数据全在 worker 侧）──
// manifest 归独立仓库（poweri-web/deploy/k8s/poweri-web.yaml），此处聚合引用
if (UI) {
  // ticket 28：每用户账号表（POWERI_WEB_USERS，默认 poweri-<user>）+ 网关用户表（token 解析）
  const webUsers = process.env.POWERI_WEB_USERS ?? users.map((u) => `${u}:poweri-${u}`).join(";");
  applyManifest(path.join(WEB_DIR, "deploy", "k8s", "poweri-web.yaml"), { WEB_USERS: webUsers, GW_USERS });
  console.log(`✓ PowerI-Web UI 已部署（NodePort 30341，账号 ${webUsers}，manifest 来自 poweri-web 仓库）`);
}

// ── 2b. pi-web 可视化实例（ticket 21：每用户 Pod 挂该用户 PVC，与 worker 同一数据布局）──
// 探针：全站 Basic Auth（无认证连接被重置）→ exec probe 用 Secret 注入的 $PI_WEB_PASSWORD 认证，<500 即就绪
// 资源：进程内驱动 pi，比桥（512MB）宽裕 → cpu 1 / mem 1Gi；非 root（镜像 USER piuser=1000）
if (PIWEB) {
  const probe = { exec: { command: ["node", "-e", "fetch('http://127.0.0.1:30141/',{headers:{Authorization:'Basic '+Buffer.from('pi:'+process.env.PI_WEB_PASSWORD).toString('base64')}}).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"] }, initialDelaySeconds: 15, periodSeconds: 10, timeoutSeconds: 5 };
  out.length = 0;
  for (const u of users) {
    const idx = users.indexOf(u);
    out.push(`---
apiVersion: apps/v1
kind: Deployment
metadata: { name: piweb-${u}, namespace: ${NS} }
spec:
  replicas: 1
  selector: { matchLabels: { app: poweri, role: piweb, user: ${u} } }
  template:
    metadata: { labels: { app: poweri, role: piweb, user: ${u} } }
    spec:
      containers:
        - name: piweb
          image: poweri-piweb:local
          imagePullPolicy: IfNotPresent
          ports: [{ containerPort: 30141 }]
          env:
            - name: PI_WEB_PASSWORD
              valueFrom: { secretKeyRef: { name: poweri-secrets, key: PI_WEB_PASSWORD_${u.toUpperCase()} } }
          readinessProbe: ${JSON.stringify(probe)}
          livenessProbe: ${JSON.stringify(probe)}
          resources:
            requests: { cpu: 250m, memory: 512Mi }
            limits: { cpu: "1", memory: 1Gi }
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
---
apiVersion: v1
kind: Service
metadata: { name: piweb-${u}, namespace: ${NS} }
spec:
  type: NodePort
  selector: { app: poweri, role: piweb, user: ${u} }
  ports:
    - { port: 30141, targetPort: 30141, nodePort: ${30241 + idx} }`);
  }
  execFileSync("kubectl", ["apply", "-f", "-"], { input: out.join("\n"), stdio: ["pipe", "ignore", "inherit"] });
  console.log(`✓ pi-web 已部署：${users.map((u, i) => `piweb-${u} (nodePort ${30241 + i})`).join(", ")}`);
}

// ── 3.5 每用户 jmfederico/pi-web 实例（ticket 22 A′ 试点：sessiond + web 分裂，无内置密码认证，信任模型=受信网络）
if (PIWEB2) {
  const probe = { httpGet: { path: "/", port: 8504 }, initialDelaySeconds: 15, periodSeconds: 10, timeoutSeconds: 5 };
  out.length = 0;
  for (const u of users) {
    const idx = users.indexOf(u);
    out.push(`---
apiVersion: apps/v1
kind: Deployment
metadata: { name: piweb2-${u}, namespace: ${NS} }
spec:
  replicas: 1
  selector: { matchLabels: { app: poweri, role: piweb2, user: ${u} } }
  template:
    metadata: { labels: { app: poweri, role: piweb2, user: ${u} } }
    spec:
      containers:
        - name: piweb2
          image: poweri-piweb2:local
          imagePullPolicy: IfNotPresent
          ports: [{ containerPort: 8504 }]
          env:
            - { name: PI_WEB_HOST, value: 0.0.0.0 }
            - { name: PI_WEB_PORT, value: "8504" }
            - { name: PI_WEB_DATA_DIR, value: /data/pi-web }
            - { name: PI_WEB_SESSIOND_SOCKET, value: /data/pi-web/sessiond.sock }
            - { name: PI_CODING_AGENT_DIR, value: /data/pi-agent }
          readinessProbe: ${JSON.stringify(probe)}
          livenessProbe: ${JSON.stringify(probe)}
          resources:
            requests: { cpu: 250m, memory: 512Mi }
            limits: { cpu: "1", memory: 1Gi }
          securityContext:
            runAsNonRoot: true
            runAsUser: 1000
            allowPrivilegeEscalation: false
          volumeMounts:
            - { name: pi, mountPath: /data/pi-agent, subPath: pi-agent }
            - { name: pi, mountPath: /data/workspace, subPath: workspace }
      volumes:
        - name: pi
          persistentVolumeClaim: { claimName: ${u}-pvc }
---
apiVersion: v1
kind: Service
metadata: { name: piweb2-${u}, namespace: ${NS} }
spec:
  type: NodePort
  selector: { app: poweri, role: piweb2, user: ${u} }
  ports:
    - { port: 8504, targetPort: 8504, nodePort: ${30251 + idx} }`);
  }
  execFileSync("kubectl", ["apply", "-f", "-"], { input: out.join("\n"), stdio: ["pipe", "ignore", "inherit"] });
  console.log(`✓ piweb2 已部署：${users.map((u, i) => `piweb2-${u} (nodePort ${30251 + i})`).join(", ")}`);
}

// ── 4. 等待 Ready ──────────────────────────────────────────────────────
for (const u of users) {
  run(["rollout", "status", `deploy/worker-${u}`, "-n", NS, "--timeout=120s"]);
  console.log(`✓ worker-${u} Ready`);
}
run(["rollout", "status", "deploy/gateway", "-n", NS, "--timeout=120s"]);
console.log(`✓ gateway Ready\n访问: http://127.0.0.1:31080/v1/chat（NodePort 31080）\nK8s 内: http://gateway.poweri.svc.cluster.local:8080`);
if (PIWEB) {
  for (const u of users) {
    run(["rollout", "status", `deploy/piweb-${u}`, "-n", NS, "--timeout=180s"]);
    console.log(`✓ piweb-${u} Ready`);
  }
  console.log(`pi-web 访问: 用户 pi，密码见 Secret（默认 poweri-<user>）\n  http://127.0.0.1:${30241}（alice）  http://127.0.0.1:${30241 + users.indexOf(users[1] ?? users[0])}（后续用户依序 +1）`);
}
if (PIWEB2) {
  for (const u of users) {
    run(["rollout", "status", `deploy/piweb2-${u}`, "-n", NS, "--timeout=180s"]);
    console.log(`✓ piweb2-${u} Ready`);
  }
  console.log(`piweb2 访问（jmfederico/pi-web，受信网络模型无内置密码）:\n  http://127.0.0.1:${30251}（alice）  http://127.0.0.1:${30251 + users.indexOf(users[1] ?? users[0])}（后续用户依序 +1）`);
}
