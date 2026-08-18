/**
 * Sentinel State Machine & Lifecycle Transition Rules
 */

import type {
  SentinelIncidentStatus,
  SentinelReasonCode,
  SentinelSeverity,
  SentinelStatus,
} from "./types";

export interface SentinelStateTransition {
  from: SentinelStatus;
  to: SentinelStatus;
  allowed: boolean;
  reason?: string;
}

const ALLOWED_SOURCE_HEALTH_TRANSITIONS: Record<SentinelStatus, readonly SentinelStatus[]> = {
  healthy: ["healthy", "degraded", "quarantined"],
  degraded: ["healthy", "degraded", "quarantined"],
  quarantined: ["healing", "needs_review", "healthy", "recovered"],
  healing: ["recovered", "quarantined", "needs_review"],
  recovered: ["healthy", "degraded", "quarantined"],
  needs_review: ["healing", "healthy", "quarantined"],
};

/**
 * Validates whether a proposed source health state transition is allowed.
 */
export function canTransitionSourceHealth(
  from: SentinelStatus,
  to: SentinelStatus,
): boolean {
  if (from === to) return true;
  const allowedNext = ALLOWED_SOURCE_HEALTH_TRANSITIONS[from];
  return allowedNext?.includes(to) ?? false;
}

/**
 * Calculates severity based on detected reason codes.
 */
export function deriveSentinelSeverity(
  reasonCodes: readonly SentinelReasonCode[],
): SentinelSeverity {
  if (
    reasonCodes.includes("COLLECTOR_EXECUTION_FAILURE") ||
    reasonCodes.includes("ZERO_RECORDS") ||
    reasonCodes.includes("RECORD_COUNT_COLLAPSE")
  ) {
    return "critical";
  }
  if (
    reasonCodes.includes("SCHEMA_VALIDATION_FAILURE") ||
    reasonCodes.includes("ILLEGAL_ENUM_VALUE") ||
    reasonCodes.includes("ALL_PRICES_NULL") ||
    reasonCodes.includes("SEMANTIC_INVARIANT_VIOLATION") ||
    reasonCodes.includes("DUPLICATE_IDENTIFIERS")
  ) {
    return "warning";
  }
  return "info";
}

/**
 * Computes next incident status given current status and an action.
 */
export function getNextIncidentStatus(
  current: SentinelIncidentStatus,
  action: "start_heal" | "heal_succeeded" | "heal_failed_retrying" | "max_retries_exceeded" | "dismiss" | "manual_resolve",
): SentinelIncidentStatus {
  switch (action) {
    case "start_heal":
    case "heal_failed_retrying":
      return "healing";
    case "heal_succeeded":
    case "manual_resolve":
      return "resolved";
    case "max_retries_exceeded":
      return "needs_review";
    case "dismiss":
      return "dismissed";
    default:
      return current;
  }
}
