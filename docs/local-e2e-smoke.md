# Local 全链路冒烟（主缝，ticket 07）

迁移成功的权威标准：monorepo 内本地启动 **web（网关模式）→ gateway（docker provider）→ worker 容器（bridge → pi）→ 真实模型** 全链路。

## 自动化冒烟（回归基准）

```bash
# 前置（一次性）：worker 镜像 + 平台模型配置（.env 需有 POWERI_AI_*）
node scripts/build-image.mjs          # poweri-worker:local
npm run gen:pi-config                 # 生成 deploy/config/pi/models.json

# 运行冒烟（约 60-90s，真实模型生成）
node scripts/verify-33-local-e2e.mjs
```

脚本自启动 gateway（端口 18080，`POWERI_SMOKE_GW_PORT` 可覆盖）与 web dev（30143，`POWERI_SMOKE_WEB_PORT` 可覆盖），结束后自动清理进程与容器。断言 11 项：

1. 无认证 / 错误密码 → 401（web proxy 网关模式守卫）
2. 新建会话（ensure_session → tempKey）
3. 事件流：session_created（真实 msb id）+ message_update 流式 + tool_execution_start/end（工具调用可见）+ agent_settled/prompt_done 收敛
4. 流式文本来自真实模型（非空）
5. 会话续接：GET /api/sessions/<msb> 历史完整（user 原文 + assistant 回复）
6. 多用户隔离：bob 会话列表空 + 读 alice 会话 404

**每次迁移/升级后运行**（ticket 09 升级演练的回归基准）。要求 AI 网关（llms.litta.cn）可达、`deploy/config/pi/models.json` 含有效 key。

## 浏览器人工确认（可选，自动化已覆盖等价断言）

```bash
# 手工启动链路后浏览器访问（或直接复用 verify-33 的进程组合）
cd gateway && POWERI_POD_PROVIDER=docker POWERI_GATEWAY_USERS="alice:token-a;bob:token-b" node server.mjs
cd web && NODE_ENV=development \
  POWERI_GATEWAY_URL=http://127.0.0.1:8080 POWERI_GATEWAY_TOKEN=token-a \
  POWERI_WEB_USERS="alice:pass-a;bob:pass-b" POWERI_GATEWAY_USERS="alice:token-a;bob:token-b" \
  node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p 30143
```

浏览器打开 `http://127.0.0.1:30143`，Basic 弹窗输入 `alice / pass-a`：

> 注意：verify-33 脚本退出即清理进程，人工确认需**手动启动链路**（上方命令），完成后 Ctrl-C 停止。

- [ ] 会话侧栏可见（新建会话后出现）
- [ ] 发消息收到流式回复（打字机效果）
- [ ] 工具调用过程可见（bash 等工具卡片/状态）
- [ ] 刷新页面后历史完整（会话续接）
- [ ] 匿名/错误密码被 401 拦截；`bob / pass-b` 登录看不到 alice 会话

## 环境注意

- web/ 若被外部 next dev 占用（Next 16 单实例保护，报 "Another next dev server is already running"），先停掉外部进程（本机曾出现外部 pi-web daemon 反复占用 30141/30142）。
- worker 容器以宿主 uid:gid 运行（`-u $(id -u):$(id -g)`，piuser 1001 对宿主挂载目录无写权限，实测 EACCES）。
- 会话文件由容器内 pi 写入挂载目录（`gateway/data/users/<user>/.pi/agent/sessions/`），网关经 localSessions 读取——续接依赖此落盘。
