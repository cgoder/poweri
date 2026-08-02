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
