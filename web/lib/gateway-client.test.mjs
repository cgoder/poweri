// PowerI 网关客户端单测（ticket 04，v0.8.8 基底）：node --test lib/gateway-client.test.mjs
// 覆盖：SSE 帧解析 / 网关事件透传（保留 assistantMessageEvent，v0.8.8 前端经 toClientAgentEvent 投影）/
//       AgentEventStreamSession 兼容（isStreaming/streamingMessage）/ 历史消息映射 / 每用户 token
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// 仓库既有约定：带无扩展名相对导入的 .ts 用 jiti 加载（Node 原生 ESM 不解析 ./web-auth 这类无扩展名路径）
const jiti = createJiti(import.meta.url);
async function loadSubject() {
  return jiti.import("./gateway-client.ts");
}

// 真实网关 /v1/chat SSE 帧（本机实测抓取，2026-08-02）
const FRAME_READY = "event: ready\ndata: {\"sessionId\":\"msbc6xsg-c94670f4\",\"isNew\":true,\"userId\":\"alice\"}";
const FRAME_PROMPT_ACK = "data: {\"id\":\"msbc6xsg-c94670f4-f004f37e\",\"type\":\"response\",\"command\":\"prompt\",\"success\":true}";
const FRAME_AGENT_START = "data: {\"type\":\"agent_start\"}";
const FRAME_UPDATE = "data: {\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"text_delta\",\"contentIndex\":1,\"delta\":\"帧\",\"partial\":{\"role\":\"assistant\"}},\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"thinking\",\"thinking\":\"The user wants\"},{\"type\":\"text\",\"text\":\"帧\"}],\"stopReason\":\"pending\"}}";
const FRAME_EMPTY = "data: {}";

test("parseSseFrame：event 与 data 分离；空帧/非 data 帧返回 null", async () => {
  const { parseSseFrame } = await loadSubject();
  assert.deepEqual(parseSseFrame(FRAME_READY), { event: "ready", data: '{"sessionId":"msbc6xsg-c94670f4","isNew":true,"userId":"alice"}' });
  assert.deepEqual(parseSseFrame(FRAME_PROMPT_ACK), { event: "message", data: '{"id":"msbc6xsg-c94670f4-f004f37e","type":"response","command":"prompt","success":true}' });
  assert.deepEqual(parseSseFrame(FRAME_EMPTY), { event: "message", data: "{}" }, "字面解析不丢空对象（过滤在 translate 层）");
  assert.equal(parseSseFrame("event: done"), null);
  assert.equal(parseSseFrame(""), null);
});

test("translateGatewayEvent：剥 response/prompt ack、空对象；透传 pi 事件", async () => {
  const { translateGatewayEvent } = await loadSubject();
  assert.equal(translateGatewayEvent(JSON.parse(FRAME_PROMPT_ACK.split("data: ")[1])), null);
  assert.equal(translateGatewayEvent({}), null);
  assert.equal(translateGatewayEvent({ type: "prompt" }), null);
  assert.deepEqual(translateGatewayEvent(JSON.parse(FRAME_AGENT_START.split("data: ")[1])), { type: "agent_start" });
});

test("translateGatewayEvent：message_update 透传（保留 assistantMessageEvent，v0.8.8 前端经 toClientAgentEvent 投影）", async () => {
  const { translateGatewayEvent } = await loadSubject();
  const e = translateGatewayEvent(JSON.parse(FRAME_UPDATE.split("data: ")[1]));
  assert.equal(e?.type, "message_update");
  const ame = (e ?? {}).assistantMessageEvent;
  assert.equal(ame.type, "text_delta", "增量包装保留（上游 agent-event-wire 负责投影）");
  assert.equal(ame.delta, "帧");
  assert.equal(((e ?? {}).message).content[1].text, "帧", "累积 message 同步保留");
});

test("GatewaySessionClient：AgentEventStreamSession 兼容（isStreaming/streamingMessage）", async () => {
  const { GatewaySessionClient } = await loadSubject();
  const c = new GatewaySessionClient("/workspace");
  assert.equal(c.isStreaming, false, "初始非流式");
  assert.equal(c.streamingMessage, null, "网关模式不重放快照（事件实时透传）");
  assert.equal(typeof c.onEvent, "function");
  assert.equal(c.isAlive(), true);
  assert.equal(c.sessionFile, "/gateway/.jsonl");
  // prompt 启动后 isStreaming 在 agent_start 前保持 false，事件透传驱动
  c.shutdown();
});

