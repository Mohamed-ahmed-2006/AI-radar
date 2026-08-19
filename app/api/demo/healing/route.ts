import { handleDemoActionRequest } from "@/lib/demo-healing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A real Bright Data refactor takes minutes; the default budget is too small. */
export const maxDuration = 300;

/**
 * Runs one step of the self-healing demonstration.
 *
 * Body: `{ "action": "run_baseline" }`. `action` is the only accepted input,
 * and it is validated against a fixed enum — no collector id, URL or prompt can
 * be supplied by a caller.
 *
 * Requires the same operator credential as the collection scheduler.
 */
export function POST(request: Request): Promise<Response> {
  return handleDemoActionRequest(request);
}
