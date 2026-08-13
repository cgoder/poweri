// PowerI 定价规则：用量 → 金额（纯函数，可单测）
// 上游 AI 网关不返回单价（cost 恒 0），平台按价目自行计费（ADR-0006）。
// 默认价目（input/cacheWrite/reasoning $0.25/M tokens，output $1/M，cacheRead $0.05/M，
// bandwidth $0.09/GB 出站）；POWERI_PRICES_FILE 指向 JSON 可覆盖部分项（与默认合并）。
import { existsSync, readFileSync } from "node:fs";

const PER_M = 1_000_000;

export const DEFAULT_PRICES = {
  input: 0.25 / PER_M,
  output: 1.0 / PER_M,
  cacheRead: 0.05 / PER_M,
  cacheWrite: 0.25 / PER_M,
  reasoning: 0.25 / PER_M,
  bandwidth: 0.09 / (1024 ** 3), // $0.09/GB
};

export const ITEM_KINDS = ["input", "output", "cacheRead", "cacheWrite", "reasoning", "bandwidth"];

export function loadPrices() {
  const p = { ...DEFAULT_PRICES };
  const f = process.env.POWERI_PRICES_FILE;
  if (f && existsSync(f)) Object.assign(p, JSON.parse(readFileSync(f, "utf8")));
  return p;
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;

// usage: {input,output,cacheRead,cacheWrite,reasoning}（token 数）
// platform: {bandwidthBytes}
export function computeCost(usage, platform, prices) {
  const u = usage ?? {};
  const pl = platform ?? {};
  const t = (k) => Number(u[k]) || 0;
  return round6(
    t("input") * prices.input + t("output") * prices.output
    + t("cacheRead") * prices.cacheRead + t("cacheWrite") * prices.cacheWrite
    + t("reasoning") * prices.reasoning
    + (Number(pl.bandwidthBytes) || 0) * prices.bandwidth,
  );
}
