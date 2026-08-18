import { NextResponse } from "next/server";
import {
  type RelativeDateRange,
  compareProvidersIntelligence,
} from "@/lib/intelligence";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const providersParam = searchParams.get("providers");
    const providers = providersParam
      ? providersParam.split(",").map((s) => s.trim())
      : undefined;

    const range = (searchParams.get("range") as RelativeDateRange) || "30d";
    const demo = searchParams.get("demo") === "true";
    const referenceDate = searchParams.get("referenceDate") || undefined;

    const comparison = await compareProvidersIntelligence(providers, range, {
      demo,
      referenceDate,
    });

    return NextResponse.json(comparison);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to compare providers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
