// validate-customizations 核心逻辑单测（注入 fake runGit，不依赖真实仓库状态）
// 约定：squash commit 树 = 上游树副本（无 web/ 前缀）；HEAD 树中模块路径带前缀。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLsTree,
  treeDiff,
  findSubtreeMeta,
  checkStructure,
  checkManifest,
  validateManifestSchema,
  dryRunConflicts,
} from "../validate-customizations.mjs";

// ── 树数据构造：ls-tree 行 "<mode> <type> <sha>\t<path>" ──
const UPSTREAM_TREE = [
  "100644 blob aaaa\tlib/rpc-manager.ts", // 上游文件（将被本地改动 → 侵入）
  "100644 blob aaaa\tlib/session-reader.ts", // 未改动 → 相同
  "100644 blob bbbb\tpackage.json", // 将被本地改动 → 侵入
  "100644 blob cccc\tapp/api/models/route.ts", // 将被删除 → 侵入（D）
  "100644 blob dddd\tlib/upstream-only.ts", // 上游独有（本地删除，未登记）→ 违规样本
].join("\n");
const LOCAL_TREE = [
  "100644 blob eeee\tweb/lib/rpc-manager.ts", // 改动
  "100644 blob aaaa\tweb/lib/session-reader.ts", // 相同
  "100644 blob ffff\tweb/package.json", // 改动
  // web/app/api/models/route.ts 已删
  "100644 blob gggg\tweb/lib/gateway-client.ts", // 独立新增
  "100644 blob hhhh\tweb/lib/gateway-client.test.mjs", // 独立新增
].join("\n");

function fakeRunGit(results) {
  return (args) => {
    const key = args.join(" ");
    if (!(key in results)) throw new Error(`fakeRunGit: unhandled args: ${key}`);
    const v = results[key];
    return typeof v === "function" ? v() : v;
  };
}

test("parseLsTree 解析 ls-tree 输出为 path→sha Map", () => {
  const m = parseLsTree(UPSTREAM_TREE);
  assert.equal(m.size, 5);
  assert.equal(m.get("lib/rpc-manager.ts"), "aaaa");
  assert.equal(m.get("app/api/models/route.ts"), "cccc");
});

test("treeDiff 区分侵入（改/删）与独立新增", () => {
  const runGit = fakeRunGit({
    "ls-tree -r 0a69b31": UPSTREAM_TREE,
    "ls-tree -r HEAD -- web/": LOCAL_TREE,
  });
  const { intrusions, independent } = treeDiff(runGit, "0a69b31", "web");
  assert.deepEqual(intrusions.sort(), [
    "app/api/models/route.ts", // 本地删除
    "lib/rpc-manager.ts", // 本地改动
    "lib/upstream-only.ts", // 本地删除（未登记）
    "package.json", // 本地改动
  ].sort());
  assert.deepEqual(independent.sort(), [
    "lib/gateway-client.test.mjs",
    "lib/gateway-client.ts",
  ].sort());
});

test("treeDiff 独立文件排除：上游存在的同路径文件不算独立", () => {
  const runGit = fakeRunGit({
    "ls-tree -r 0a69b31": "100644 blob aaaa\tlib/gateway-client.ts\n",
    "ls-tree -r HEAD -- web/": "100644 blob gggg\tweb/lib/gateway-client.ts\n",
  });
  const { intrusions, independent } = treeDiff(runGit, "0a69b31", "web");
  assert.deepEqual(intrusions, ["lib/gateway-client.ts"]);
  assert.deepEqual(independent, []);
});

test("findSubtreeMeta 从 commit 消息解析 dir/split，缺失时抛错", () => {
  const runGit = fakeRunGit({
    "log --grep=git-subtree-dir: web --format=%B -1":
      "Squashed 'web/' content from commit 0877bff\n\ngit-subtree-dir: web\ngit-subtree-split: 0877bffc0c6d75a55802e77125183e3df26e44a7\n",
  });
  const meta = findSubtreeMeta(runGit, "web");
  assert.equal(meta.dir, "web");
  assert.equal(meta.split, "0877bffc0c6d75a55802e77125183e3df26e44a7");
});

