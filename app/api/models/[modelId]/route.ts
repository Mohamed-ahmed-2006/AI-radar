import { handleModelDetailRequest } from "@/lib/explorer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Model Detail: one canonical model's current trusted evidence, the pricing,
 * lifecycle and capability history behind it, the changes detected between
 * those observations, and provenance for each.
 *
 * It does not restate Source Detail. Collector health, contracts, incidents and
 * healing belong to `/api/sources/[id]`; every value here carries the source and
 * run ids needed to follow the link.
 *
 *   ?history=100&changes=50
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ modelId: string }> },
): Promise<Response> {
  const { modelId } = await context.params;
  return handleModelDetailRequest(request, modelId);
}
