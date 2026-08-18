/**
 * Sentinel Ingestion Orchestrator & Safety Interceptor
 *
 * A self-contained protected run: collect, gate, and — when the gate refuses —
 * quarantine and optionally heal. Evaluation and healing are the shared
 * implementations in `./gate` and `./heal-flow`, the same ones the real
 * ingestion pipelines run inline, so there is exactly one definition of what
 * "safe to persist" means.
 */

import { evaluateSentinelGate } from "./gate";
import { attemptSentinelHealing } from "./heal-flow";
import { BrightDataScraperHealer, type SentinelHealer } from "./healing";
import { createSentinelRepository, type SentinelRepository } from "./repository";
import type { SentinelIncidentRow } from "../supabase/types";
import type {
  SentinelIncident,
  SentinelReasonCode,
  SentinelStatus,
  SourceHealthContract,
} from "./types";

export interface SentinelProtectedRunResult<T = unknown> {
  success: boolean;
  status: SentinelStatus;
  isQuarantined: boolean;
  recordsSeen: number;
  recordsAccepted: number;
  recordsRejected: number;
  changesDetected: number;
  lastKnownGoodCount: number | null;
  lastKnownGoodPreserved: boolean;
  incident: SentinelIncident | null;
  reasonCodes: SentinelReasonCode[];
  summary: string;
  healingAttempted: boolean;
  healingOutcome?: string;
  durationMs: number;
  validRecords?: T[];
}

export interface SentinelIngestionOptions {
  repository?: SentinelRepository;
  healer?: SentinelHealer;
  now?: () => Date;
  triggeredBy?: string;
  autoHealOverride?: boolean;
}

export interface CollectorExecutionPayload {
  success: boolean;
  data: unknown[];
  metadata: {
    collectorId: string;
    runId?: string;
    startedAt?: string;
    completedAt?: string;
    durationMs?: number;
    resultCount?: number;
    status?: string;
    error?: string;
  };
  error?: Error;
}

export interface CanonicalPersistenceResult {
  acceptedCount: number;
  rejectedCount: number;
  changesDetected: number;
}

