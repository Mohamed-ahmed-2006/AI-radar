import { handleOrchestrationStatusRequest } from "@/lib/orchestration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Orchestration status: last attempt, last success, next expected run, current
 * running state, latest result and duration, per source. Read-only, so it is
 * public — collector ids and error diagnostics are withheld unless the caller
 * presents a scheduler credential.
 */
export function GET(request: Request): Promise<Response> {
  return handleOrchestrationStatusRequest(request);
}
