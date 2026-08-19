import { handleSourceDetailRequest } from "@/lib/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything the Source Detail page needs, in one response: identity,
 * provenance, contract, health, freshness, run history, incident and healing
 * timeline, accepted observations, historical values, and a worked raw →
 * normalized example.
 *
 * It is one endpoint rather than four (`/history`, `/healing`, …) because the
 * page renders them together: separate routes would mean four round trips and
 * four independent reads of the same source row. Each section is bounded
 * individually through query parameters instead:
 *
 *   ?runs=50&incidents=10&healing=10&observations=100
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return handleSourceDetailRequest(request, id);
}
