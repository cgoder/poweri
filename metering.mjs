// PowerI 计量与账单（PoC：JSONL 明细账 + JSON 账单文件；生产换 DB）
// 数据布局：
//   data/metering/<userId>.jsonl            明细账：每请求一行，append-only，可审计
//   data/invoicing/<userId>/<period>.json   账单：period = YYYY-MM（月）或 YYYY-MM-DD（日）
// 幂等：同一 (userId, period) 账单已存在则直接返回（reused:true），不重复计费；
//       并发生成同一账单由 withLock 串行化（先写者生效）。
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { withLock } from "./queue.mjs";
import { computeCost, ITEM_KINDS, loadPrices } from "./pricing.mjs";

// 惰性取数据目录（不缓存 import 期环境，便于测试隔离）
const dataDir = () => process.env.POWERI_DATA_DIR ?? path.join(process.cwd(), "data");
const ledgerFile = (userId) => path.join(dataDir(), "metering", `${userId}.jsonl`);
const invoiceFile = (userId, period) => path.join(dataDir(), "invoicing", userId, `${period}.json`);

export function periodKey(date = new Date(), granularity = "month") {
  const p = (n) => String(n).padStart(2, "0");
  const base = `${date.getFullYear()}-${p(date.getMonth() + 1)}`;
  return granularity === "day" ? `${base}-${p(date.getDate())}` : base;
}

export function appendUsage(userId, record) {
  const file = ledgerFile(userId);
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(record) + "\n"); // 单行追加，POSIX O_APPEND 原子
}

// 返回 { records, corrupt }：corrupt = 无法解析的行数（append 崩溃可能留下半行）。
// 损坏行不静默吞掉：计入账单 corruptLines 字段，可审计、可追查。
export function scanUsage(userId, from, to) {
  const file = ledgerFile(userId);
  if (!existsSync(file)) return { records: [], corrupt: 0 };
  const out = [];
  let corrupt = 0;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { corrupt++; continue; }
    if (from !== undefined && o.ts < from) continue;
    if (to !== undefined && o.ts > to) continue;
    out.push(o);
  }
  return { records: out, corrupt };
}

// 生成/获取账单。返回 { invoice, reused, file }
export async function invoiceFor(userId, period) {
  return withLock(`invoice/${userId}/${period}`, async () => {
    const file = invoiceFile(userId, period);
    if (existsSync(file)) {
      return { invoice: JSON.parse(readFileSync(file, "utf8")), reused: true, file };
    }
    const [y, m, d] = period.split("-").map(Number);
    const from = new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
    const to = d
      ? from + 86_400_000 - 1
      : new Date(y, m, 1).getTime() - 1; // 下月 1 日 - 1ms
    const { records, corrupt } = scanUsage(userId, from, to);
    const prices = loadPrices();
    const qty = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, bandwidth: 0, requests: 0 };
    for (const rec of records) {
      for (const k of ["input", "output", "cacheRead", "cacheWrite", "reasoning"]) qty[k] += Number(rec.usage?.[k]) || 0;
      qty.bandwidth += Number(rec.platform?.bandwidthBytes) || 0;
      qty.requests++;
    }
    const items = ITEM_KINDS.filter((k) => qty[k] > 0).map((k) => ({
      kind: k, quantity: qty[k], unitPrice: prices[k],
      amount: Math.round(qty[k] * prices[k] * 1e6) / 1e6,
    }));
    const total = Math.round(items.reduce((s, i) => s + i.amount, 0) * 1e6) / 1e6;
    const invoice = { userId, period, currency: "USD", generatedAt: Date.now(), items, total, requests: qty.requests, corruptLines: corrupt, records };
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(invoice, null, 2));
    return { invoice, reused: false, file };
  });
}