test("gatewayMessageToUi：thinking+text 拆块，toolResult 保留 text", async () => {
  const { gatewayMessageToUi } = await loadSubject();
  const m = gatewayMessageToUi({ role: "assistant", thinking: "想", text: "答", ts: 1785647123026 }, "gw-1", 1);
  assert.equal(m.role, "assistant");
  assert.deepEqual(m.content, [{ type: "thinking", thinking: "想" }, { type: "text", text: "答" }]);
  assert.equal(m.timestamp, 1785647123026);
  const empty = gatewayMessageToUi({ role: "user", text: "", ts: undefined }, "gw-0", 0);
  assert.deepEqual(empty.content, [{ type: "text", text: "" }]);
});

test("isGatewaySessionId：msb* 判定", async () => {
  const { isGatewaySessionId } = await loadSubject();
  assert.ok(isGatewaySessionId("msbc6xsg-c94670f4"));
  assert.ok(!isGatewaySessionId("019fc0d0-a411-75a8-9633-762821708210"));
});

test("gateway client：不支持的命令不会静默成功", async () => {
  const { GatewaySessionClient, isGatewayCommandSupported } = await loadSubject();
  assert.equal(isGatewayCommandSupported("prompt"), true);
  assert.equal(isGatewayCommandSupported("bash"), false);
  const client = new GatewaySessionClient("/workspace");
  await assert.rejects(client.send({ type: "bash", command: "id" }), /not implemented/);
});

test("gatewayTokenForRequest：多用户未配置映射时 fail closed，不回退共享 token", async () => {
  const { gatewayTokenForRequest } = await loadSubject();
  const prevUsers = process.env.POWERI_WEB_USERS;
  const prevGatewayUsers = process.env.POWERI_GATEWAY_USERS;
  process.env.POWERI_WEB_USERS = "alice:pass-a;bob:pass-b";
  delete process.env.POWERI_GATEWAY_USERS;
  try {
    await assert.rejects(gatewayTokenForRequest(), /multi-user authentication/);
  } finally {
    if (prevUsers === undefined) delete process.env.POWERI_WEB_USERS;
    else process.env.POWERI_WEB_USERS = prevUsers;
    if (prevGatewayUsers === undefined) delete process.env.POWERI_GATEWAY_USERS;
    else process.env.POWERI_GATEWAY_USERS = prevGatewayUsers;
  }
});

test("gatewayTokenForUser：用户名→网关 token（POWERI_GATEWAY_USERS）", async () => {
  const { gatewayTokenForUser } = await loadSubject();
  const prev = process.env.POWERI_GATEWAY_USERS;
  process.env.POWERI_GATEWAY_USERS = "alice:token-a;bob:token-b";
  assert.equal(gatewayTokenForUser("alice"), "token-a");
  assert.equal(gatewayTokenForUser("bob"), "token-b");
  assert.equal(gatewayTokenForUser("carol"), "");      // 未知用户
  assert.equal(gatewayTokenForUser(""), "");           // 空用户名
  process.env.POWERI_GATEWAY_USERS = prev;
});

test("resolveWebUser：多用户表优先，回退单用户（pi + POWERI_WEB_PASSWORD）", async () => {
  const { resolveWebUser } = await loadSubject();
  const prevUsers = process.env.POWERI_WEB_USERS;
  const prevPass = process.env.POWERI_WEB_PASSWORD;
  const basic = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;
  // 多用户表
  process.env.POWERI_WEB_USERS = "alice:pass-a;bob:pass-b";
  delete process.env.POWERI_WEB_PASSWORD;
  assert.equal(resolveWebUser(basic("alice", "pass-a")), "alice");
  assert.equal(resolveWebUser(basic("bob", "pass-b")), "bob");
  assert.equal(resolveWebUser(basic("alice", "wrong")), null);
  assert.equal(resolveWebUser(basic("pi", "pass-a")), null, "表存在时 pi 不在表内 → 拒绝");
  assert.equal(resolveWebUser(null), null);
  // 回退单用户
  delete process.env.POWERI_WEB_USERS;
  process.env.POWERI_WEB_PASSWORD = "poweri-alice";
  assert.equal(resolveWebUser(basic("pi", "poweri-alice")), "pi");
  assert.equal(resolveWebUser(basic("pi", "wrong")), null);
  assert.equal(resolveWebUser(basic("alice", "poweri-alice")), null);
  // 兼容上游变量名 PI_WEB_PASSWORD（网关模式 + 只设上游密码时仍保底认证）
  delete process.env.POWERI_WEB_PASSWORD;
  process.env.PI_WEB_PASSWORD = "upstream-pass";
  assert.equal(resolveWebUser(basic("pi", "upstream-pass")), "pi");
  assert.equal(resolveWebUser(basic("pi", "wrong")), null);
  delete process.env.PI_WEB_PASSWORD;
  process.env.POWERI_WEB_USERS = prevUsers;
  process.env.POWERI_WEB_PASSWORD = prevPass;
});
