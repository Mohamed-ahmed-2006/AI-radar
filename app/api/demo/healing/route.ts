import { NextResponse } from "next/server";

import { authorizeOperatorRequest } from "@/lib/orchestration/auth";
import { isOperatorSessionConfigured } from "@/lib/orchestration/operator-session";
import {
  getHealingDemoAdapter,
  isHealingDemoAction,
  type HealingDemoAction,
} from "@/lib/product";
import {
  consumeRateLimit,
  rateLimitedResponse,
  rateLimitHeaders,
  rateLimitIdentity,
  RATE_LIMIT_POLICIES,
} from "@/lib/rate-limit";

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
 * The steps that spend Bright Data quota: each runs the demo collector for
 * real, and `start_healing` additionally submits a Scraper Studio refactor.
 * `reset` is included because restoring a broken extraction template is itself
 * a refactor job. The remaining actions are local state transitions.
 */
const EXPENSIVE_ACTIONS: ReadonlySet<HealingDemoAction> = new Set<HealingDemoAction>([
  "reset",
  "establish_baseline",
  "run_broken_collector",
  "start_healing",
  "rerun_recover",
]);

/**
 * Whether a mutating demo step may run.
 *
 * These steps drive a real collector and a real Scraper Studio refactor, so
 * they are closed by default. Authorization is the operator credential — sent
 * as a header, or held as the signed `HttpOnly` session cookie that
 * `/api/operator/session` mints for a browser. A public visitor holds neither,
 * so no anonymous request can start a repair job.
 *
 * `AI_RADAR_HEALING_DEMO_OPEN_CONTROLS=1` survives only as an explicit
 * server-side opt-in for a throwaway deployment where anyone may press the
 * buttons. It is *not* required for a public deployment and must not be set on
 * one; the operator session is the supported mechanism. Even where it is set,
 * the rate limit below still applies, so an open deployment still cannot be
 * used to drain Bright Data quota.
 */
function mayMutate(request: Request): boolean {
  if (process.env.AI_RADAR_HEALING_DEMO_OPEN_CONTROLS === "1") return true;
  return authorizeOperatorRequest(request).authorized;
}

export async function POST(request: Request) {
  if (!mayMutate(request)) {
    return NextResponse.json(
      {
        error: "Healing demo controls require the operator credential",
        // Lets the UI offer an unlock prompt instead of a dead button. It
        // reveals only whether unlocking is possible, never the credential.
        unlockAvailable: isOperatorSessionConfigured(),
      },
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

  // Bounded however the caller was authorized: a shared operator credential, or
  // an open-controls deployment, must not become a way to run repair jobs in a
  // loop.
  const expensive = EXPENSIVE_ACTIONS.has(action);
  const decision = consumeRateLimit(
    expensive ? "healing-demo-expensive" : "healing-demo-cheap",
    rateLimitIdentity(request),
    expensive
      ? RATE_LIMIT_POLICIES.healingDemoExpensive
      : RATE_LIMIT_POLICIES.healingDemoCheap,
  );
  if (!decision.allowed) {
    return rateLimitedResponse(
      decision,
      expensive
        ? "This step runs a real Bright Data job. Wait for the window to reset before running it again."
        : "Too many demo requests. Wait and try again.",
    );
  }

  try {
    const adapter = getHealingDemoAdapter();
    const model = await adapter.runAction(action);
    return NextResponse.json(model, { headers: rateLimitHeaders(decision) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Real healing demo unavailable";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
