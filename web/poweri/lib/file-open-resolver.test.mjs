/**
 * file-open-resolver 单测：mock fetchImpl，覆盖 resolve-file 五种结局。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { resolveFileForOpen } = await jiti.import("./file-open-resolver.ts");

function fetchJson(status, body) {
  return (async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
}

test("原路径存在（hit=true）→ open 原路径", async () => {
  const calls = [];
  const fetchImpl = (url) => {
    calls.push(url);
    return fetchJson(200, { resolvedPath: "/w/docs/a.md", candidates: ["/w/docs/a.md"], hit: true })();
  };
  const r = await resolveFileForOpen("/w", "/w/docs/a.md", fetchImpl);
  assert.deepEqual(r, { kind: "open", filePath: "/w/docs/a.md" });
  assert.match(calls[0], /cwd=%2Fw&path=%2Fw%2Fdocs%2Fa\.md$/);
});

test("basename 工作区唯一命中 → open 命中路径", async () => {
  const fetchImpl = () => fetchJson(200, { resolvedPath: "/w/docs/desktop/file-map.md", candidates: ["/w/docs/desktop/file-map.md"], hit: true })();
  const r = await resolveFileForOpen("/w", "/w/file-map.md", fetchImpl);
  assert.deepEqual(r, { kind: "open", filePath: "/w/docs/desktop/file-map.md" });
});

test("0 命中 → missing", async () => {
  const fetchImpl = () => fetchJson(200, { resolvedPath: null, candidates: [], hit: false })();
  const r = await resolveFileForOpen("/w", "/w/README.ja.md", fetchImpl);
  assert.deepEqual(r, { kind: "missing" });
});

test("多命中 → ambiguous 携带候选", async () => {
  const candidates = ["/w/a/pkg.ts", "/w/b/pkg.ts"];
  const fetchImpl = () => fetchJson(200, { resolvedPath: null, candidates, hit: false })();
  const r = await resolveFileForOpen("/w", "/w/pkg.ts", fetchImpl);
  assert.deepEqual(r, { kind: "ambiguous", candidates });
});

test("403（工作区外）→ denied", async () => {
  const fetchImpl = () => fetchJson(403, { error: "Access denied" })();
  const r = await resolveFileForOpen("/w", "/Users/x/Library/Logs/PowerI/poweri.log", fetchImpl);
  assert.deepEqual(r, { kind: "denied" });
});

test("API 网络异常 → 退回 open 原路径（不阻断）", async () => {
  const fetchImpl = () => { throw new Error("network down"); };
  const r = await resolveFileForOpen("/w", "/w/whatever.md", fetchImpl);
  assert.deepEqual(r, { kind: "open", filePath: "/w/whatever.md" });
});

test("非 200/403 的非预期状态 → 退回 open 原路径", async () => {
  const fetchImpl = () => fetchJson(500, { error: "boom" })();
  const r = await resolveFileForOpen("/w", "/w/whatever.md", fetchImpl);
  assert.deepEqual(r, { kind: "open", filePath: "/w/whatever.md" });
});

test("无 cwd → 跳过解析直接 open", async () => {
  let called = false;
  const fetchImpl = () => { called = true; return fetchJson(200, {})(); };
  const r = await resolveFileForOpen(null, "/w/a.md", fetchImpl);
  assert.deepEqual(r, { kind: "open", filePath: "/w/a.md" });
  assert.equal(called, false);
});
