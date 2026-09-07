// PowerI 网关模式全功能路由分支单测（ticket 05）：node --test lib/gateway-routes-gateway.test.mjs
// 沿用上游 rpc-manager.test.mjs 的源码文本断言风格（不加载路由/SDK，避免依赖副作用）。
// 覆盖：ticket 05 新增的全部网关分支——改名/删除/导出/auto-name/context、file-index、
// files、plugins、skills、cwd/browse、cwd/validate。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readRoute(rel) {
  return readFile(new URL(rel, import.meta.url), "utf8");
}

test("sessions/[id] PATCH 网关分支：改名走 fetchGatewaySessionRename + 列表缓存失效", async () => {
  const src = await readRoute("../app/api/sessions/[id]/route.ts");
  const fn = src.slice(src.indexOf("export async function PATCH"));
  const gw = fn.indexOf("if (gatewayConfig.enabled)");
  assert.ok(gw >= 0, "PATCH 网关分支存在");
  assert.ok(gw < fn.indexOf("const filePath = await resolveSessionPath(id)"), "分支先于本地解析");
  assert.match(fn, /fetchGatewaySessionRename\(id, name\.trim\(\)\)/);
  assert.match(fn, /invalidateSessionListCache\(\)/);
});

test("sessions/[id] DELETE 网关分支：删除走 fetchGatewaySessionDelete + registry 关闭", async () => {
  const src = await readRoute("../app/api/sessions/[id]/route.ts");
  const fn = src.slice(src.indexOf("export async function DELETE"));
  const gw = fn.indexOf("if (gatewayConfig.enabled)");
  assert.ok(gw >= 0, "DELETE 网关分支存在");
  assert.ok(gw < fn.indexOf("const filePath = await resolveSessionPath(id)"), "分支先于本地解析");
  assert.match(fn, /fetchGatewaySessionDelete\(id\)/);
  assert.match(fn, /getRpcSession\(id\)\?\.shutdown\(\)/);
});

test("sessions/[id]/context GET 网关分支：历史经 gatewayHistoryContext（无本地 entries）", async () => {
  const src = await readRoute("../app/api/sessions/[id]/context/route.ts");
  const fn = src.slice(src.indexOf("export async function GET"));
  const gw = fn.indexOf("if (gatewayConfig.enabled)");
  assert.ok(gw >= 0, "context 网关分支存在");
  assert.ok(gw < fn.indexOf("const url = new URL(req.url)"), "分支在本地读取之前");
  assert.match(fn, /gatewayHistoryContext\(id\)/);
});

test("sessions/[id]/auto-name POST 网关分支：首条用户消息派生标题（不走模型）", async () => {
  const src = await readRoute("../app/api/sessions/[id]/auto-name/route.ts");
  const fn = src.slice(src.indexOf("export async function POST"));
  const gw = fn.indexOf("if (gatewayConfig.enabled)");
  assert.ok(gw >= 0, "auto-name 网关分支存在");
  assert.match(fn, /fetchGatewaySessionMessages\(id\)/);
  assert.match(fn, /firstUser\?\.text/);
  assert.match(fn, /slice\(0, 40\)/);
});

test("sessions/[id]/export GET 网关分支：JSONL 经网关落临时文件再导出", async () => {
  const src = await readRoute("../app/api/sessions/[id]/export/route.ts");
  const fn = src.slice(src.indexOf("export async function GET"));
  const gw = fn.indexOf("if (gatewayConfig.enabled)");
  assert.ok(gw >= 0, "export 网关分支存在");
  assert.match(fn, /fetchGatewaySessionJsonl\(id\)/);
  assert.match(fn, /gateway-\$\{id\}\.jsonl/);
  assert.match(fn, /cleanupTemp/);
});

test("file-index GET 网关分支：经 fetchGatewayFiles 递归列出，q 过滤", async () => {
  const src = await readRoute("../app/api/file-index/route.ts");
  const fn = src.slice(src.indexOf("export async function GET"));
  const gw = fn.indexOf("if (gatewayConfig.enabled)");
  assert.ok(gw >= 0, "file-index 网关分支存在");
  assert.ok(gw < fn.indexOf("const allowedRoots = await getAllowedFileRoots()"), "分支先于宿主授权检查");
  assert.match(fn, /fetchGatewayFiles\(cwd, true\)/);
});

test("files/[...path] GET 网关分支：read/meta/list 走网关，其余 type 拒绝", async () => {
  const src = await readRoute("../app/api/files/[...path]/route.ts");
  const fn = src.slice(src.indexOf("export async function GET"));
  const gw = fn.indexOf("if (gatewayConfig.enabled)");
  assert.ok(gw >= 0, "files 网关分支存在");
  assert.ok(gw < fn.indexOf("const allowedRoots = await getAllowedFileRoots()"), "分支先于宿主授权检查");
  assert.match(fn, /fetchGatewayFile\(gwPath\)/);
  assert.match(fn, /fetchGatewayFiles\(gwPath, false\)/);
  assert.match(fn, /网关模式不支持 type=/);
});

test("plugins GET/POST 网关分支：空列表 / 拒绝管理", async () => {
  const src = await readRoute("../app/api/plugins/route.ts");
  const getFn = src.slice(src.indexOf("export async function GET"));
  assert.match(getFn.slice(0, getFn.indexOf("const allowedRoots")), /gatewayConfig\.enabled/);
  assert.match(getFn, /packages: \[\],/);
  const postFn = src.slice(src.indexOf("export async function POST"));
  const postGw = postFn.indexOf("if (gatewayConfig.enabled)");
  assert.ok(postGw >= 0 && postGw < postFn.indexOf("const allowedRoots"), "POST 网关分支先于宿主检查");
  assert.match(postFn, /网关模式不支持插件管理/);
});

