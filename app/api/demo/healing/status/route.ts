import { handleDemoStatusRequest } from "@/lib/demo-healing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Current state of the self-healing demonstration.
 *
 * Public by design so a dashboard can render it. Collector id, healing prompts,
 * Bright Data job ids and sampled records are added only for a caller holding
 * the operator credential.
 */
export function GET(request: Request): Promise<Response> {
  return handleDemoStatusRequest(request);
}
