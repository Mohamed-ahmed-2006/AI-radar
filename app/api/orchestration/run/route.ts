import { handleSchedulerRequest } from "@/lib/orchestration";
import {
  consumeRateLimit,
  rateLimitedResponse,
  rateLimitIdentity,
  RATE_LIMIT_POLICIES,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Operator trigger for the same orchestrated path the scheduler uses.
 *
 * Body: `{ "sources": ["openai-pricing"], "force": true }` — both optional.
 * `force` bypasses cadence, never the per-source lease.
 *
 * Rate limited because this is the manual path: a fleet run is ten real Bright
 * Data collector jobs, and `force` skips the cadence that otherwise bounds how
 * often they happen. The scheduled entry point, `/api/cron/collect`, is
 * deliberately not limited — cadence and the per-source lease already bound it,
 * and a throttled cron tick would be a self-inflicted outage.
 */
export async function POST(request: Request): Promise<Response> {
  const decision = consumeRateLimit(
    "manual-orchestration",
    rateLimitIdentity(request),
    RATE_LIMIT_POLICIES.manualOrchestration,
  );
  if (!decision.allowed) {
    return rateLimitedResponse(
      decision,
      "Manual fleet runs are rate limited. The scheduled collection is unaffected.",
    );
  }
  return handleSchedulerRequest(request, { trigger: "manual" });
}
