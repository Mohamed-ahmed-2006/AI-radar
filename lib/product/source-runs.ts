/**
 * Latest-run validation counts for the Source Detail pages.
 *
 * Reads the existing `source_health` view through the existing repository
 * function — no new query surface, no schema change. A read failure yields an
 * empty list so the detail page renders its explicit "unavailable" states
 * instead of failing the whole route.
 */

import { createSupabaseServerClient, getSourceHealth } from "../supabase";
import type { SentinelLatestRun } from "./sentinel-source-detail";
import type { SourceRunStatus } from "./source-detail";

export async function loadSentinelLatestRuns(): Promise<SentinelLatestRun[]> {
  if (typeof window !== "undefined") {
    throw new Error("loadSentinelLatestRuns must only run on the server");
  }
  try {
    const rows = await getSourceHealth(createSupabaseServerClient());
    return rows.map((row) => ({
      sourceId: row.source_id,
      runId: row.last_run_id,
      status: (row.last_run_status as SourceRunStatus | null) ?? null,
      startedAt: row.last_run_started_at,
      completedAt: row.last_run_completed_at,
      recordsSeen: row.records_seen,
      recordsAccepted: row.records_accepted,
      recordsRejected: row.records_rejected,
      errorMessage: row.error_message,
      isActive: row.is_active,
    }));
  } catch {
    return [];
  }
}