test("checkStructure：模块目录缺失 / squash 缺失 / split 树不一致均检出", () => {
  const meta = { dir: "web", split: "0877bff" };
  const cases = [
    {
      name: "全通过",
      runGit: fakeRunGit({
        "ls-tree -r HEAD -- web/": LOCAL_TREE,
        "cat-file -e 0877bff": "",
        "rev-parse 0877bff^{tree}": "splittree\n",
        "rev-parse 0a69b31^{tree}": "splittree\n",
      }),
      expect: [],
    },
    {
      name: "模块目录缺失",
      runGit: fakeRunGit({ "ls-tree -r HEAD -- web/": "" }),
      expect: ["模块目录 web/ 不存在（subtree 未引入或已被移除）"],
    },
    {
      name: "split 对象缺失",
      runGit: fakeRunGit({
        "ls-tree -r HEAD -- web/": LOCAL_TREE,
        "cat-file -e 0877bff": throwErr("fatal: Not a valid object name 0877bff"),
      }),
      expect: ["split 对象 0877bff 不在本地对象库（结构信息仍可读，dry-run 需先 fetch 上游）"],
    },
    {
      name: "squash 树与 split 树不一致",
      runGit: fakeRunGit({
        "ls-tree -r HEAD -- web/": LOCAL_TREE,
        "cat-file -e 0877bff": "",
        "rev-parse 0877bff^{tree}": "treeA\n",
        "rev-parse 0a69b31^{tree}": "treeB\n",
      }),
      expect: ["squash commit 树与上游 split 树不一致（0a69b31 vs 0877bff）——subtree 元数据损坏"],
    },
  ];
  for (const c of cases) {
    const issues = checkStructure(c.runGit, "web", "0a69b31", meta);
    assert.deepEqual(issues, c.expect, c.name);
  }
});

test("checkManifest：未登记侵入检出 + 清单过期条目检出 + 独立文件遗漏提示", () => {
  const manifest = {
    independent: ["lib/gateway-client.ts", "lib/gateway-client.test.mjs"],
    intrusions: [
      { file: "lib/rpc-manager.ts", reason: "x", risk: "high" },
      { file: "package.json", reason: "y", risk: "low" },
    ],
  };
  const runGit = fakeRunGit({
    "ls-tree -r 0a69b31": UPSTREAM_TREE,
    "ls-tree -r HEAD -- web/": LOCAL_TREE,
  });
  const { intrusions, independent } = treeDiff(runGit, "0a69b31", "web");
  const issues = checkManifest(manifest, intrusions, independent);
  // 未登记：app/api/models/route.ts（删）、lib/upstream-only.ts（删）
  // 过期：无（manifest 两条都在侵入集）→ 期望只有 2 条未登记 + 0 过期
  assert.equal(issues.filter((i) => i.type === "unregistered").length, 2);
  assert.equal(issues.filter((i) => i.type === "stale").length, 0);
});

test("checkManifest：过期条目（清单文件当前与上游一致）检出", () => {
  const manifest = {
    independent: [],
    intrusions: [
      { file: "lib/rpc-manager.ts", reason: "曾经改过", risk: "high" },
      { file: "lib/never-touched.ts", reason: "从未改动", risk: "low" },
    ],
  };
  const runGit = fakeRunGit({
    "ls-tree -r 0a69b31": UPSTREAM_TREE,
    "ls-tree -r HEAD -- web/": LOCAL_TREE,
  });
  const { intrusions } = treeDiff(runGit, "0a69b31", "web");
  const issues = checkManifest(manifest, intrusions, []);
  const stale = issues.filter((i) => i.type === "stale");
  assert.equal(stale.length, 1);
  assert.match(stale[0].message, /never-touched/);
  assert.doesNotMatch(stale[0].message, /lib\/rpc-manager\.ts/); // 同文件在侵入集，非过期
});

