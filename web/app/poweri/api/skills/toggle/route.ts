import { NextResponse } from "next/server";
import { toggleSkillState } from "@/poweri/lib/skill-subscriptions";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

// POST /poweri/api/skills/toggle
// body: { skillId: string, enabled: boolean, cwd?: string }
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  try {
    const body = (await req.json()) as {
      skillId: string;
      enabled: boolean;
      cwd?: string;
    };

    const { skillId, enabled } = body;
    const cwd = body.cwd || process.cwd();

    if (!skillId) {
      return NextResponse.json({ error: "skillId is required" }, { status: 400 });
    }

    const result = await toggleSkillState({ skillId, enabled, cwd });
    if (!result.success) {
      return NextResponse.json({ error: result.error || "Toggle failed" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
