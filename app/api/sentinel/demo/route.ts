import { NextResponse } from "next/server";
import { runSentinelDemoSimulation } from "@/lib/sentinel";

export async function POST(request: Request) {
  try {
    let body: { providerSlug?: "openai" | "anthropic" | "gemini" | "xai" } = {};
    try {
      body = await request.json();
    } catch {
      // Allow empty body
    }

    const simulationResult = await runSentinelDemoSimulation({
      providerSlug: body.providerSlug,
    });

    return NextResponse.json(simulationResult);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Sentinel demo simulation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
