// PowerI 网关会话客户端（monorepo 适配层，ticket 04 重放，v0.8.8 基底）
// 实现 v0.8.8 路由/hooks 实际使用的会话表面（send/onEvent/isAlive/isStreaming/streamingMessage/sessionId…），
// 后端走网关 API（POST /v1/chat SSE + WS /v1/ws + GET /v1/sessions + /v1/sessions/<id>/messages）。
// 不实现 AgentSessionWrapper 全接口——chat 范围外命令返回安全默认（见 send 的 default 分支）。
// PowerI 网关模式配置：同时设置 POWERI_GATEWAY_URL + POWERI_GATEWAY_TOKEN 时启用。
// 启用后本模块变为纯壳：会话/对话全部经网关 → PowerI Worker 链。
import { createParser } from "eventsource-parser";
import { createHash, timingSafeEqual } from "node:crypto";

// ── 每用户认证解析（ticket 28 定制能力；v0.8.8 上游 web-auth 仅单用户，故自包含于此）──
// Basic 解码 + 多用户表（POWERI_WEB_USERS）优先，回退单用户（pi + POWERI_WEB_PASSWORD）
const POWERI_WEB_AUTH_USERNAME = "pi";

function secretsEqual(actual: string, expected: string): boolean {
  return timingSafeEqual(createHash("sha256").update(actual, "utf8").digest(), createHash("sha256").update(expected, "utf8").digest());
}

function decodeCredentials(authorization: string | null): { username: string; password: string } | null {
  if (!authorization) return null;
  const match = /^Basic\s+(\S+)$/i.exec(authorization);
  if (!match) return null;
  let credentials: string;
  try {
    const decoded = Buffer.from(match[1], "base64");
    if (decoded.toString("base64") !== match[1]) return null;
    credentials = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  } catch {
    return null;
  }
  const separator = credentials.indexOf(":");
  if (separator === -1) return null;
  return { username: credentials.slice(0, separator), password: credentials.slice(separator + 1) };
}

function parseWebUsers(env = process.env.POWERI_WEB_USERS): Record<string, string> {
  const map: Record<string, string> = {};
  for (const pair of (env ?? "").split(";")) {
    const i = pair.indexOf(":");
    if (i > 0) map[pair.slice(0, i).trim()] = pair.slice(i + 1);
  }
  return map;
}

/** 认证通过则返回用户名，否则 null。多用户表优先；缺省回退单用户（用户名 pi + POWERI_WEB_PASSWORD）。 */
export function resolveWebUser(authorization: string | null): string | null {
  const creds = decodeCredentials(authorization);
  if (!creds) return null;
  const users = parseWebUsers();
  if (Object.keys(users).length > 0) {
    const expected = users[creds.username];
    return expected && secretsEqual(creds.password, expected) ? creds.username : null;
  }
  const password = process.env.POWERI_WEB_PASSWORD;
  return password
    && secretsEqual(creds.username, POWERI_WEB_AUTH_USERNAME)
    && secretsEqual(creds.password, password)
    ? POWERI_WEB_AUTH_USERNAME
    : null;
}

export const gatewayConfig = {
  enabled: Boolean(process.env.POWERI_GATEWAY_URL && process.env.POWERI_GATEWAY_TOKEN),
  baseUrl: process.env.POWERI_GATEWAY_URL ?? "",
  token: process.env.POWERI_GATEWAY_TOKEN ?? "",
  workspace: process.env.POWERI_GATEWAY_CWD ?? "/workspace",
};

// ticket 28：按请求认证用户解析网关 token（POWERI_GATEWAY_USERS 用户名→token）；无则回退单用户 token
export function gatewayTokenForUser(user: string): string {
  for (const pair of (process.env.POWERI_GATEWAY_USERS ?? "").split(";")) {
    const i = pair.indexOf(":");
    if (i > 0 && pair.slice(0, i).trim() === user) return pair.slice(i + 1);
  }
  return "";
}
export async function gatewayTokenForRequest(): Promise<string> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const user = resolveWebUser(h.get("authorization"));
    if (user) {
      const t = gatewayTokenForUser(user);
      if (t) return t;
    }
  } catch { /* 非请求作用域（单测等）→ 回退单用户 token */ }
  return gatewayConfig.token;
}

