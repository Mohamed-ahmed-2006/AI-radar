import { NextResponse } from "next/server";
import {
  type RelativeDateRange,
  getSignificantEcosystemMoves,
} from "@/lib/intelligence";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const range = (searchParams.get("range") as RelativeDateRange) || "30d";
    const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : 10;
    const demo = searchParams.get("demo") === "true";
    const referenceDate = searchParams.get("referenceDate") || undefined;

    const summary = await getSignificantEcosystemMoves(range, limit, {
      demo,
      referenceDate,
    });

    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch significant ecosystem moves";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
