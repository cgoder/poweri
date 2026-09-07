import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./file-path-detection.ts");
}

test("looksLikeFilePath: accepts relative paths with extensions", async () => {
  const { looksLikeFilePath } = await loadSubject();

  assert.equal(looksLikeFilePath("docs/desktop/ownership.md"), true);
  assert.equal(looksLikeFilePath("components/AppShell.tsx"), true);
  assert.equal(looksLikeFilePath("lib/file-links.ts"), true);
  assert.equal(looksLikeFilePath("shell/main.ts"), true);
  assert.equal(looksLikeFilePath("./file.ts"), true);
  assert.equal(looksLikeFilePath("../parent/file.js"), true);
});

test("looksLikeFilePath: accepts simple filenames with extensions", async () => {
  const { looksLikeFilePath } = await loadSubject();

  assert.equal(looksLikeFilePath("package.json"), true);
  assert.equal(looksLikeFilePath("README.md"), true);
  assert.equal(looksLikeFilePath("file.test.ts"), true);
});

test("looksLikeFilePath: rejects version numbers and IPs", async () => {
  const { looksLikeFilePath } = await loadSubject();

  assert.equal(looksLikeFilePath("v0.2"), false);
  assert.equal(looksLikeFilePath("1.0.0"), false);
  assert.equal(looksLikeFilePath("127.0.0.1"), false);
  assert.equal(looksLikeFilePath("0.84.2"), false);
});

test("looksLikeFilePath: rejects CLI flags and commands", async () => {
  const { looksLikeFilePath } = await loadSubject();

  assert.equal(looksLikeFilePath("--version"), false);
  assert.equal(looksLikeFilePath("--no-open"), false);
  assert.equal(looksLikeFilePath("npm run build"), false);
  assert.equal(looksLikeFilePath("node --version"), false);
});

test("looksLikeFilePath: rejects URLs and protocols", async () => {
  const { looksLikeFilePath } = await loadSubject();

  assert.equal(looksLikeFilePath("http://example.com"), false);
  assert.equal(looksLikeFilePath("https://github.com"), false);
  assert.equal(looksLikeFilePath("file:///path/to/file"), false);
});