// 平台单一模型标识（worker PVC models.json 的 poweri-gw/agent；models 路由/状态/历史上下文共用）
export const GW_MODEL = { id: "agent", provider: "poweri-gw" };

// 网关消息形状（gateway messagesFromJsonl 输出）
export interface GatewayMessage {
  role: string;
  text?: string;
  thinking?: string;
  ts?: number | string;
}

export type AgentEvent = Record<string, unknown> & { type: string };

// ── 纯函数（单测覆盖）───────────────────────────────────────────────

/** SSE 帧 → {event, data}；非 data 帧/空帧返回 null（基于 eventsource-parser，单测契约） */
export function parseSseFrame(frame: string): { event: string; data: string } | null {
  let result: { event: string; data: string } | null = null;
  const parser = createParser({ onEvent: (msg) => {
    result = { event: msg.event ?? "message", data: msg.data };
  } });
  parser.feed(frame + "\n\n");
  return result;
}

/** 网关 SSE 数据帧 → poweri-web 事件（透传 pi 原生事件；只剥网关专属 ready/prompt ack 帧）。
 * v0.8.8 前端经 agent-event-wire 的 toClientAgentEvent 统一投影 message_update（assistantMessageEvent），
 * 此处不做旧版剥离，避免双重处理。 */
export function translateGatewayEvent(obj: unknown): AgentEvent | null {
  if (!obj || typeof obj !== "object") return null;
  const e = obj as Record<string, unknown>;
  if (typeof e.type !== "string") return null;
  if (e.type === "response" || e.type === "prompt") return null; // prompt ack
  return e as AgentEvent;
}

// ── 会话客户端 ──────────────────────────────────────────────────────

export class GatewaySessionClient {
  sessionId: string; // 网关会话 id（msbXXX）；新会话在 ready 事件后更新
  readonly cwd: string;
  /** 会话创建者的网关 token（跨用户隔离：单实例 web 下 registry 共享，路由层校验请求者归属） */
  readonly ownerToken: string;
  private listeners = new Set<(e: AgentEvent) => void>();
  private _alive = true;
  private _promptRunning = false;
  private _isStreaming = false;
  private lastAssistantText = "";
  private stats: Record<string, unknown> | null = null;
  private sessionCreatedResolve: (() => void) | null = null;
  private readonly _token: string;

  constructor(cwd: string, sessionId = "", token = gatewayConfig.token) {
    this.cwd = cwd;
    this.sessionId = sessionId;
    this._token = token;
    this.ownerToken = token;
  }

  isAlive(): boolean {
    return this._alive;
  }
  isRunning(): boolean {
    return this._promptRunning || this._isStreaming;
  }
  /** v0.8.8 AgentEventStreamSession 兼容（agent-event-stream 快照/状态用） */
  get isStreaming(): boolean {
    return this._isStreaming;
  }
  /** v0.8.8 AgentEventStreamSession 兼容：网关模式事件实时透传，不重放快照 */
  get streamingMessage(): unknown {
    return null;
  }
  get sessionFile(): string {
    return `/gateway/${this.sessionId}.jsonl`;
  }

  // 与 AgentSessionWrapper 的表面兼容：auto-name/DELETE 等路由会碰 inner/shutdown，网关模式 no-op
  inner = {
    setSessionName(): void {},
    getSessionName: () => "",
  };
  shutdown(): void {}

