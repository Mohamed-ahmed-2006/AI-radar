/**
 * Autonomous Collection Orchestration — shared types.
 *
 * The orchestrator owns *when* and *whether* a configured intelligence source
 * runs. It never owns *how* records are scraped or persisted: collection stays
 * in `lib/brightdata`, canonical persistence stays in `lib/pipeline`, and
 * safety stays in `lib/sentinel`.
 */

import type { CollectorRunResult } from "../brightdata/types";
import type { CatalogIngestionResult, OpenAiPricingIngestionResult } from "../pipeline";
import type {
  SentinelReasonCode,
  SentinelRepository,
  SentinelStatus,
  SourceHealthContract,
} from "../sentinel";
import type { SourceKind } from "../supabase";

/** Intelligence domain a configured source contributes to. */
export type CollectionSourceType = "pricing" | "lifecycle" | "catalog";

/** Stable identity of a configured source. Used for locking and reporting. */
export type CollectionSourceKey =
  | "openai-pricing"
  | "anthropic-pricing"
  | "gemini-pricing"
  | "xai-pricing"
  | "anthropic-lifecycle"
  | "gemini-lifecycle"
  | "openai-catalog"
  | "anthropic-catalog"
  | "gemini-catalog"
  | "xai-catalog";

export type CollectionPersistenceResult =
  | OpenAiPricingIngestionResult
  | CatalogIngestionResult;


/** What made a failed attempt worth repeating. */
export type RetryableFailureKind = "collector_error" | "collector_timeout";

export interface RetryPolicy {
  /** Total attempts including the first. Always finite: no infinite polling. */
  maxAttempts: number;
  /** Delay before the second attempt. */
  backoffMs: number;
  /** Growth factor applied per subsequent attempt. */
  backoffMultiplier: number;
  /** Ceiling for the computed backoff. */
  maxBackoffMs: number;
  /**
   * Failure kinds worth another collector attempt. Sentinel quarantine is
   * deliberately absent: re-scraping a source that produced structurally bad
   * data yields the same bad data, and healing already owns that path.
   */
  retryOn: readonly RetryableFailureKind[];
}

export interface SourceSchedule {
  /** Minimum spacing between two runs of this source. */
  cadenceMinutes: number;
  /** Human-facing cron equivalent, surfaced in the status read model. */
  cronHint: string;
}

export interface FailureIsolationPolicy {
  /** A failing source never aborts the rest of the fleet. */
  continueFleetOnFailure: true;
  /** Quarantine must block canonical persistence for this source. */
  quarantineBlocksPersistence: true;
  /** Consecutive failed runs after which the read model flags the source. */
  alertAfterConsecutiveFailures: number;
}

/** The unit of work the orchestrator schedules. */
export interface CollectionSourceDefinition {
  key: CollectionSourceKey;
  provider: string;
  providerSlug: string;
  providerHomepageUrl: string;
  sourceType: CollectionSourceType;
  /** `sources.kind` the underlying pipeline persists against. */
  sourceKind: SourceKind;
  label: string;
  sourceUrl: string;
  /** Bright Data collector id. Never rendered into any public payload. */
  collectorId: string;
  enabled: boolean;
  schedule: SourceSchedule;
  timeoutMs: number;
  retry: RetryPolicy;
  failureIsolation: FailureIsolationPolicy;
  /** Runs the configured Bright Data collector. Owned by `lib/brightdata`. */
  collect: () => Promise<CollectorRunResult<unknown>>;
  /**
   * Hands an already-collected payload to the existing canonical ingestion
   * pipeline. The orchestrator never re-scrapes to persist, and never persists
   * itself: the pipeline runs the Sentinel gate and throws
   * `SentinelQuarantineError` rather than writing when the payload is unsafe.
   */
  persist: (
    payload: CollectorRunResult<unknown>,
    context: { triggeredBy: string; sentinelRepository?: SentinelRepository },
  ) => Promise<CollectionPersistenceResult>;

  /** Sentinel health contract governing this source's payloads. */
  createHealthContract: (sourceId: string) => SourceHealthContract<unknown>;
}

export type SourceRunStatus = "succeeded" | "failed" | "quarantined" | "skipped";

export type SourceRunOutcome =
  | "completed"
  | "already_processed"
  | "healed"
  | "quarantined"
  | "collector_failed"
  | "timed_out"
  | "persistence_failed"
  | "skipped_disabled"
  | "skipped_not_due"
  | "skipped_locked"
  | "skipped_duplicate_invocation";

export interface SourceSentinelReport {
  status: SentinelStatus;
  quarantined: boolean;
  incidentId: string | null;
  reasonCodes: SentinelReasonCode[];
  healingAttempted: boolean;
  healingOutcome: string | null;
  lastKnownGoodPreserved: boolean;
  summary: string;
}

export interface SourceRunResult {
  sourceKey: CollectionSourceKey;
  provider: string;
  providerSlug: string;
  sourceType: CollectionSourceType;
  status: SourceRunStatus;
  outcome: SourceRunOutcome;
  attempts: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  orchestrationRunId: string | null;
  collectionRunId: string | null;
  externalRunId: string | null;
  recordsAccepted: number;
  recordsRejected: number;
  changesDetected: number;
  sentinel: SourceSentinelReport | null;
  error: { code: string; message: string } | null;
  nextExpectedRunAt: string | null;
}

export type FleetRunStatus = "completed" | "partial" | "failed" | "noop";

export interface FleetRunResult {
  invocationId: string;
  trigger: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: FleetRunStatus;
  sources: SourceRunResult[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    quarantined: number;
    skipped: number;
  };
}
