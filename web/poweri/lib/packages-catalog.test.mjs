import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePiDevPackagesHtmlWithTotal,
  findPackageMetadata,
  getPiDevWebUrl,
  isSamePackage,
  normalizePackageSource,
} from "./packages-catalog.ts";

test("isSamePackage strictly differentiates scoped vs unscoped packages", () => {
  // 关键测试：严禁模糊匹配将不同 scope 的同名包误判为同一包
  assert.equal(isSamePackage("pi-subagents", "@tintinweb/pi-subagents"), false);
  assert.equal(isSamePackage("pi-subagents", "@ferris1225/pi-subagents"), false);
  assert.equal(isSamePackage("@narumitw/pi-subagents", "@tintinweb/pi-subagents"), false);

  // 相同包名的各种格式归一化后匹配
  assert.equal(isSamePackage("npm:pi-subagents", "pi-subagents"), true);
  assert.equal(isSamePackage("npm:pi-subagents@1.0.0", "pi-subagents"), true);
  assert.equal(isSamePackage("npm:@tintinweb/pi-subagents@0.19.0", "@tintinweb/pi-subagents"), true);
  assert.equal(isSamePackage("git:github.com/user/repo", "https://github.com/user/repo.git"), true);
});

test("normalizePackageSource cleans npm prefix, git prefix, and versions cleanly", () => {
  assert.equal(normalizePackageSource("npm:pi-mcp-adapter@1.0.0"), "pi-mcp-adapter");
  assert.equal(normalizePackageSource("npm:@scoped/pkg@2.0.0"), "@scoped/pkg");
  assert.equal(normalizePackageSource("$ pi install npm:pi-web-access"), "pi-web-access");
});

test("getPiDevWebUrl correctly converts npm and bare package specs", () => {
  assert.equal(getPiDevWebUrl("npm:pi-subagents"), "https://pi.dev/packages/pi-subagents");
  assert.equal(getPiDevWebUrl("@companion-ai/feynman"), "https://pi.dev/packages/@companion-ai/feynman");
});

test("parsePiDevPackagesHtmlWithTotal parses real-world HTML card elements and total count", () => {
  const sampleHtml = `
    <div class="packages-count">1-50 / 5,453</div>
    <article class="surface-panel content-card" data-package-card="true" data-package-name="pi-mcp-adapter" data-package-types="extension" data-package-downloads="761400">
      <div class="packages-card-body">
        <h3 class="packages-name"><a href="/packages/pi-mcp-adapter">pi-mcp-adapter</a></h3>
        <p class="packages-desc">MCP adapter extension for Pi coding agent</p>
        <div class="packages-meta">
          <span>nicopreme</span>
          <span>761.4K/mo</span>
          <span>3d ago</span>
        </div>
      </div>
    </article>
  `;

  const { items, total } = parsePiDevPackagesHtmlWithTotal(sampleHtml);
  assert.equal(total, 5453);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "pi-mcp-adapter");
  assert.equal(items[0].category, "extension");
  assert.equal(items[0].author, "nicopreme");
  assert.equal(items[0].downloads, "761.4K/mo");
  assert.equal(items[0].description, "MCP adapter extension for Pi coding agent");
  assert.equal(items[0].webUrl, "https://pi.dev/packages/pi-mcp-adapter");
});

test("findPackageMetadata derives structured fallback metadata on cold start without cache", () => {
  const scopedMeta = findPackageMetadata("npm:@tintinweb/pi-subagents@0.19.0");
  assert.ok(scopedMeta);
  assert.equal(scopedMeta.name, "@tintinweb/pi-subagents");
  assert.equal(scopedMeta.author, "tintinweb");
  assert.equal(scopedMeta.webUrl, "https://pi.dev/packages/@tintinweb/pi-subagents");

  const bareMeta = findPackageMetadata("pi-mcp-adapter");
  assert.ok(bareMeta);
  assert.equal(bareMeta.name, "pi-mcp-adapter");
  assert.equal(bareMeta.author, undefined);
  assert.equal(bareMeta.webUrl, "https://pi.dev/packages/pi-mcp-adapter");
});