  onEvent(listener: (e: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  waitUntilReady(): Promise<void> {
    return Promise.resolve();
  }

  private emit(e: AgentEvent): void {
    for (const l of this.listeners) {
      try { l(e); } catch { /* 单个监听器失败不影响其余 */ }
    }
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    switch (command.type) {
      case "prompt":
        return this.prompt(String(command.message ?? ""));
      case "abort":
        return this.abort();
      case "get_state":
        return this.getState();
      case "get_session_stats":
        return this.getStats();
      case "get_last_assistant_text":
        return this.lastAssistantText;
      case "get_tools":
        return [];
      case "get_commands":
        return [];
      case "clear_queue":
        return { steering: [], followUp: [] };
      // chat 范围外命令（fork/navigate_tree/compact/set_session_name/bash/set_model…）→ 安全默认
      // 全套工作区能力需网关 API 补齐（研究 §6.2）
      default:
        return null;
    }
  }

  /** fire-and-forget：启动 SSE 后立即返回；事件经 onEvent 流式送达。返回的 promise 在 ready（或流结束）后 resolve，保证路由拿到真实 sessionId。 */
  private prompt(message: string): Promise<unknown> {
    if (!message.trim()) return Promise.resolve(null);
    this._promptRunning = true;
    this.emitRunningChange();
    const ready = new Promise<void>((resolve) => {
      this.sessionCreatedResolve = resolve;
    });
    void (async () => {
      try {
        const res = await fetch(`${gatewayConfig.baseUrl}/v1/chat`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this._token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ session: this.sessionId || "new", message }),
        });
        if (!res.ok || !res.body) throw new Error(`gateway /v1/chat HTTP ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        // 增量 SSE 解析走 eventsource-parser（业界标准，Vercel AI SDK 同款），不手撸切帧
        const parser = createParser({ onEvent: (msg) => {
          this.handleFrame({ event: msg.event ?? "message", data: msg.data });
        } });
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.feed(decoder.decode(value, { stream: true }));
        }
      } catch (err) {
        this.resolveSessionCreated();
        this.emit({ type: "prompt_error", error: String(err instanceof Error ? err.message : err) });
      } finally {
        this._promptRunning = false;
        this._isStreaming = false;
        this.resolveSessionCreated();
        this.emit({ type: "prompt_done" });
        this.emitRunningChange();
      }
    })();
    return ready.then(() => null);
  }

  private resolveSessionCreated(): void {
    if (this.sessionCreatedResolve) {
      const r = this.sessionCreatedResolve;
      this.sessionCreatedResolve = null;
      r();
    }
  }

  private handleFrame(frame: { event: string; data: string }): void {
    if (!frame.data) return;
    let obj: unknown;
    try { obj = JSON.parse(frame.data); } catch { return; }
    if (frame.event === "ready") {
      const sid = (obj as { sessionId?: string })?.sessionId;
      if (sid) {
        this.sessionId = sid;
        this.resolveSessionCreated();
        this.emit({ type: "session_created", sessionId: sid } as AgentEvent);
      }
      return;
    }
    const ev = translateGatewayEvent(obj);
    if (!ev) return;
    if (ev.type === "agent_start") this._isStreaming = true;
    if (ev.type === "agent_settled") this._isStreaming = false;
    if (ev.type === "message_end" && (ev.message as { role?: string })?.role === "assistant") {
      const m = ev.message as { content?: Array<{ type: string; text?: string }>; usage?: Record<string, unknown> };
      const text = (m.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
      if (text) this.lastAssistantText = text;
      if (m.usage && Object.keys(m.usage).length > 0) this.stats = m.usage;
    }
    this.emit(ev);
  }

  private getState(): Record<string, unknown> {
    return {
      sessionId: this.sessionId,
      sessionFile: this.sessionFile,
      isStreaming: this._isStreaming,
      isPromptRunning: this._promptRunning,
      isBashRunning: false,
      isCompacting: false,
      autoCompactionEnabled: false,
      autoRetryEnabled: false,
      model: { ...GW_MODEL },
      messageCount: 0,
      pendingMessageCount: 0,
      queuedMessages: { steering: [], followUp: [] },
      contextUsage: null,
      systemPrompt: "（网关模式）系统提示词由 worker 上的 pi 运行时在每次代理启动时合成（含 User Memory 扩展注入的用户画像/事实/偏好），壳经网关无法读取远程运行时提示词——试点已知限制。",
      thinkingLevel: "medium",
      extensionStatuses: [],
      extensionWidgets: [],
    };
  }

  private getStats(): Record<string, unknown> | null {
    return this.stats;
  }

  private abort(): Promise<unknown> {
    // 网关 WS /v1/ws?token=… 发 abort 中断当前轮
    try {
      const ws = new WebSocket(`${gatewayConfig.baseUrl.replace(/^http/, "ws")}/v1/ws?token=${this._token}`);
      ws.onopen = () => { ws.send(JSON.stringify({ type: "abort" })); ws.close(); };
      ws.onerror = () => { /* 无连接可中断，忽略 */ };
    } catch { /* WebSocket 不可用时忽略 */ }
    return Promise.resolve(null);
  }

  private emitRunningChange(): void {
    this.emit({ type: "running_change", running: this.isRunning() } as AgentEvent);
  }
}

// ── 历史渲染辅助（/v1/sessions/<id>/messages → 前端 AgentMessage）────────

/** 网关模式跨用户隔离：请求用户（当前请求解析的网关 token）是否为该会话客户端的所有者 */
export async function isGatewaySessionOwner(client: { ownerToken: string }): Promise<boolean> {
  return client.ownerToken === (await gatewayTokenForRequest());
}

/** 网关会话 id 判定（msb* 平铺 gateway 会话） */
export function isGatewaySessionId(id: string): boolean {
  return /^msb[a-z0-9]+/.test(id);
}

/** 网关消息 → 前端可渲染消息（text/thinking 块；toolResult 保留 text） */
export function gatewayMessageToUi(m: GatewayMessage, id: string, index: number): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [];
  if (m.thinking) content.push({ type: "thinking", thinking: m.thinking });
  if (m.text) content.push({ type: "text", text: m.text });
  if (content.length === 0) content.push({ type: "text", text: "" });
  return {
    id,
    role: m.role,
    content,
    timestamp: typeof m.ts === "number" ? m.ts : Date.parse(String(m.ts ?? "")) || undefined,
    index,
    pending: false,
  };
}

/** 网关会话列表（带 30s 缓存，供 session-reader 与 history 路由共用） */
let gatewaySessionsCache: { at: number; token: string; sessions: Array<Record<string, unknown>> } | null = null;
/** 新会话创建后立即失效列表缓存，避免侧栏 30s 内看不到新会话（agent_end 后侧栏刷新即命中） */
export function invalidateGatewaySessions(): void {
  gatewaySessionsCache = null;
}
export async function fetchGatewaySessions(force = false): Promise<Array<Record<string, unknown>>> {
  const token = await gatewayTokenForRequest();
  if (!gatewaySessionsCache || gatewaySessionsCache.token !== token || force || Date.now() - gatewaySessionsCache.at > 30_000) {
    const res = await fetch(`${gatewayConfig.baseUrl}/v1/sessions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { sessions?: Array<Record<string, unknown>> };
    gatewaySessionsCache = { at: Date.now(), token, sessions: body.sessions ?? [] };
  }
  return gatewaySessionsCache.sessions;
}

export async function fetchGatewaySessionMessages(id: string): Promise<{ status: number; messages?: GatewayMessage[] }> {
  const res = await fetch(`${gatewayConfig.baseUrl}/v1/sessions/${encodeURIComponent(id)}/messages`, {
    headers: { Authorization: `Bearer ${await gatewayTokenForRequest()}` },
  });
  if (!res.ok) return { status: res.status };
  const body = (await res.json()) as { messages?: GatewayMessage[] };
  return { status: res.status, messages: body.messages };
}

/** 原始会话 JSONL（导出 HTML 用） */
export async function fetchGatewaySessionJsonl(id: string): Promise<{ status: number; lines?: string }> {
  const res = await fetch(`${gatewayConfig.baseUrl}/v1/sessions/${encodeURIComponent(id)}/jsonl`, {
    headers: { Authorization: `Bearer ${await gatewayTokenForRequest()}` },
  });
  if (!res.ok) return { status: res.status };
  return { status: res.status, ...((await res.json()) as { lines?: string }) };
}

// 会话改名/删除（gateway → bridge → worker PVC）
export async function fetchGatewaySessionRename(id: string, name: string): Promise<{ status: number }> {
  const res = await fetch(`${gatewayConfig.baseUrl}/v1/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${await gatewayTokenForRequest()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return { status: res.status };
}
export async function fetchGatewaySessionDelete(id: string): Promise<{ status: number }> {
  const res = await fetch(`${gatewayConfig.baseUrl}/v1/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${await gatewayTokenForRequest()}` },
  });
  return { status: res.status };
}
