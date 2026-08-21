/**
 * Nothing leaves a collection run open.
 *
 * `startCollectionRun` writes a row that claims ingestion is in flight. Only
 * `completeCollectionRun` or `failCollectionRun` retracts that claim, and until
 * one of them runs the row reads `status = running, completed_at = null`.
 *
 * Every pipeline used to reach `startCollectionRun` and then do real work —
 * identity resolution, snapshot writes, change detection — with no handler
 * between. A throw anywhere in that stretch unwound past both terminators and
 * abandoned the row. The orchestration layer recorded its own failure and moved
 * on, so the fleet kept running while Source Detail went on reporting a run
 * that had been dead for a day as the source's current state.
 *
 * `guardCollectionRun` is the missing handler. It records the failure against
 * the run and re-throws unchanged, so callers keep whatever error handling they
 * already had and the row is always terminal.
 */

import { SentinelQuarantineError } from "./sentinel-gate";
import type { Json, RunCounts } from "../supabase";

export type FailCollectionRun = (
  runId: string,
  error: { message: string; details?: Json },
  counts?: Partial<RunCounts>,
) => Promise<unknown>;

/**
 * Runs `body`, finalizing `runId` as failed if it throws.
 *
 * A `SentinelQuarantineError` passes straight through: the gate has already
 * failed the run with the record counts it actually evaluated, and re-failing it
 * here would replace that evidence with zeroes.
 *
 * A failure while *recording* the failure is swallowed, because the original
 * error is the one the caller needs to see. The run row is no worse off than it
 * would have been without the guard.
 */
export async function guardCollectionRun<T>(
  runId: string,
  failRun: FailCollectionRun,
  body: () => Promise<T>,
): Promise<T> {
  try {
    return await body();
  } catch (thrown) {
    if (!(thrown instanceof SentinelQuarantineError)) {
      try {
        await failRun(runId, {
          message: thrown instanceof Error ? thrown.message : String(thrown),
          details: {
            stage: "ingestion",
            error: thrown instanceof Error ? thrown.name : "UnknownError",
          } as Json,
        });
      } catch {
        // Reporting the failure failed too. The original error still governs.
      }
    }
    throw thrown;
  }
}
