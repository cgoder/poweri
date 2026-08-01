// PowerI 会话级互斥锁（进程内，按 key 串行）。
// 同一 (userId, sessionId) 的请求严格串行（FIFO）；不同 key 互不阻塞（并行）。
// 防止多个 pi 进程并发写同一会话 JSONL 导致损坏。
// ponytail: 进程内锁仅保证单网关实例内串行；多实例部署需分布式锁（Redis）
//           或改为每会话固定单 Pod 路由（Pod 天然串行）。

const chains = new Map(); // key → 队尾 promise（永不 reject）

export function withLock(key, fn) {
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.then(() => fn());
  // 链尾吞掉错误：某次任务失败不能断链；真实结果由 run 传给调用者
  chains.set(key, run.then(() => {}, () => {}));
  return run;
}
