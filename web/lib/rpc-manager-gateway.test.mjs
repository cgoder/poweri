// PowerI 网关模式 RPC 分支单测（ticket 04）：node --test lib/rpc-manager-gateway.test.mjs
// 沿用上游 rpc-manager.test.mjs 的源码文本断言风格（不加载 SDK，避免依赖副作用）。
// 覆盖：startRpcSession 网关分支位置与行为、getRpcSessionInfos 网关分支、session_created 补注册。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readRpcManager() {
  return readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
}

test("startRpcSession 网关分支位于函数开头（registry/locks 检查之前，优先于进程内会话）", async () => {
  const source = await readRpcManager();
  const fn = source.slice(source.indexOf("export async function startRpcSession"));
  const gwIndex = fn.indexOf("if (gatewayConfig.enabled)");
  const registryIndex = fn.indexOf("const existing = registry.get(sessionId)");
  assert.ok(gwIndex >= 0, "网关分支存在");
  assert.ok(registryIndex > gwIndex, "网关分支先于进程内 registry 检查");
});

test("网关分支创建 GatewaySessionClient 并处理 registry/locks/session_created 补注册", async () => {
  const source = await readRpcManager();
  const fn = source.slice(source.indexOf("export async function startRpcSession"), source.indexOf("const existing = registry.get(sessionId)"));
  assert.match(fn, /new GatewaySessionClient\(gwCwd, sessionFile \? sessionId : "", await gatewayTokenForRequest\(\)\)/);
  assert.match(fn, /registry\.set\(sessionId, client as unknown as AgentSessionWrapper\)/);
  assert.match(fn, /locks\.set\(sessionId, startingGw\)/);
  // 新会话真实 id（msbXXX）在 ready 事件后补注册，供 events 路由按真实 id 查找
  assert.match(fn, /if \(e\.type === "session_created" && e\.sessionId\)/);
  assert.match(fn, /registry\.set\(realId, client/);
  assert.match(fn, /registry\.delete\(sessionId\)/);
  assert.match(fn, /getGatewaySessionAliases\(\)\.set\(sessionId/);
  assert.match(source, /return getRegistry\(\)\.get\(resolveGatewaySessionId\(sessionId\)\)/);
});

test("getRpcSessionInfos 网关分支返回空（运行时会话由网关管理，不扫描本地 registry）", async () => {
  const source = await readRpcManager();
  const fn = source.slice(source.indexOf("export function getRpcSessionInfos"));
  const gwIndex = fn.indexOf("if (gatewayConfig.enabled) return [];");
  assert.ok(gwIndex >= 0, "网关分支存在");
  assert.ok(gwIndex < fn.indexOf("const sessions: SessionInfo[] = []"), "分支在本地扫描之前");
});

test("session-reader listAllSessions 网关分支走 fetchGatewaySessions + cacheSessionPath", async () => {
  const source = await readFile(new URL("./session-reader.ts", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("export async function listAllSessions"));
  const gwIndex = fn.indexOf("if (gatewayConfig.enabled)");
  assert.ok(gwIndex >= 0, "网关分支存在");
  assert.ok(gwIndex < fn.indexOf("if (options.force)"), "分支在本地缓存逻辑之前");
  assert.match(fn.slice(gwIndex, gwIndex + 400), /fetchGatewaySessions\(options\.force\)/);
  assert.match(fn.slice(gwIndex, gwIndex + 400), /cacheSessionPath/);
});
