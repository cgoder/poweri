import { NextResponse } from "next/server";
import { searchPiPackages } from "@/poweri/lib/packages-catalog";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") || "";
    const category = searchParams.get("category") || "all";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const sort = (searchParams.get("sort") || "downloads") as "downloads" | "recent" | "name";

    const result = await searchPiPackages({ query, category, page, sort });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to search packages" },
      { status: 500 }
    );
  }
}