test("skills GET/PATCH 网关分支：扫描经网关；禁用开关拒绝", async () => {
  const src = await readRoute("../app/api/skills/route.ts");
  const getFn = src.slice(src.indexOf("export async function GET"));
  assert.match(getFn, /fetchGatewaySkills\(\)/);
  const patchFn = src.slice(src.indexOf("export async function PATCH"));
  const patchGw = patchFn.indexOf("if (gatewayConfig.enabled)");
  assert.ok(patchGw >= 0 && patchGw < patchFn.indexOf("existsSync(filePath)"), "PATCH 网关分支先于本地存在检查");
  assert.match(patchFn, /网关模式不支持技能禁用开关/);
});

test("cwd/browse + cwd/validate 网关分支：宿主目录浏览/校验一律拒绝（防宿主路径枚举）", async () => {
  const browse = await readRoute("../app/api/cwd/browse/route.ts");
  const browseFn = browse.slice(browse.indexOf("export async function GET"));
  assert.match(browseFn, /网关模式工作区固定为 \/workspace，不支持宿主目录浏览/);
  assert.ok(browseFn.indexOf("if (gatewayConfig.enabled)") < browseFn.indexOf("shouldShowWindowsDrivePicker"), "分支在宿主浏览之前");

  const validate = await readRoute("../app/api/cwd/validate/route.ts");
  const validateFn = validate.slice(validate.indexOf("export async function POST"));
  assert.match(validateFn, /网关模式工作区固定为 \/workspace/);
  assert.ok(validateFn.indexOf("if (gatewayConfig.enabled)") < validateFn.indexOf("statSync(normalizedCwd)"), "分支在宿主校验之前");
});

test("PowerI 产品 API 受 proxy 认证覆盖，网关统计不回退宿主 session", async () => {
  const proxy = await readRoute("../proxy.ts");
  assert.match(proxy, /\/poweri\/:path\*/);
  assert.match(proxy, /pathname\.startsWith\("\/poweri\/api\/"\)/);

  const usage = await readRoute("../app/poweri/api/usage/route.ts");
  const summaries = await readRoute("../app/poweri/api/session-summaries/route.ts");
  const stats = await readRoute("../app/poweri/api/session-stats/[id]/route.ts");
  assert.match(usage, /fetchGatewayUsage\(/);
  assert.match(summaries, /fetchGatewayUsage\(/);
  assert.match(stats, /fetchGatewaySessionMessages\(id\)/);
  assert.match(stats, /if \(gatewayConfig\.enabled\) return gatewaySessionStats\(id\)/);
  assert.doesNotMatch(usage, /getAggregate\(forceRefresh\)[\s\S]*gatewayConfig\.enabled/);
});

test("set_tools 网关模式拒绝本地 runtime 回退", async () => {
  const src = await readRoute("../app/api/agent/[id]/route.ts");
  const fn = src.slice(src.indexOf("export async function POST"));
  const gatewaySetTools = fn.indexOf('body.type === "set_tools" && gatewayConfig.enabled');
  const localSetTools = fn.indexOf('if (body.type === "set_tools") {', gatewaySetTools + 1);
  assert.ok(gatewaySetTools >= 0, "网关 set_tools 分支存在");
  assert.ok(localSetTools > gatewaySetTools, "网关分支先于本地工具 runtime");
  assert.match(fn.slice(gatewaySetTools, localSetTools), /status: 501/);
});

test("gateway-client 新增 fetch：文件/技能/用户计量 API 接入（fake fetch）", async () => {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url);
  const mod = await jiti.import("./gateway-client.ts");
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    calls.push(`${init?.method ?? "GET"} ${String(url)}`);
    const u = String(url);
    const status = 200;
    if (u.includes("/v1/files")) return new Response(JSON.stringify({ files: ["/workspace/a.ts"], entries: [] }));
    if (u.includes("/v1/file")) return new Response(JSON.stringify({ content: "hello" }));
    if (u.includes("/v1/skills")) return new Response(JSON.stringify({ skills: [{ name: "tdd" }] }));
    if (u.includes("/v1/users/me/usage")) return new Response(JSON.stringify({ records: [{ sessionId: "msb-a", ts: 1, usage: { totalTokens: 2 } }] }));
    return new Response(JSON.stringify({}), { status });
  });
  try {
    const files = await mod.fetchGatewayFiles("/workspace", true);
    assert.deepEqual(files.files, ["/workspace/a.ts"]);
    const content = await mod.fetchGatewayFile("/workspace/a.ts");
    assert.equal(content, "hello");
    const skills = await mod.fetchGatewaySkills();
    assert.deepEqual(skills, [{ name: "tdd" }]);
    const usage = await mod.fetchGatewayUsage(1, 2);
    assert.equal(usage.records[0].sessionId, "msb-a");
    assert.ok(calls.some((c) => c.includes("/v1/files?")), "files 走网关 /v1/files");
    assert.ok(calls.some((c) => c.includes("/v1/file?")), "file 走网关 /v1/file");
    assert.ok(calls.some((c) => c.includes("/v1/skills")), "skills 走网关 /v1/skills");
    assert.ok(calls.some((c) => c.includes("/v1/users/me/usage?")), "usage 走用户作用域计量 API");
  } finally {
    globalThis.fetch = realFetch;
  }
});
