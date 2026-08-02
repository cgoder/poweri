// 会话 API 纯函数单元测试：node --test gateway/test/
// 覆盖：messagesFromJsonl 解析（text/thinking 拆分、截断行、无消息）
import { test } from "node:test";
import assert from "node:assert/strict";
import { messagesFromJsonl, sessionListEntry, SESSIONS_CONTAINER_DIR } from "../session-parse.mjs";

// 真实 pi 会话文件（取自 worker PVC msb55j0s-243fa22a.jsonl，保留结构：session 头/model_change/消息/截断行）
const REAL_SESSION = [
  { type: "session", version: 3, id: "019fc028-6300-743a-9a8b-321cecfda8db", timestamp: "2026-08-02T01:48:20.096Z", cwd: "/workspace" },
  { type: "model_change", id: "c9673f08", parentId: null, timestamp: "2026-08-02T01:48:20.130Z", provider: "poweri-gw", modelId: "agent" },
  { type: "message", id: "213d903e", parentId: "ff186b2e", timestamp: "2026-08-02T01:48:20.134Z", message: { role: "user", content: [{ type: "text", text: "列出所有 skills" }], timestamp: 1785635300133 } },
  { type: "message", id: "0c33932c", parentId: "213d903e", timestamp: "2026-08-02T01:48:22.465Z", message: { role: "assistant", content: [{ type: "thinking", thinking: "思考…" }, { type: "text", text: "好的" }], api: "openai-completions", provider: "poweri-gw", model: "agent", usage: { input: 3401 }, stopReason: "toolUse", timestamp: 1785635300162 } },
  { type: "message", id: "296e030b", parentId: "0c33932c", timestamp: "2026-08-02T01:48:22.487Z", message: { role: "toolResult", toolCallId: "call_00", toolName: "bash", content: [{ type: "text", text: "code-review\nprototype\n" }], isError: false, timestamp: 1785635302487 } },
  '{ "type": "truncated-line-no-closing',
  "",
].map((o) => (typeof o === "string" ? o : JSON.stringify(o))).join("\n");

test("messagesFromJsonl：解析 user/assistant，text 与 thinking 拆分", () => {
  const lines = [
    { type: "session", id: "s1", cwd: "/workspace" },
    { type: "message", message: { role: "user", content: [{ type: "text", text: "你好" }] }, timestamp: 1 },
    { type: "message", message: { role: "assistant", content: [
      { type: "thinking", thinking: "思考中" },
      { type: "text", text: "回复" },
    ] }, timestamp: 2 },
  ].map((o) => JSON.stringify(o)).join("\n");

  const msgs = messagesFromJsonl(lines);
  assert.equal(msgs.length, 2);
  assert.deepEqual(msgs[0], { role: "user", text: "你好", thinking: undefined, ts: 1 });
  assert.deepEqual(msgs[1], { role: "assistant", text: "回复", thinking: "思考中", ts: 2 });
});

test("messagesFromJsonl：跳过非 message 行与截断行", () => {
  const lines = [
    '{"type":"session","id":"s1"}',
    '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}',
    '{"type":"truncated-line-no-closing',
    '{"type":"message","message":{"role":"assistant","content":[]}}', // 空 content → 跳过
    "",
  ].join("\n");
  const msgs = messagesFromJsonl(lines);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].role, "user");
  assert.equal(msgs[0].text, "hi");
});

test("sessionListEntry：真实文件结构 → 完整 DTO（cwd/created/消息数/首条）", () => {
  const e = sessionListEntry("msb55j0s-243fa22a", REAL_SESSION, "2026-08-02T01:49:00.000Z");
  assert.equal(e.id, "msb55j0s-243fa22a");
  assert.equal(e.cwd, "/workspace");
  assert.equal(e.created, "2026-08-02T01:48:20.096Z");
  assert.equal(e.modified, "2026-08-02T01:49:00.000Z");
  assert.equal(e.messageCount, 3, "user+assistant+toolResult 三条（截断行跳过）");
  assert.equal(e.firstMessage, "列出所有 skills");
  // messageCount 与历史端点（messagesFromJsonl）产出条数天然一致
  assert.equal(e.messageCount, messagesFromJsonl(REAL_SESSION).length);
  assert.equal(e.name, ""); // 无 session_info 行时为空
});

test("sessionListEntry：空/无消息文件", () => {
  const e = sessionListEntry("empty", "", "2026-08-02T00:00:00Z");
  assert.deepEqual(e, { id: "empty", cwd: "", created: "", modified: "2026-08-02T00:00:00Z", messageCount: 0, firstMessage: "", name: "" });
});

test("SESSIONS_CONTAINER_DIR 与 worker 容器布局一致", () => {
  assert.equal(SESSIONS_CONTAINER_DIR, "/home/piuser/.pi/agent/sessions");
});

// ── ticket 29：会话改名（session_info 行追加与解析）与删除 ──

test("sessionListEntry：解析最新 session_info 的 name", () => {
  const withInfo = REAL_SESSION + '\n{"type":"session_info","id":"si-1","parentId":"x","timestamp":"2026-08-02T01:00:00Z","name":"我的会话"}';
  const e = sessionListEntry("s1", withInfo, "2026-08-02T01:00:00Z");
  assert.equal(e.name, "我的会话");
  // 反向取最新一条
  const withTwo = withInfo + '\n{"type":"session_info","id":"si-2","parentId":"si-1","timestamp":"2026-08-02T02:00:00Z","name":"改名后"}';
  assert.equal(sessionListEntry("s2", withTwo, "2026-08-02T02:00:00Z").name, "改名后");
});
