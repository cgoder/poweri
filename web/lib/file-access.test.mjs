import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Loaded through jiti so the module's own extensionless imports resolve the way
// the app resolves them (tsconfig moduleResolution: "bundler"); bare
// `import("./path-security.ts")` only works while that file has no imports.
async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./path-security.ts");
}

test("rejects an existing path that escapes an allowed root through a symlink", async (t) => {
  const { isExistingPathWithinRoots, isPathWithinRoots } = await loadSubject();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-file-access-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const allowed = path.join(base, "allowed");
  const outside = path.join(base, "outside");
  fs.mkdirSync(allowed);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
  const link = path.join(allowed, "link");
  fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  const target = path.join(link, "secret.txt");
  const roots = new Set([allowed]);

  assert.equal(isPathWithinRoots(target, roots), true);
  assert.equal(isExistingPathWithinRoots(target, roots), false);
});

test("wsl$ and wsl.localhost are the same share for containment", async () => {
  const { isPathWithinRoots } = await loadSubject();
  // Windows exposes the WSL filesystem under both names; realpath output and
  // user-typed roots may use either form, and they must compare equal.
  const roots = new Set(["//wsl$/Ubuntu/home/tienchiu/code"]);
  assert.equal(isPathWithinRoots("//wsl$/Ubuntu/home/tienchiu/code", roots), true);
  assert.equal(
    isPathWithinRoots("//wsl.localhost/Ubuntu/home/tienchiu/code", roots),
    true,
    "wsl.localhost target must match a wsl$ root"
  );
  assert.equal(
    isPathWithinRoots("//wsl.localhost/Ubuntu/home/tienchiu/code/src", roots),
    true,
    "subpaths under the alias must match"
  );
  assert.equal(
    isPathWithinRoots("//wsl.localhost/Ubuntu/home/other/code", roots),
    false,
    "paths outside the root stay rejected under the alias"
  );
  // The alias rewrite must not affect a plain directory literally named
  // "wsl.localhost" that is not at UNC-host position.
  assert.equal(
    isPathWithinRoots("/a/wsl.localhost/b", new Set(["/a/wsl.localhost"])),
    true
  );
});

test("isExistingPathWithinRoots falls back to lexical check when realpath fails", async (t) => {
  const { isExistingPathWithinRoots } = await loadSubject();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-realpath-fallback-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const allowed = path.join(base, "allowed");
  fs.mkdirSync(allowed);
  const target = path.join(allowed, "file.txt");
  fs.writeFileSync(target, "x");

  // A root that exists is resolved; a target inside it passes normally.
  assert.equal(isExistingPathWithinRoots(target, new Set([allowed])), true);

  // A path that is lexically inside the root but does not exist on disk
  // (realpath throws ENOENT) must fall back to the lexical check rather
  // than deny outright — the caller already authorized it lexically.
  const missing = path.join(allowed, "nope", "file.txt");
  assert.equal(isExistingPathWithinRoots(missing, new Set([allowed])), true);

  // A path outside the root stays rejected even through the fallback.
  assert.equal(isExistingPathWithinRoots(path.join(base, "outside"), new Set([allowed])), false);
});
