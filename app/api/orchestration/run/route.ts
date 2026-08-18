import { handleSchedulerRequest } from "@/lib/orchestration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Operator trigger for the same orchestrated path the scheduler uses.
 *
 * Body: `{ "sources": ["openai-pricing"], "force": true }` — both optional.
 * `force` bypasses cadence, never the per-source lease.
 */
export function POST(request: Request): Promise<Response> {
  return handleSchedulerRequest(request, { trigger: "manual" });
}
