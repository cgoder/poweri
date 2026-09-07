import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

async function loadSubject() {
  return jiti.import("./file-path-linking.ts");
}

test("linkifyInlineFilePaths: 纯 basename 在 writtenFiles 唯一匹配时解析为完整路径", async () => {
  const { linkifyInlineFilePaths } = await loadSubject();
  const writtenFiles = [
    { filePath: "/repo/src-tauri/src/installer.rs" },
    { filePath: "/repo/package.json" },
  ];
  const out = linkifyInlineFilePaths(
    "代码已全部切到（`installer.rs` 与 `package.json` 均无残留）",
    { writtenFiles },
  );
  assert.equal(
    out,
    "代码已全部切到（[`installer.rs`](/repo/src-tauri/src/installer.rs) 与 [`package.json`](/repo/package.json) 均无残留）",
  );
});

test("linkifyInlineFilePaths: basename 多匹配时不消歧，回退相对 cwd 原样链接", async () => {
  const { linkifyInlineFilePaths } = await loadSubject();
  const writtenFiles = [
    { filePath: "/repo/README.md" },
    { filePath: "/repo/docs/README.md" },
  ];
  const out = linkifyInlineFilePaths("看 `README.md`", { writtenFiles });
  assert.equal(out, "看 [`README.md`](README.md)");
});

test("linkifyInlineFilePaths: basename 不在 writtenFiles 时保持原样链接", async () => {
  const { linkifyInlineFilePaths } = await loadSubject();
  const out = linkifyInlineFilePaths("看 `vite.config.ts`", { writtenFiles: [{ filePath: "/repo/package.json" }] });
  assert.equal(out, "看 [`vite.config.ts`](vite.config.ts)");
});

test("linkifyInlineFilePaths: 含路径的引用不受 writtenFiles 影响", async () => {
  const { linkifyInlineFilePaths } = await loadSubject();
  const writtenFiles = [{ filePath: "/repo/src-tauri/src/installer.rs" }];
  const out = linkifyInlineFilePaths("改 `src-tauri/src/installer.rs`", { writtenFiles });
  assert.equal(out, "改 [`src-tauri/src/installer.rs`](src-tauri/src/installer.rs)");
});

test("linkifyInlineFilePaths: 无 writtenFiles 时保持现有行为", async () => {
  const { linkifyInlineFilePaths } = await loadSubject();
  assert.equal(linkifyInlineFilePaths("改 `package.json`"), "改 [`package.json`](package.json)");
  assert.equal(linkifyInlineFilePaths("改 `package.json`", {}), "改 [`package.json`](package.json)");
});

test("linkifyInlineFilePaths: 完整路径中的空格/中文/# 正确编码", async () => {
  const { linkifyInlineFilePaths } = await loadSubject();
  const writtenFiles = [{ filePath: "/Users/张三/projects/my app/src/a#b.ts" }];
  const out = linkifyInlineFilePaths("改 `a#b.ts`", { writtenFiles });
  assert.equal(
    out,
    "改 [`a#b.ts`](/Users/%E5%BC%A0%E4%B8%89/projects/my%20app/src/a%23b.ts)",
  );
});

test("linkifyInlineFilePaths: 非路径 inline code 不转链接", async () => {
  const { linkifyInlineFilePaths } = await loadSubject();
  const out = linkifyInlineFilePaths("运行 `npm run build` 与 `1.0.0`", {
    writtenFiles: [{ filePath: "/repo/package.json" }],
  });
  assert.equal(out, "运行 `npm run build` 与 `1.0.0`");
});

test("linkifyInlineFilePaths: 代码块内容不受影响", async () => {
  const { linkifyInlineFilePaths } = await loadSubject();
  const markdown = "正文 `installer.rs`\n\n```\ninstaller.rs\n```";
  const writtenFiles = [{ filePath: "/repo/src-tauri/src/installer.rs" }];
  const out = linkifyInlineFilePaths(markdown, { writtenFiles });
  assert.equal(
    out,
    "正文 [`installer.rs`](/repo/src-tauri/src/installer.rs)\n\n```\ninstaller.rs\n```",
  );
});
