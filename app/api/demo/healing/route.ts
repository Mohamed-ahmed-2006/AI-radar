import { NextResponse } from "next/server";

import { authorizeSchedulerRequest } from "@/lib/orchestration/auth";
import {
  getHealingDemoAdapter,
  isHealingDemoAction,
  type HealingDemoAction,
} from "@/lib/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A real Bright Data refactor takes minutes; the default budget is too small. */
export const maxDuration = 300;

/**
 * Read model and allowlisted actions for the real Bright Data healing demo.
 *
 * Unknown actions are rejected. Extra fields (URL, collector ID, source) are
 * ignored — the body carries a single enum and nothing else reaches the
 * backend, so no request can retarget the demo. The route never calls the
 * in-memory Sentinel simulation and never installs the fixture adapter.
 */
export async function GET() {
  try {
    const adapter = getHealingDemoAdapter();
    const model = await adapter.getState();
    return NextResponse.json(model);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Real healing demo unavailable";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

/**
 * Whether a mutating demo step may run.
 *
 * These steps drive a real collector and a real Scraper Studio refactor, so
 * they are closed by default and authorized with the same operator credential
 * as the collection scheduler.
 *
 * A judge-facing deployment that wants the buttons live for anyone can set
 * `AI_RADAR_HEALING_DEMO_OPEN_CONTROLS=1`. That is a deliberate, server-side
 * opt-in, and it is still confined to the dedicated demo source: neither the
 * action allowlist nor the collector allowlist moves.
 */
function mayMutate(request: Request): boolean {
  if (process.env.AI_RADAR_HEALING_DEMO_OPEN_CONTROLS === "1") return true;
  return authorizeSchedulerRequest(request).authorized;
}

export async function POST(request: Request) {
  if (!mayMutate(request)) {
    return NextResponse.json(
      { error: "Healing demo controls require the operator credential" },
      { status: 401 },
    );
  }

  let body: { action?: unknown };
  try {
    body = (await request.json()) as { action?: unknown };
  } catch {
    return NextResponse.json({ error: "JSON body required" }, { status: 400 });
  }

  if (!isHealingDemoAction(body.action)) {
    return NextResponse.json(
      { error: "Action is not in the healing demo allowlist" },
      { status: 400 },
    );
  }

  const action: HealingDemoAction = body.action;

  try {
    const adapter = getHealingDemoAdapter();
    const model = await adapter.runAction(action);
    return NextResponse.json(model);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Real healing demo unavailable";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
