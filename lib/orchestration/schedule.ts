/**
 * Cadence arithmetic for the scheduler.
 *
 * Vercel Cron fires one fixed tick. Which sources actually run on a tick is
 * decided here from each source's configured cadence and its last attempt, so
 * adding or re-pacing a source never means editing `vercel.json`.
 */

import type { CollectionSourceDefinition } from "./types";

/** The single scheduled entry point. Must match `vercel.json`. */
export const SCHEDULER_TICK = {
  path: "/api/cron/collect",
  /** Hourly: the finest cadence granularity the fleet can express. */
  cronExpression: "0 * * * *",
  intervalMinutes: 60,
} as const;

export type ScheduleReason =
  | "never_run"
  | "cadence_elapsed"
  | "forced"
  | "not_due"
  | "disabled";

export interface ScheduleDecision {
  due: boolean;
  reason: ScheduleReason;
  nextExpectedRunAt: string | null;
}

export function computeNextRunAt(
  lastAttemptAt: string | null | undefined,
  cadenceMinutes: number,
): string | null {
  if (!lastAttemptAt) return null;
  const last = Date.parse(lastAttemptAt);
  if (Number.isNaN(last)) return null;
  return new Date(last + cadenceMinutes * 60_000).toISOString();
}

/**
 * A source is due when it has never run, or when its cadence has elapsed since
 * the last *attempt*. Attempts — not successes — pace the fleet, so a source
 * that keeps failing still backs off to its cadence instead of being retried
 * on every tick.
 */
export function evaluateSchedule(
  source: Pick<CollectionSourceDefinition, "enabled" | "schedule">,
  lastAttemptAt: string | null | undefined,
  now: Date,
  options: { force?: boolean } = {},
): ScheduleDecision {
  const nextExpectedRunAt = computeNextRunAt(lastAttemptAt, source.schedule.cadenceMinutes);

  if (!source.enabled) {
    return { due: false, reason: "disabled", nextExpectedRunAt };
  }
  if (options.force) {
    return { due: true, reason: "forced", nextExpectedRunAt };
  }
  if (!nextExpectedRunAt) {
    return { due: true, reason: "never_run", nextExpectedRunAt: null };
  }
  const due = now.getTime() >= Date.parse(nextExpectedRunAt);
  return {
    due,
    reason: due ? "cadence_elapsed" : "not_due",
    nextExpectedRunAt,
  };
}

/** Backoff for attempt `attemptNumber` (1-based), capped by the policy. */
export function computeBackoffMs(
  policy: { backoffMs: number; backoffMultiplier: number; maxBackoffMs: number },
  attemptNumber: number,
): number {
  const raw = policy.backoffMs * policy.backoffMultiplier ** Math.max(0, attemptNumber - 1);
  return Math.min(policy.maxBackoffMs, Math.round(raw));
}
