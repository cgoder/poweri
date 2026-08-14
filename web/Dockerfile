# PowerI-Web 镜像：网关模式 UI 壳（上游 v0.8.8 基底 + 适配层定制，构建上下文=web/）
# 多阶段：builder 依赖安装 + next build；runtime 只拷产物（.next / public / node_modules / 配置）
# 构建：docker build -f Dockerfile -t poweri-web:local .
# 运行：npx next start -H 0.0.0.0 -p 30141（网关模式由 env 配置：POWERI_GATEWAY_URL 存在即启用，无配置时与上游行为一致）
# 与云端 trial1 镜像对齐：piuser 非 root、PI_OFFLINE=1（禁 pi 自更新外呼）、PI_WEB_HOSTNAME/NO_OPEN

FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
RUN useradd --create-home --shell /bin/bash piuser
ENV NODE_ENV=production
ENV PI_OFFLINE=1
ENV PI_WEB_HOSTNAME=0.0.0.0
ENV PI_WEB_NO_OPEN=1
COPY --chown=piuser:piuser --from=builder /app/package.json ./
COPY --chown=piuser:piuser --from=builder /app/node_modules ./node_modules
COPY --chown=piuser:piuser --from=builder /app/.next ./.next
COPY --chown=piuser:piuser --from=builder /app/public ./public
COPY --chown=piuser:piuser --from=builder /app/next.config.ts ./
COPY --chown=piuser:piuser --from=builder /app/next-env.d.ts ./
USER piuser
ENV HOME=/home/piuser
EXPOSE 30141
ENTRYPOINT ["npx", "next", "start", "-H", "0.0.0.0", "-p", "30141"]
