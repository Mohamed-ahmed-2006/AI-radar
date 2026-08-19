/**
 * View model for the Sentinel source-health experience.
 *
 * The wire contract itself is owned by the backend (`lib/sentinel/types.ts`)
 * and is imported here rather than restated. These types only add what the
 * screen needs on top of it: a flattened per-source shape, a rendered timeline,
 * and derived summary counts.
 */

import type {
  SentinelDashboardReadModel,
  SentinelIncidentStatus,
  SentinelReasonCode,
  SentinelSeverity,
  SentinelStatus,
} from "../../../lib/sentinel/types";
import type { HealthStatus } from "../types";

export type {
  SentinelDashboardReadModel,
  SentinelIncidentStatus,
  SentinelReasonCode,
  SentinelSeverity,
  SentinelStatus,
};

export type SentinelStageStatus = "done" | "active" | "failed" | "pending";

export interface SentinelTimelineStage {
  id: string;
  label: string;
  detail?: string;
  at: string | null;
  status: SentinelStageStatus;
  /** Backend-supplied duration for the stage, in milliseconds. */
  durationMs?: number | null;
}

/** One side of the last-known-good comparison. */
export interface SentinelSnapshotView {
  label: string;
  runId: string | null;
  observedAt: string | null;
  recordCount: number | null;
  invalidCount: number | null;
}

export interface SentinelIncidentView {
  id: string;
  status: SentinelIncidentStatus;
  severity: SentinelSeverity;
  reasonCodes: SentinelReasonCode[];
  summary: string | null;
  recordsSeen: number | null;
  recordsValid: number | null;
  recordsInvalid: number | null;
  healingAttemptCount: number;
  createdAt: string;
}

export interface SentinelHealingView {
  attempts: number;
  /** Status of the most recent attempt, verbatim from the backend. */
  latestStatus: string | null;
  succeeded: boolean;
}

export interface SentinelSourceView {
  sourceId: string;
  name: string;
  providerName: string;
  kind: string;
  collectorId: string | null;
  sourceUrl: string | null;
  status: SentinelStatus;
  /** Mapped for the shared `StatusDot` so dots stay consistent app-wide. */
  health: HealthStatus;
  lastRunAt: string | null;
  stalenessMinutes: number | null;
  currentRecordCount: number | null;
  lastKnownGood: SentinelSnapshotView | null;
  rejectedCandidate: SentinelSnapshotView | null;
  incident: SentinelIncidentView | null;
  healing: SentinelHealingView;
  timeline: SentinelTimelineStage[];
}

/**
 * The backend's own summary shape, plus counts the header needs. Field names
 * and definitions match `getSentinelDashboardReadModel` exactly.
 */
export type SentinelSummaryView = SentinelDashboardReadModel["summary"] & {
  statusCounts: Record<SentinelStatus, number>;
  providers: number;
  recordsProtected: number | null;
  healingAttempts: number;
  lastRunAt: string | null;
};

export interface SentinelView {
  /** True only for the explicitly enabled deterministic demo simulation. */
  isDemo: boolean;
  /** Demo scenario name, or null for live data. */
  demoScenario: string | null;
  generatedAt: string;
  sources: SentinelSourceView[];
  spotlightSourceId: string | null;
  summary: SentinelSummaryView;
}
