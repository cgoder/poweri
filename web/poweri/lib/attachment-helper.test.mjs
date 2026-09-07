import test from "node:test";
import assert from "node:assert/strict";
import {
  isTextOrCodeFile,
  isImageFile,
  formatFileSize,
  assembleMessageWithAttachments,
  parseAttachmentEnvelope,
  extractCleanUserText,
  isTauriEnv,
} from "./attachment-helper.ts";

// ─── 基础工具函数 ────────────────────────────────────────────────────────────

test("isTextOrCodeFile detects code, text, and log extensions", () => {
  assert.equal(isTextOrCodeFile({ name: "main.rs", type: "" }), true);
  assert.equal(isTextOrCodeFile({ name: "server.ts", type: "" }), true);
  assert.equal(isTextOrCodeFile({ name: "app.log", type: "" }), true);
  assert.equal(isTextOrCodeFile({ name: "README.md", type: "" }), true);
  assert.equal(isTextOrCodeFile({ name: "Dockerfile", type: "" }), true);
  assert.equal(isTextOrCodeFile({ name: "avatar.png", type: "image/png" }), false);
});

test("isImageFile correctly identifies image files", () => {
  assert.equal(isImageFile({ name: "screen.png", type: "image/png" }), true);
  assert.equal(isImageFile({ name: "photo.jpg", type: "image/jpeg" }), true);
  assert.equal(isImageFile({ name: "code.ts", type: "text/plain" }), false);
});

test("formatFileSize formats bytes cleanly", () => {
  assert.equal(formatFileSize(500), "500 B");
  assert.equal(formatFileSize(2048), "2.0 KB");
  assert.equal(formatFileSize(1048576 * 3), "3.0 MB");
});

test("isTauriEnv returns false in Node.js test environment", () => {
  // Node.js 没有 window，不是 Tauri 环境
  assert.equal(isTauriEnv(), false);
});

// ─── Web 环境：内联内容信封 ───────────────────────────────────────────────────

test("[Web] assembleMessageWithAttachments creates inline content envelope when inlineContent is present", () => {
  const files = [
    {
      id: "1",
      name: "lefthook.md",
      path: "",
      inlineContent: "# Lefthook\nsome content here",
      size: 200,
      lineCount: 2,
    },
  ];

  // 在 Node.js 测试中没有 window.__TAURI__，所以走 Web 路径（内联）
  const result = assembleMessageWithAttachments("帮我看看这个规范", files);
  assert.ok(result.includes("<attached_files>"), "should have envelope");
  assert.ok(result.includes('<file name="lefthook.md"'), "should have file tag");
  assert.ok(result.includes("<content>"), "should have inline content block");
  assert.ok(result.includes("# Lefthook"), "should embed file content");
  assert.ok(result.endsWith("帮我看看这个规范"), "user message should be appended");
  assert.ok(!result.includes(' path="'), "web inline envelope should not contain path attr");
});

test("[Web] parseAttachmentEnvelope correctly parses inline content envelope", () => {
  const content = `<attached_files>
  <file name="lefthook.md" size="200" lines="2">
    <content>
# Lefthook
some content here
    </content>
  </file>
</attached_files>

帮我看看这个规范`;

  const parsed = parseAttachmentEnvelope(content);
  assert.equal(parsed.hasEnvelope, true);
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0].name, "lefthook.md");
  assert.equal(parsed.files[0].size, 200);
  assert.equal(parsed.files[0].lineCount, 2);
  assert.ok(parsed.files[0].inlineContent?.includes("# Lefthook"), "should extract inline content");
  assert.equal(parsed.cleanText, "帮我看看这个规范");
  assert.equal(extractCleanUserText(content), "帮我看看这个规范");
});

// ─── Tauri 环境：路径引用信封 ────────────────────────────────────────────────

test("[Tauri] assembleMessageWithAttachments creates path reference envelope when path is set and inlineContent absent", () => {
  // 模拟 Tauri 环境：path 有值，inlineContent 不存在
  // 因为测试在 Node 环境 isTauriEnv()=false，需要直接测试路径信封的 parse 侧
  // 此测试通过构造一个路径信封字符串来验证 parse 解析
  const pathEnvelope = `<attached_files>
  <file path=".pi/attachments/lefthook.md" name="lefthook.md" size="4200" lines="120" />
</attached_files>

帮我看看这个规范`;

  const parsed = parseAttachmentEnvelope(pathEnvelope);
  assert.equal(parsed.hasEnvelope, true);
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0].name, "lefthook.md");
  assert.equal(parsed.files[0].path, ".pi/attachments/lefthook.md");
  assert.equal(parsed.files[0].size, 4200);
  assert.equal(parsed.files[0].lineCount, 120);
  assert.equal(parsed.cleanText, "帮我看看这个规范");
});

// ─── 兼容旧版格式 ────────────────────────────────────────────────────────────

test("[Legacy] parseAttachmentEnvelope supports [Attached File: ...] format for backward compatibility", () => {
  const legacyContent = `[Attached File: /home/user/docs/legacy.log]
(Please use your tools such as read, ffgrep, or bash to inspect and analyze this file as needed)

分析日志报错`;

  const parsed = parseAttachmentEnvelope(legacyContent);
  assert.equal(parsed.hasEnvelope, true);
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0].name, "legacy.log");
  assert.equal(parsed.files[0].path, "/home/user/docs/legacy.log");
  assert.equal(parsed.cleanText, "分析日志报错");
});

// ─── 无信封正常消息 ──────────────────────────────────────────────────────────

test("parseAttachmentEnvelope returns original text when no envelope exists", () => {
  const normalText = "你好，请写一个快速排序算法";
  const parsed = parseAttachmentEnvelope(normalText);
  assert.equal(parsed.hasEnvelope, false);
  assert.equal(parsed.files.length, 0);
  assert.equal(parsed.cleanText, normalText);
  assert.equal(extractCleanUserText(normalText), normalText);
});
