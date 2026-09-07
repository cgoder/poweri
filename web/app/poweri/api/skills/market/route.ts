import { NextResponse } from "next/server";
import {
  getMarketSkills,
  readSubscriptions,
  writeSubscriptions,
  updateSubscription,
  removeSubscription,
  generateSubscriptionId,
  detectSubscriptionType,
  toPublicSubscription,
  type SkillCategory,
  type SkillSubscription,
} from "@/poweri/lib/skill-subscriptions";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

// GET /poweri/api/skills/market?cwd=<path>&category=all|business|public&q=<query>&discover=1&force=1
// discover=1 时才拉取 skills.sh 市场数据（前端懒加载：默认只返回已安装/订阅源技能）
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd") || process.cwd();
  const category = (searchParams.get("category") || "all") as SkillCategory | "all";
  const query = searchParams.get("q") || undefined;
  const force = searchParams.get("force") === "1";
  const discover = searchParams.get("discover") === "1";

  try {
    const data = await getMarketSkills(cwd, category, query, { forceSync: force, discover });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// POST /poweri/api/skills/market
// body: { action: "add" | "update" | "remove", url?: string, id?: string, name?: string, category?: SkillCategory, token?: string }
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  try {
    const body = (await req.json()) as {
      action: "add" | "update" | "remove";
      url?: string;
      id?: string;
      name?: string;
      category?: SkillCategory;
      token?: string;
    };

    const subs = readSubscriptions();

    if (body.action === "add") {
      const url = body.url?.trim();
      if (!url) {
        return NextResponse.json({ error: "url is required" }, { status: 400 });
      }

      const id = generateSubscriptionId(url);
      const existing = subs.find((s) => s.url === url || s.id === id);
      if (existing) {
        if (body.token) existing.token = body.token;
        if (body.category) existing.category = body.category;
        if (body.name) existing.name = body.name;
        writeSubscriptions(subs);
        return NextResponse.json({ success: true, subscription: toPublicSubscription(existing) });
      }

      // url 类型无同步分支（静默死源）：新建时直接拒绝，客户端入口也已同步拦截
      if (detectSubscriptionType(url) === "url") {
        return NextResponse.json(
          { error: "unsupported source type: only git repositories (.git / github / gitlab) or JSON manifests are supported" },
          { status: 400 },
        );
      }

      const category: SkillCategory = body.category
        || (url.includes("gitlab.") || url.toLowerCase().includes("business") ? "business" : "public");

      const newSub: SkillSubscription = {
        id,
        url,
        name: body.name || undefined,
        category,
        type: detectSubscriptionType(url),
        token: body.token || undefined,
        addedAt: Date.now(),
      };

      subs.push(newSub);
      writeSubscriptions(subs);
      return NextResponse.json({ success: true, subscription: toPublicSubscription(newSub) });
    }

    if (body.action === "update") {
      const id = body.id;
      if (!id) {
        return NextResponse.json({ error: "id is required" }, { status: 400 });
      }
      if (body.url !== undefined && !body.url.trim()) {
        return NextResponse.json({ error: "url cannot be empty" }, { status: 400 });
      }
      // 只覆盖显式传入的字段；token 空串 = 不修改（前端脱敏语义）；id 保持不变
      const updates: Partial<SkillSubscription> = {};
      if (body.url !== undefined) updates.url = body.url.trim();
      if (body.name !== undefined) updates.name = body.name || undefined;
      if (body.category) updates.category = body.category;
      if (body.token) updates.token = body.token;
      // url 型是静默死源：编辑时禁止把源改成 url 型；URL 未变的维护（改名/换 token）放行，
      // 不阻断既有 url 型源的存量维护
      if (body.url !== undefined) {
        const nextUrl = body.url.trim();
        const existing = readSubscriptions().find((s) => s.id === id);
        if (existing && existing.url !== nextUrl && detectSubscriptionType(nextUrl) === "url") {
          return NextResponse.json(
            { error: "unsupported source type: only git repositories (.git / github / gitlab) or JSON manifests are supported" },
            { status: 400 },
          );
        }
      }
      const sub = updateSubscription(id, updates);
      if (!sub) {
        return NextResponse.json({ error: "subscription not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, subscription: toPublicSubscription(sub) });
    }

    if (body.action === "remove") {
      const id = body.id || (body.url ? generateSubscriptionId(body.url) : null);
      if (!id) {
        return NextResponse.json({ error: "id or url is required" }, { status: 400 });
      }

      // 走 removeSubscription 删 id 精确命中的条目并清理缓存目录，避免孤儿目录（票07 承诺）。
      // 客户端只传 url 时重构出的 id（含时间戳）命不中既有条目，由下方 url 级联兜底
      //（重新添加同源会生成新 id，同源多代条目需一并移除——保持原有语义）。
      removeSubscription(id);
      if (body.url) {
        const subs = readSubscriptions();
        const remaining = subs.filter((s) => s.url !== body.url);
        if (remaining.length !== subs.length) writeSubscriptions(remaining);
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
