import { NextResponse } from "next/server";
import { answerHeroQuestion } from "@/lib/intelligence";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const question = searchParams.get("q") || searchParams.get("query") || "What changed in Claude this month?";
    // Opt-in, never opt-out. This route previously defaulted to the demo
    // corpus, so a public deployment answered ecosystem questions with
    // fabricated evidence unless the caller passed `demo=false`. The default is
    // live evidence; `demo=true` is honoured only where the deployment has also
    // set AI_RADAR_DEMO_EVIDENCE=1.
    const demo = searchParams.get("demo") === "true";
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