test("validateManifestSchema：缺 reason / 非法 risk / 形状错误均检出", () => {
  const bad = [
    { file: "lib/ok.ts", reason: "好", risk: "high" },
    { file: "lib/no-reason.ts", risk: "low" },
    { file: "lib/bad-risk.ts", reason: "x", risk: "critical" },
    { file: 42, reason: "y", risk: "low" },
  ];
  const issues = validateManifestSchema({ intrusions: bad, independent: "not-array" });
  assert.equal(issues.length, 4);
  assert.ok(issues.every((i) => i.type === "manifest-invalid" && i.level === "error"));
  assert.match(issues[0].message, /no-reason/); // 条目 0 合法 → issues 从条目 1 开始
  assert.match(issues[1].message, /critical/);
});

test("validateManifestSchema：合法清单零问题 + intrusions 缺失报错", () => {
  assert.deepEqual(validateManifestSchema({ intrusions: [], independent: [] }), []);
  const missing = validateManifestSchema({});
  assert.equal(missing.length, 1);
  assert.match(missing[0].message, /intrusions/);
});

function throwErr(msg) {
  return () => {
    throw new Error(msg);
  };
}

test("dryRunConflicts：预期冲突 = 上游改动集 ∩ 侵入集；上游删除侵入文件单列", () => {
  const manifest = {
    independent: ["lib/gateway-client.ts"],
    intrusions: [
      { file: "lib/rpc-manager.ts", reason: "", risk: "high" },
      { file: "package.json", reason: "", risk: "low" },
      { file: "app/api/models/route.ts", reason: "", risk: "low" },
    ],
  };
  const SPLIT_TREE = [
    "100644 blob aaaa\tlib/rpc-manager.ts",
    "100644 blob bbbb\tpackage.json",
    "100644 blob cccc\tapp/api/models/route.ts",
    "100644 blob dddd\tlib/session-reader.ts",
    "100644 blob eeee\tlib/gateway-client.ts", // 上游有同路径（独立集不该有它，但测试 dry-run 逻辑独立）
  ].join("\n");
  const NEW_TREE = [
    "100644 blob zzzz\tlib/rpc-manager.ts", // 上游改动 → 冲突（侵入）
    "100644 blob bbbb\tpackage.json", // 上游未动（blob 同 split）→ 无冲突
    // app/api/models/route.ts 上游删除（本地侵入过）→ deletedUpstream
    "100644 blob ffff\tlib/session-reader.ts", // 上游改动，未侵入 → 无冲突
    "100644 blob gggg\tlib/new-upstream.ts", // 上游新增 → 无冲突
  ].join("\n");
  const runGit = fakeRunGit({
    "ls-tree -r 0877bff": SPLIT_TREE,
    "ls-tree -r newref": NEW_TREE,
  });
  const { conflicts, deletedUpstream } = dryRunConflicts(runGit, manifest, "0877bff", "newref");
  assert.deepEqual(conflicts, ["lib/rpc-manager.ts"]);
  assert.deepEqual(deletedUpstream, ["app/api/models/route.ts"]);
});

test("dryRunConflicts：上游新增文件落在独立集 → add/add 碰撞提示", () => {
  const manifest = {
    independent: ["lib/gateway-client.ts"],
    intrusions: [],
  };
  const SPLIT_TREE = "100644 blob aaaa\tlib/session-reader.ts\n";
  const NEW_TREE = [
    "100644 blob aaaa\tlib/session-reader.ts",
    "100644 blob gggg\tlib/gateway-client.ts", // 上游新增同名文件（我方独立文件）→ 需注意但非冲突
  ].join("\n");
  const runGit = fakeRunGit({
    "ls-tree -r 0877bff": SPLIT_TREE,
    "ls-tree -r newref": NEW_TREE,
  });
  const { conflicts, independentCollisions } = dryRunConflicts(runGit, manifest, "0877bff", "newref");
  assert.deepEqual(conflicts, []);
  assert.deepEqual(independentCollisions, ["lib/gateway-client.ts"]);
});
