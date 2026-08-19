import { handleModelCompareRequest } from "@/lib/explorer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Model Compare: aligned fields for two or more canonical models.
 *
 *   GET /api/models/compare?ids=<canonical-id>,<canonical-id>
 *
 * Canonical ids only — there is deliberately no name parameter, because two
 * providers may publish the same display name and a comparison keyed on one
 * would silently align the wrong models. Ids that resolve to nothing come back
 * in `unresolvedIds` instead of being dropped.
 *
 * No row declares a winner. Ranking belongs to the Stack Optimizer.
 */
export function GET(request: Request): Promise<Response> {
  return handleModelCompareRequest(request);
}
