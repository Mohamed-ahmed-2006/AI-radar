import { NextResponse } from "next/server";

import { authorizeOperatorRequest } from "@/lib/orchestration/auth";
import { runSentinelDemoSimulation } from "@/lib/sentinel";
import { isSentinelDemoMode } from "@/lib/sentinel/ui-data";
import {
  consumeRateLimit,
  rateLimitedResponse,
  rateLimitIdentity,
  RATE_LIMIT_POLICIES,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The deterministic in-memory Sentinel hero simulation.
 *
 * It touches neither Supabase nor Bright Data — it fabricates a healthy →
 * quarantined → healed timeline from fixtures — which is exactly why it must
 * not answer anonymously on a production deployment. A visitor who found this
 * URL would receive a fully-formed recovery incident that never happened, with
 * nothing at the transport layer distinguishing it from live telemetry.
 *
 * It is therefore reachable only where the deployment has explicitly opted into
 * demo mode (`SENTINEL_DEMO_MODE=1`), or where the caller holds the operator
 * credential. A production deployment answers 404: the simulator is not part of
 * its surface.
 */
export async function POST(request: Request) {
  const exposed = isSentinelDemoMode() || authorizeOperatorRequest(request).authorized;
  if (!exposed) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const decision = consumeRateLimit(
    "sentinel-simulation",
    rateLimitIdentity(request),
    RATE_LIMIT_POLICIES.simulation,
  );
  if (!decision.allowed) {
    return rateLimitedResponse(decision, "Too many simulation requests.");
  }

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
