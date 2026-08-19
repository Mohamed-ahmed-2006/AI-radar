import { NextResponse } from "next/server";

import {
  getHealingDemoAdapter,
  isHealingDemoAction,
  type HealingDemoAction,
} from "@/lib/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read model and allowlisted actions for the real Bright Data healing demo.
 *
 * Unknown actions are rejected. Extra fields (URL, collector ID, source) are
 * ignored. The route never calls the in-memory Sentinel simulation and never
 * installs the fixture adapter.
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

export async function POST(request: Request) {
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
