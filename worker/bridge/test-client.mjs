// PowerI 桥测试客户端
// 用法：bun run bridge/test-client.mjs [--host :PORT] ["提示词"]
// 流程：连接桥 → get_state（健康探针）→ 发送 prompt → 流式收事件 →
//       轮询 get_state 直到 isStreaming=false → get_messages 取最终 assistant 文本 → 退出
// 依赖：Bun 原生 WebSocket client，零依赖。

const url = process.argv[2]?.startsWith("ws") ? process.argv[2] : "ws://localhost:8081";
const prompt = process.argv[3] ?? "Reply with exactly one word: pong";
const ws = new WebSocket(url);

const types = new Set();
let promptAcked = false;
let done = false;

function send(o) { ws.send(JSON.stringify(o)); }

ws.onopen = () => {
  console.log("✔ connected");
  send({ id: "h1", type: "get_state" }); // 健康探针
  send({ id: "p1", type: "prompt", message: prompt });
};

ws.onmessage = (e) => {
  const o = JSON.parse(String(e.data));
  types.add(o.type);
  if (o.type === "response" && o.id === "h1") {
    console.log(`✔ get_state → success=${o.success} streaming=${o.data?.isStreaming} model=${o.data?.model?.id ?? o.data?.model?.name ?? "?"}`);
  }
  if (o.type === "response" && o.id === "p1") {
    console.log(`✔ prompt → success=${o.success}`);
    promptAcked = true;
  }
};

function finish() {
  if (done) return; done = true;
  console.log("\n=== 会话结果 ===");
  send({ id: "gm", type: "get_messages" });
  ws.onmessage = (e) => { // 覆盖，等 get_messages
    const o = JSON.parse(String(e.data));
    if (o.id === "gm") {
      const msgs = o.data?.messages ?? [];
      for (const m of msgs) {
        if (m.role === "assistant" && m.content) {
          const text = m.content.map((c) => c.text ?? "").join("").trim();
          if (text) console.log("ASSISTANT:", text.slice(0, 400));
        }
      }
      console.log("\n事件类型:", [...types].join(", "));
      ws.close();
      process.exit(0);
    }
  };
}

// 轮询 get_state 直到流结束
const iv = setInterval(() => send({ id: "poll", type: "get_state" }), 1500);
ws.onmessage_orig = ws.onmessage;
// 用包装：在流式 onmessage 基础上，轮询响应触发 finish
const origMsg = ws.onmessage;
ws.onmessage = (e) => {
  origMsg(e);
  const o = JSON.parse(String(e.data));
  if (o.id === "poll" && o.success && o.data?.isStreaming === false && promptAcked && !done) {
    clearInterval(iv);
    finish();
  }
};

setTimeout(() => { console.error("\n⏱ 超时（60s）"); process.exit(1); }, 60000);
