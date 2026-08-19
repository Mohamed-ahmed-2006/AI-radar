import { ingestAllPricing, isAuthorizedIngestRequest } from "@/lib/pipeline";
import {
  consumeRateLimit,
  rateLimitedResponse,
  rateLimitIdentity,
  RATE_LIMIT_POLICIES,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorizedIngestRequest(request)) {
    return Response.json({ success: false, error: "unauthorized" }, { status: 401 });
  }
  // Four collector jobs per call, so it is bounded on the tighter fleet policy
  // rather than the per-provider one.
  const decision = consumeRateLimit(
    "manual-orchestration",
    rateLimitIdentity(request),
    RATE_LIMIT_POLICIES.manualOrchestration,
  );
  if (!decision.allowed) {
    return rateLimitedResponse(decision, "Manual fleet ingest is rate limited.");
  }
  const providers = await ingestAllPricing({ triggeredBy: "manual-api-all" });
  return Response.json({
    success: providers.every((provider) => provider.success),
    status: providers.every((provider) => provider.success) ? "completed" : "partial",
    providers,
  });
}
