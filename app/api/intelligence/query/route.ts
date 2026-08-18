import { NextResponse } from "next/server";
import { answerHeroQuestion } from "@/lib/intelligence";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const question = searchParams.get("q") || searchParams.get("query") || "What changed in Claude this month?";
    const demo = searchParams.get("demo") !== "false"; // Default to demo-enabled for natural queries in demo mode
    const referenceDate = searchParams.get("referenceDate") || undefined;

    const bundle = await answerHeroQuestion(question, {
      demo,
      referenceDate,
      includeSummary: true,
    });

    return NextResponse.json({
      question,
      bundle,
      summary: bundle.narrativeSummary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to answer hero query";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
