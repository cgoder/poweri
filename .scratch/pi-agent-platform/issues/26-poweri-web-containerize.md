# 26 — PowerI-Web 容器化（独立容器的最后一块拼图）

- **Type:** task
- **Status:** resolved
- **Blocked by:**
- **Depends on:**
- **工作目录：** `/Users/tianzhao/code/leoao/poweri-web`（独立仓库，已移出本仓库，改动需切换目录）

## 背景

架构回溯（spec 用户故事 39-45 + 待办差距清单第 1 项）：产品唯一入口 = PowerI-Web（网关模式壳 Web UI → 网关 → Worker），但目前它是独立仓库却**没有容器形态**——只能宿主 `next start`。要成为"独立容器"，需要 Dockerfile + 镜像构建。

## 定义 / 范围

1. **Dockerfile**（仿 `deploy/docker/Dockerfile.piweb` 的教训，只装生产依赖，控制体积）：
   - `node:24-bookworm-slim` 底座（与 worker/piweb 镜像一致）
   - `npm ci --omit=dev` 装生产依赖（含 `@earendil-works/pi-coding-agent` 0.83.0 peer）
   - `next build` 产物进镜像，运行 `next start`
   - 非 root 用户、锁版本、`PI_OFFLINE=1`
2. **镜像构建脚本**：仿 `scripts/build-piweb.mjs`（`deploy/docker/Dockerfile.piweb` 是给上游 npm 包的，PowerI-Web 是自己的仓库，在 poweri-web 仓库内建 `build-image.mjs` 或复用本仓库脚本模式），产出 `poweri-web:local`
3. **容器内验证**：`docker run` 容器内 curl 确认：Basic Auth 200、`/api/models-config` 返回单 poweri-gw/agent、网关模式连通（POWERI_GATEWAY_URL 指向本机 31080 时容器内可达）

## 验证

- `docker build` 成功，镜像体积记录（对照上游 piweb 1.11GB 应显著更小）
- `docker run` + 容器内 curl：auth 200 / models-config 单模型 / 会话列表非空
- 镜像内 `node --version` == 24、pi 0.83.0

## 测试决策（遵循仓库既有约定）

纯逻辑单测走 `node --test "lib/*.test.mjs"`（poweri-web 已有 203 个）；容器形态走 verify 脚本（本票 `verify-26.mjs`）。

## Answer

PowerI-Web 已容器化并验证 8/8（verify-26.mjs）：
- **Dockerfile**（poweri-web 仓库根，两阶段）：builder 全量 npm ci（npmmirror 加重试）+ next build + **builder 内** prune 掉 dev 依赖与冗余；runner 仅生产依赖 + 构建产物，非 root piuser、PI_OFFLINE=1、监听 0.0.0.0:30141
- **镜像体积 785MB**（上游 piweb 1.11GB 的 70%）：关键教训——docker 镜像大小 = 各 COPY 层之和，后层 `rm -rf` 不回收下层空间（overlayfs），瘦身必须发生在 COPY 之前（builder 内）。三大块：`.next/cache` 451MB 构建缓存、`@next/swc-linux-arm64-musl` 120MB（glibc 底座只需 gnu）、dev 依赖
- **验证**（verify-26.mjs 8/8）：镜像就绪、Node 24 / pi 0.83.0、无凭据 401、Basic Auth 200、模型面板单 poweri-gw/agent、容器内经 `host.docker.internal:31080` → 网关 → worker 读到 57 个真实会话
- 运行时环境变量：POWERI_GATEWAY_URL/TOKEN/CWD + POWERI_WEB_PASSWORD（README 快速启动一节）
- 构建：`node scripts/build-image.mjs`（poweri-web 仓库内）→ `poweri-web:local`
