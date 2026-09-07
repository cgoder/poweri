import { createJiti } from "jiti";
import test from "node:test";
import assert from "node:assert/strict";

const jiti = createJiti(import.meta.url);
const { escapeUnbalancedHtml } = await jiti.import("./html-balance.ts");

test("escapeUnbalancedHtml: 未闭合 <a> 转义为 inline code", () => {
  const md = "refactored DownloadLink from <a href download> to <button onClick downloadFile> via lib";
  const out = escapeUnbalancedHtml(md);
  assert.ok(out.includes("`<a href download>`"), out);
  assert.ok(out.includes("`<button onClick downloadFile>`"), out);
  assert.ok(!out.includes("from <a href"), out);
});

test("escapeUnbalancedHtml: 成对标签不动", () => {
  const md = '使用 <a href="https://x.com">链接</a> 和 <em>强调</em>';
  assert.equal(escapeUnbalancedHtml(md), md);
});

test("escapeUnbalancedHtml: void 标签不动", () => {
  const md = "换行 <br> 图片 <img src=\"a.png\">";
  assert.equal(escapeUnbalancedHtml(md), md);
});

test("escapeUnbalancedHtml: 自闭合标签不动", () => {
  const md = "<input type=\"text\" /> 与 <hr/>";
  assert.equal(escapeUnbalancedHtml(md), md);
});

test("escapeUnbalancedHtml: 代码围栏内不处理", () => {
  const md = "```html\n<a href download>\n```\n外部 <a> 未闭合";
  const out = escapeUnbalancedHtml(md);
  assert.ok(out.includes("```html\n<a href download>\n```"), out);
  assert.ok(out.includes("`<a>`"), out);
});

test("escapeUnbalancedHtml: 无标签原样返回", () => {
  const md = "普通文本 package.json 与 src-tauri/installer.rs";
  assert.equal(escapeUnbalancedHtml(md), md);
});

test("escapeUnbalancedHtml: 跨标签闭合容错", () => {
  // <a> 未闭合但 <b> 闭合：<b> 的配对弹栈不应影响 <a> 判定
  const md = "<a> text <b>bold</b> tail";
  const out = escapeUnbalancedHtml(md);
  assert.ok(out.includes("`<a>`"), out);
  assert.ok(out.includes("<b>bold</b>"), out);
});

test("escapeUnbalancedHtml: 嵌套标签正常配对", () => {
  const md = "<div><span>inner</span></div> ok <p>para</p>";
  assert.equal(escapeUnbalancedHtml(md), md);
});
