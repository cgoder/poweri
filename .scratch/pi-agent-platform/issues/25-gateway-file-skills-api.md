# 25 — 网关文件/技能 API + pi-web (agegr) 壳文件浏览器/技能菜单接通

Type: task
Status: resolved
Blocked by: 24
Created: 2026-08-02
Tags: gateway, bridge, k8s, pi-web-agegr, files, skills

> 命名规范（CONTEXT.md 词汇表）：**pi-web (agegr)** = npm `@agegr/pi-web` v0.8.6 壳（ticket 24 网关模式 fork）。

## 背景

用户实测 ticket 24 壳后反馈两个问题：
1. 文件浏览器显示 not found，什么文件都没有
2. 技能菜单直接显示「访问拒绝 access denied」

根因：fork 的 `/api/files/*`、`/api/file-index`、`/api/skills` 全部走 macOS 宿主文件系统并做 allowed-roots 校验，而工作区（`/workspace`）与技能（`/home/piuser/.pi/agent/skills`）实际都在 worker PVC 上。headless Chrome 复现确认：`/api/skills?cwd=/workspace` → 403（宿主 `/workspace` 不存在），`/api/file-index` → 404。

## 补充：第二轮实测四问题（插件/标题/导出/系统提示词/模型清单）

1. **插件菜单 access denied**：worker 无插件包体系（技能走 seed-skills、扩展走 `-e`），GET 返回空 PluginsResponse、POST 明确拒绝。
2. **生成标题失败**：auto-name 调 `generateSessionTitle(session.inner)` 需真实 Agent；网关分支改为首条用户消息本地派生标题（40 字截断，不走模型）。
3. **完整历史导出报错**：导出走宿主 `cli --export <synthetic /gateway/<id>.jsonl>`；网关新增 `GET /v1/sessions/<id>/jsonl`（bridge 原始 JSONL 透传），fork 导出路由拉原始行落临时文件再导出（276KB HTML 验证通过）。
4. **系统提示词不显示**：worker 运行时合成、网关无读取 API；getState 返回如实说明文案（发消息后 state 路由返回，与 fork「发送消息以加载系统提示词」设计一致）。债务：需要真实提示词时在 worker 侧暴露（扩展落盘 + bridge 端点）。
5. **模型清单不一致**：面板走宿主 `/api/models-config`（列出 macOS 本机多模型）而聊天框只显示 poweri-gw/agent；网关分支返回单 provider 单模型（与 worker 真实状态一致），PUT 只读拒绝。

## 补充：插件菜单（用户实测第二轮反馈）

同样的 access denied 类问题：`/api/plugins` GET 走宿主 cwd 校验。网关分支直接返回 worker 的真实插件状态——**worker 无插件包体系**（技能走 seed-skills 播种、扩展走 `-e` 参数），即空列表 `{packages:[], totals:全 0, diagnostics:[], projectResourcesLoaded:true}`；POST（install/remove/update/disable/enable）明确返回「网关模式不支持插件管理」。侧栏四面板（模型/技能/插件/文件）至此全部网关接通。

## 实现（Web UI → 网关 → Worker 产品链路，只读）

| 层 | 变更 |
|---|---|
| bridge | `GET /files?path=&recursive=`（目录列表/递归走查，限 workspace 根，跳过 node_modules/.git 等）、`GET /file?path=`（读文件 utf8，限 workspace 根防穿越）、`GET /skills`（扫 agent 技能目录，解析 SKILL.md frontmatter） |
| gateway | `GET /v1/files`、`GET /v1/file`、`GET /v1/skills`（Bearer token → userId → fetchWorker* 代理；本地模式 localFiles/localFile/localSkills 开发回退） |
| fork | `/api/files/[...path]` GET 网关分支（read/list/meta）、`/api/skills` GET 网关分支（映射 SkillsResponse）、`/api/file-index` GET 网关分支（recursive 走查 + q 过滤） |

客户端函数：`fetchGatewayFiles / fetchGatewayFile / fetchGatewaySkills`（lib/gateway-client.ts，与 fetchGatewaySessions 同认证模式）。

## 验证

- 网关：`/v1/skills`（技能列表）、`/v1/files?path=/workspace`（真实文件）、`/v1/file?path=/workspace/.poweri/memory/memory.md`（真实内容含「幸运数字是 42」）、无 token 401
- fork 路由：`/api/skills` 返回 worker 技能、`/api/file-index` 递归文件、`/api/files/workspace?type=list`、`/api/files/workspace/hz-demo.md?type=read` 全文
- headless Chrome：技能面板 6/6 业务技能命中（code-review/tdd/prototype/research/grilling/ponytail），文件浏览器列出 worker 真实文件（hz-demo.md、kubernetes-controller-pattern.md 等），零 pageerror
- 回归：verify-24 13/13 通过

## 已知债务（ponytail）

- 只读：文件编辑（POST 写入）、download/preview/watch 未接网关（走宿主路径会 404/403）——需求出现再接
- `file-index` q 过滤是简单子串匹配（宿主版是 fuzzy），够用即可
- bridge `/files` recursive 走查上限 5000/深度 8，大仓库文件搜索不全——ponytail: 需要时换 git ls-files
- 技能列表只扫 agent skills 目录（seed-skills 播种处），与 pi 运行时 DefaultResourceLoader 的完整发现规则（packages/.agents 等）有差异——菜单展示够用
- 文件浏览器打开图片/音频（mime 流）在网关模式退化为纯文本——图片预览需求出现再接
