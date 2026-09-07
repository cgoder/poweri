import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import {
  decideAttachmentCwd,
  getAttachmentsDirectory,
  saveTextAttachment,
} from "./attachment-storage.ts";

test("decideAttachmentCwd allows missing cwd (app-private fallback)", () => {
  const decision = decideAttachmentCwd(null, () => false);
  assert.deepEqual(decision, { ok: true, cwd: null });
  const decision2 = decideAttachmentCwd(undefined, () => false);
  assert.deepEqual(decision2, { ok: true, cwd: null });
});

test("decideAttachmentCwd rejects cwd outside allow-list", () => {
  const decision = decideAttachmentCwd("/etc", (candidate) => candidate === "/home/me/proj");
  assert.deepEqual(decision, { ok: false, reason: "cwd-not-allowed" });
});

test("decideAttachmentCwd passes allowed cwd through unchanged", () => {
  const decision = decideAttachmentCwd("/home/me/proj", (candidate) => candidate === "/home/me/proj");
  assert.deepEqual(decision, { ok: true, cwd: "/home/me/proj" });
});

test("saveTextAttachment neutralizes path traversal in name", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-test-traverse-"));
  try {
    const attachmentsDir = getAttachmentsDirectory(tmpDir);
    for (const hostile of ["..", "../evil.txt", "..\\..\\evil.txt", "a/b/c.txt"]) {
      const result = saveTextAttachment({ name: hostile, content: "x", cwd: tmpDir });
      // 文件必须落在 attachments 目录内，不逃逸；名字里不含路径分隔符
      assert.equal(path.dirname(result.savedPath), attachmentsDir, `hostile=${hostile}`);
      assert.ok(!result.savedPath.includes("/evil.txt"), `hostile=${hostile}`);
      assert.ok(fs.existsSync(result.savedPath));
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("getAttachmentsDirectory creates and returns .pi/attachments under cwd", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-test-attachments-"));
  try {
    const dir = getAttachmentsDirectory(tmpDir);
    assert.ok(dir.includes(".pi"), `dir should be inside .pi: ${dir}`);
    assert.ok(dir.includes("attachments"), `dir should contain attachments: ${dir}`);
    assert.ok(fs.existsSync(dir));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("saveTextAttachment writes file to disk and returns relativePath relative to cwd", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-test-save-"));
  try {
    const result = saveTextAttachment({
      name: "example.log",
      content: "line 1\nline 2\nline 3",
      cwd: tmpDir,
    });

    assert.equal(result.name, "example.log");
    assert.ok(fs.existsSync(result.savedPath));
    assert.equal(result.lineCount, 3);
    // relativePath should be relative to cwd (e.g. .pi/attachments/example-1234.log)
    assert.ok(!path.isAbsolute(result.relativePath), `relativePath should be relative, got: ${result.relativePath}`);
    assert.ok(result.relativePath.startsWith(".pi"), `relativePath should start with .pi, got: ${result.relativePath}`);
    // absolute path reconstructed from cwd+relativePath should match savedPath
    const reconstructed = path.join(tmpDir, result.relativePath);
    assert.equal(reconstructed, result.savedPath);
    assert.equal(fs.readFileSync(result.savedPath, "utf-8"), "line 1\nline 2\nline 3");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("saveTextAttachment falls back to absolute savedPath when no cwd given", () => {
  const result = saveTextAttachment({
    name: "global.log",
    content: "hello",
    cwd: null,
  });

  try {
    assert.ok(fs.existsSync(result.savedPath));
    // without cwd, relativePath equals savedPath (absolute)
    assert.equal(result.relativePath, result.savedPath);
  } finally {
    fs.rmSync(result.savedPath, { force: true });
  }
});