function toIncident(row: SentinelIncidentRow): SentinelIncident {
  return {
    id: row.id,
    sourceId: row.source_id,
    providerId: row.provider_id,
    runId: row.run_id,
    status: row.status,
    severity: row.severity,
    reasonCodes: row.reason_codes,
    summary: row.summary,
    recordsSeen: row.records_seen,
    recordsValid: row.records_valid,
    recordsInvalid: row.records_invalid,
    expectedCount: row.expected_count,
    lastKnownGoodCount: row.last_known_good_count,
    lastKnownGoodRunId: row.last_known_good_run_id,
    lastKnownGoodAt: row.last_known_good_at,
    healingAttemptCount: row.healing_attempt_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

/**
 * Executes a collector run protected by Sentinel.
 *
 * Guarantees:
 * 1. Anomaly or corruption is intercepted before any database write to canonical tables.
 * 2. Last-known-good baseline is preserved intact.
 * 3. Autonomous self-healing is triggered against Bright Data Scraper Studio when configured.
 * 4. Repaired candidates are validated before applying.
 */
export async function runSentinelProtectedIngestion<T = unknown>(
  contract: SourceHealthContract<T>,
  source: {
    id: string;
    providerId: string;
    collectorId?: string | null;
    sourceUrl: string;
    label?: string | null;
  },
  provider: {
    id: string;
    slug: string;
    name: string;
  },
  collect: () => Promise<CollectorExecutionPayload>,
  persistCanonical: (
    validRecords: T[],
    observedAt: string,
  ) => Promise<CanonicalPersistenceResult>,
  options: SentinelIngestionOptions = {},
): Promise<SentinelProtectedRunResult<T>> {
  const repository = options.repository ?? createSentinelRepository();
  const healer = options.healer ?? new BrightDataScraperHealer();
  const startedAt = Date.now();
  const observedAt = (options.now ?? (() => new Date()))().toISOString();

  const baseline = await repository.getLastKnownGoodBaseline(source.id);

  let collection: CollectorExecutionPayload;
  let collectorError: Error | string | null = null;
  try {
    collection = await collect();
  } catch (err) {
    collectorError = err instanceof Error ? err : new Error(String(err));
    collection = {
      success: false,
      data: [],
      metadata: {
        collectorId: source.collectorId ?? "unknown",
        status: "failed",
        error: collectorError.message,
      },
      error: collectorError,
    };
  }
  if (!collection.success && !collectorError) {
    collectorError = collection.metadata.error || collection.error || "Collector run failed";
  }

  // Raw contract validation, health evaluation and quarantine bookkeeping.
  // Canonical persistence is unreachable unless this decision is `safe`.
  const decision = await evaluateSentinelGate<T>({
    contract,
    source: { ...source, providerId: provider.id },
    rawRecords: collection.data ?? [],
    collectorError,
    observedAt,
    repository,
  });
  const evalResult = decision.evaluation;

  if (decision.safe) {
    const persistence = await persistCanonical(evalResult.validRecords, observedAt);
    return {
      success: true,
      status: evalResult.status,
      isQuarantined: false,
      recordsSeen: evalResult.recordsSeen,
      recordsAccepted: persistence.acceptedCount,
      recordsRejected: evalResult.recordsInvalid + persistence.rejectedCount,
      changesDetected: persistence.changesDetected,
      lastKnownGoodCount: evalResult.recordsValid,
      lastKnownGoodPreserved: true,
      incident: null,
      reasonCodes: evalResult.reasonCodes,
      summary: evalResult.summary,
      healingAttempted: false,
      durationMs: Date.now() - startedAt,
    };
  }

  const incidentRow = decision.incident;
  const shouldAutoHeal =
    (options.autoHealOverride ?? contract.failurePolicy.autoHeal) && Boolean(source.collectorId);

  if (shouldAutoHeal && source.collectorId) {
    const healing = await attemptSentinelHealing<T>({
      incidentId: incidentRow.id,
      sourceId: source.id,
      collectorId: source.collectorId,
      sourceUrl: source.sourceUrl,
      providerName: provider.name,
      contract,
      evaluation: evalResult,
      repository,
      healer,
      resolvedAt: observedAt,
      applyCandidate: (candidate) => persistCanonical(candidate, observedAt),
    });

    if (healing.status === "healed" && healing.applied) {
      const applied = healing.applied;
      return {
        success: true,
        status: "recovered",
        isQuarantined: false,
        recordsSeen: evalResult.recordsSeen,
        recordsAccepted: applied.acceptedCount,
        recordsRejected: 0,
        changesDetected: applied.changesDetected,
        lastKnownGoodCount: applied.acceptedCount,
        lastKnownGoodPreserved: true,
        incident: toIncident({
          ...incidentRow,
          status: "resolved",
          healing_attempt_count: healing.attemptNumber,
          resolved_at: observedAt,
        }),
        reasonCodes: evalResult.reasonCodes,
        summary: `Self-healing recovered: candidate validated and ingested ${applied.acceptedCount} records.`,
        healingAttempted: true,
        healingOutcome: "healed_and_recovered",
        durationMs: Date.now() - startedAt,
      };
    }

    const failure =
      healing.status === "healed"
        ? "candidate produced no canonical persistence"
        : healing.error;
    return {
      success: false,
      status: "needs_review",
      isQuarantined: true,
      recordsSeen: evalResult.recordsSeen,
      recordsAccepted: 0,
      recordsRejected: evalResult.recordsInvalid,
      changesDetected: 0,
      lastKnownGoodCount: baseline?.recordCount ?? null,
      lastKnownGoodPreserved: true,
      incident: toIncident({
        ...incidentRow,
        status: "needs_review",
        healing_attempt_count: healing.attemptNumber,
      }),
      reasonCodes: evalResult.reasonCodes,
      summary: `Quarantined: self-healing candidate rejected (${failure}). Requires review.`,
      healingAttempted: true,
      healingOutcome:
        healing.status === "failed"
          ? "healing_errored_quarantined"
          : "healing_failed_quarantined",
      durationMs: Date.now() - startedAt,
    };
  }

  return {
    success: false,
    status: "quarantined",
    isQuarantined: true,
    recordsSeen: evalResult.recordsSeen,
    recordsAccepted: 0,
    recordsRejected: evalResult.recordsInvalid,
    changesDetected: 0,
    lastKnownGoodCount: baseline?.recordCount ?? null,
    lastKnownGoodPreserved: true,
    incident: toIncident(incidentRow),
    reasonCodes: evalResult.reasonCodes,
    summary: evalResult.summary,
    healingAttempted: false,
    durationMs: Date.now() - startedAt,
  };
}
