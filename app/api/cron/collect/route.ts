import { handleSchedulerRequest } from "@/lib/orchestration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Bright Data collectors poll; the fleet needs more than the default budget. */
export const maxDuration = 300;

/**
 * The single scheduled entry point (see `.github/workflows/collect.yml`).
 *
 * Vercel Cron issues a GET with `Authorization: Bearer $CRON_SECRET`. Which
 * sources actually run is decided by each source's configured cadence, so the
 * cron entry never has to change when the fleet does.
 */
export function GET(request: Request): Promise<Response> {
  return handleSchedulerRequest(request, { trigger: "cron" });
}
