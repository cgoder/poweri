// 会话级互斥锁单元测试：node --test gateway/test/
// 验证：同 key 串行(FIFO) / 不同 key 并行 / 任务失败不断链
import { test } from "node:test";
import assert from "node:assert/strict";
import { withLock } from "../queue.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("同一 key 严格串行：最大并发=1 且 FIFO 顺序", async () => {
  let active = 0, maxActive = 0;
  const order = [];
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => withLock("sess-k", async () => {
      active++; maxActive = Math.max(maxActive, active);
      order.push(i);
      await sleep(20);
      active--;
      return i;
    })),
  );
  assert.equal(maxActive, 1, `同 key 应串行，实际最大并发 ${maxActive}`);
  assert.deepEqual(order, [...Array(10).keys()], "执行顺序应 FIFO");
  assert.deepEqual(results, [...Array(10).keys()], "每个任务都应完成并返回结果");
});

test("不同 key 可并行：最大并发 > 1", async () => {
  let active = 0, maxActive = 0;
  await Promise.all(
    Array.from({ length: 10 }, (_, i) => withLock(`sess-${i}`, async () => {
      active++; maxActive = Math.max(maxActive, active);
      await sleep(20);
      active--;
    })),
  );
  assert.ok(maxActive > 1, `不同 key 应并行，实际最大并发 ${maxActive}`);
});

test("任务抛错不断链：后续同 key 任务仍执行", async () => {
  const out = [];
  await withLock("sess-k", async () => { throw new Error("boom"); }).catch(() => {});
  out.push(await withLock("sess-k", async () => "after"));
  assert.deepEqual(out, ["after"], "前序失败后链不应断");
});

test("同 key 前序失败时后续结果正确隔离", async () => {
  const r1 = await withLock("sess-k", async () => { throw new Error("bad"); }).catch((e) => e.message);
  const r2 = await withLock("sess-k", async () => 42);
  assert.equal(r1, "bad");
  assert.equal(r2, 42);
});
