#!/usr/bin/env node
// 生成 docs/web-customizations.md（人读视图）。唯一源是 docs/web-customizations.json。
// 用法：node scripts/render-customizations-md.mjs
import { readFileSync, writeFileSync } from "node:fs";
const m = JSON.parse(readFileSync("docs/web-customizations.json", "utf8"));
const web = m.modules.web;
const CAT_LABEL = {
  "gateway-adapter": "网关适配", "upstream-sync": "上游演进吸收", "poweri-product": "PowerI 产品能力",
  branding: "品牌/PWA", "test-harness": "测试夹具", deploy: "部署物", "build-config": "构建配置",
};
const RISK_LABEL = { high: "高", medium: "中", low: "低" };
const uniq = (arr) => [...new Set(arr)];
const esc = (s) => String(s).replace(/\|/g, "\\|");
const short = (s, n) => (s.length <= n ? s : s.slice(0, n - 1) + "…");

// 生成独立新增文件的按类别视图（只列代表，避免 178 行表格）
const indep = web.independent;
const indepGroups = {};
for (const f of indep) {
  const g = f.startsWith("poweri/") ? "poweri/ 产品层" : f.startsWith("app/poweri/") ? "app/poweri/ 路由与 API"
    : /\.test\.mjs$/.test(f) ? "新增测试" : f.startsWith("app/api/") ? "app/api/ 新增 API" : f.startsWith("lib/") ? "lib/ 新增模块" : f.startsWith("components/") ? "components/ 新增组件" : "其它";
  (indepGroups[g] ??= []).push(f);
}

const lines = [];
lines.push("# Web 适配层定制清单（迁移期上游资产）");
lines.push("");
lines.push("> **权威文件**：[`docs/web-customizations.json`](web-customizations.json)（`scripts/validate-customizations.mjs` 唯一读取源）。本页是生成视图，**只读**；修改请改 JSON 后跑 `node scripts/render-customizations-md.mjs`。");
lines.push(">");
lines.push("> **适用范围**：只记录迁移期 web/ UI/交互资产与 agegr/pi-web 上游之间的差异。不定义终局 AgentClient、AgentHost、gateway、worker 或 Agent Runtime 架构；终局以 [ADR-0011](adr/0011-poweri-web-agent-surface.md) 为准。");
lines.push(">");
lines.push("> **纪律**：定制优先新增独立文件（上游不存在的文件 → subtree pull 零冲突）；必须侵入上游文件的改动登记在 `intrusions`。");
lines.push("");
lines.push("## 上游基线与落后量");
lines.push("");
const up = web.upstream;
const mig = m.migration ?? {};
lines.push(`| 项 | 值 |`);
lines.push(`|---|---|`);
lines.push(`| 上游仓库 | ${up.repo} |`);
lines.push(`| 引入版本 | **${up.version}**（发布 ${mig.baseline?.publishedAt ?? "?"}） |`);
lines.push(`| subtree squash / split | \`${up.subtreeSquash.slice(0, 12)}…\` / \`${up.subtreeSplit.slice(0, 12)}…\` |`);
lines.push(`| 上游最新（观测 ${mig.observedAt ?? "?"}） | **${mig.upstreamLatest?.version ?? "?"}**（发布 ${mig.upstreamLatest?.publishedAt ?? "?"}） |`);
lines.push(`| 落后量 | ${mig.lag ?? "?"} |`);
lines.push(`| 已执行升级演练 | 无（ticket 09 待执行） |`);
lines.push("");
if (mig.unregisteredBacklog) { lines.push("> **历史包袱**：" + mig.unregisteredBacklog); lines.push(""); }

lines.push("## 侵入上游文件（" + web.intrusions.length + " 条）");
lines.push("");
const byCat = {};
for (const i of web.intrusions) (byCat[i.category] ??= []).push(i);
const order = ["gateway-adapter", "upstream-sync", "poweri-product", "branding", "test-harness", "build-config"];
for (const c of order) {
  const items = byCat[c]; if (!items) continue;
  const risks = items.reduce((a, i) => ((a[i.risk] = (a[i.risk] ?? 0) + 1), a), {});
  lines.push(`### ${CAT_LABEL[c] ?? c}（${items.length}）：${m.categories?.[c] ?? ""}`);
  lines.push("");
  lines.push(`风险分布：高 ${risks.high ?? 0} / 中 ${risks.medium ?? 0} / 低 ${risks.low ?? 0}`);
  lines.push("");
  lines.push("| 文件 | 改动 | 风险 |");
  lines.push("|---|---|---|");
  for (const i of items.sort((a, b) => (a.file < b.file ? -1 : 1))) {
    lines.push(`| \`web/${i.file}\` | ${esc(short(i.reason, 150))} | ${RISK_LABEL[i.risk] ?? i.risk} |`);
  }
  lines.push("");
}

lines.push("## 独立新增文件（" + indep.length + " 条，零冲突）");
lines.push("");
for (const g of ["poweri/ 产品层", "app/poweri/ 路由与 API", "app/api/ 新增 API", "lib/ 新增模块", "components/ 新增组件", "新增测试", "其它"]) {
  const fs = indepGroups[g]; if (!fs) continue;
  lines.push(`- **${g}**（${fs.length}）：` + fs.slice(0, 8).map((f) => "`" + f + "`").join("、") + (fs.length > 8 ? ` …（完整列表见 JSON）` : ""));
}
lines.push("");

if (mig.knownGaps?.length) {
  lines.push("## 已知缺口（升级前必须先处理）");
  lines.push("");
  for (const g of mig.knownGaps) lines.push(`- ${g}`);
  lines.push("");
}

lines.push("## gateway/ 内改动（源仓库已冻结归档，无 pull 冲突面；仅记录）");
lines.push("");
const gw = m.modules.gateway;
lines.push(`上游：\`${gw.upstream.repo}\` ${gw.upstream.version}`);
lines.push("");
lines.push("| 文件 | 改动理由 |");
lines.push("|---|---|");
for (const c of gw.changes) lines.push(`| \`gateway/${c.file}\` | ${esc(c.reason)} |`);
lines.push("");
lines.push("<!-- 生成命令：node scripts/render-customizations-md.mjs（源：docs/web-customizations.json） -->");
writeFileSync("docs/web-customizations.md", lines.join("\n") + "\n");
console.log("written", lines.length, "lines");
