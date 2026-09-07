import { createJiti } from "jiti";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const jiti = createJiti(import.meta.url);
const { expandTildeFakePath } = await jiti.import("./workspace-file-search.ts");

test("expandTildeFakePath: <cwd>/~ 假路径展开为 homedir 真实路径", () => {
  // 构造: /tmp/xxx/repo/~/.poweri/settings.json 形态"/.poweri/settings.json".replace(/^./, "")}`;
  // 构造: /tmp/xxx/~/.poweri/settings.json 形态
  const tildeFake = path.join(os.tmpdir(), "repo", "~", ".poweri", "settings.json");
  const expanded = expandTildeFakePath(tildeFake);
  assert.ok(expanded === null || expanded.startsWith(os.homedir()));
  // settings.json 在 homedir 下真实存在
  const real = path.join(os.homedir(), ".poweri", "settings.json");
  if (fs.existsSync(real)) {
    assert.equal(expandTildeFakePath(path.join(os.tmpdir(), "repo", "~", ".poweri", "settings.json")), real);
  }
});

test("expandTildeFakePath: ~/ 直接前缀", () => {
  const expanded = expandTildeFakePath("~/.poweri/settings.json");
  if (fs.existsSync(path.join(os.homedir(), ".poweri", "settings.json"))) {
    assert.equal(expanded, path.join(os.homedir(), ".poweri", "settings.json"));
  } else {
    assert.equal(expanded, null);
  }
});

test("expandTildeFakePath: 无 ~ 段返回 null", () => {
  assert.equal(expandTildeFakePath("/Users/me/repo/installer.rs"), null);
  assert.equal(expandTildeFakePath("/tmp/x/y/z.json"), null);
});

test("expandTildeFakePath: 展开后文件不存在返回 null", () => {
  assert.equal(expandTildeFakePath(path.join(os.tmpdir(), "repo", "~", "no-such-file.json")), null);
  assert.equal(expandTildeFakePath("~/no-such-dir-xyz/no-such-file.json"), null);
});
