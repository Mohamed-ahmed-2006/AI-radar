/**
 * Sentinel Ingestion Orchestrator & Safety Interceptor
 */

import { evaluateSourceHealth } from "./evaluator";
import {
  BrightDataScraperHealer,
  generateHealingPrompt,
  type SentinelHealer,
} from "./healing";
import {
  createSentinelRepository,
  type SentinelRepository,
} from "./repository";
import { deriveSentinelSeverity, getNextIncidentStatus } from "./state-machine";
import type {
  LastKnownGoodBaseline,
  SentinelEvaluationResult,
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

  // 1. Fetch Last-Known-Good Baseline
  const baseline: LastKnownGoodBaseline | null =
    await repository.getLastKnownGoodBaseline(source.id);

  // 2. Execute Collector
  let collection: CollectorExecutionPayload;
  let collectorError: Error | null = null;

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

  // 3. Evaluate Output via Sentinel Deterministic Rules
  const rawRecords = collection.data ?? [];
  const evalResult: SentinelEvaluationResult<T> = evaluateSourceHealth<T>(
    rawRecords,
    contract,
    baseline,
    {
      collectorExecutionError: collection.success ? null : (collection.metadata.error || collectorError),
      observedAt,
    },
  );

  // 4. Branch: HEALTHY or DEGRADED (Under Threshold) -> Allow Canonical Persistence
  if (!evalResult.shouldQuarantine && evalResult.isHealthy) {
    const persistence = await persistCanonical(evalResult.validRecords, observedAt);

    // Resolve any existing open incident
    const openIncident = await repository.getLatestOpenIncident(source.id);
    if (openIncident && openIncident.status !== "resolved") {
      await repository.updateIncident(openIncident.id, {
        status: "resolved",
        resolutionNote: `Source restored to health. Validated ${evalResult.recordsValid} records.`,
        resolvedAt: observedAt,
      });
    }

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

  // 5. Branch: ANOMALOUS -> QUARANTINE CANDIDATE & PROTECT CANONICAL STATE
  // DO NOT invoke persistCanonical here!
  const severity = deriveSentinelSeverity(evalResult.reasonCodes);
  const incidentRow = await repository.createIncident({
    sourceId: source.id,
    providerId: provider.id,
    runId: null,
    status: "open",
    severity,
    reasonCodes: evalResult.reasonCodes,
    summary: evalResult.summary,
    recordsSeen: evalResult.recordsSeen,
    recordsValid: evalResult.recordsValid,
    recordsInvalid: evalResult.recordsInvalid,
    expectedCount: baseline?.recordCount ?? contract.minViableRecords,
    lastKnownGoodCount: baseline?.recordCount ?? null,
    lastKnownGoodRunId: baseline?.runId ?? null,
    lastKnownGoodAt: baseline?.observedAt ?? null,
    healingAttemptCount: 0,
  });

  // Isolate raw payload and diagnostics into quarantine store
  await repository.saveQuarantinePayload({
    incidentId: incidentRow.id,
    sourceId: source.id,
    rawPayload: rawRecords,
    validationErrors: evalResult.issues,
  });

  const shouldAutoHeal =
    (options.autoHealOverride ?? contract.failurePolicy.autoHeal) &&
    Boolean(source.collectorId);

  // 6. Optional Autonomous Self-Healing Flow
  if (shouldAutoHeal && source.collectorId) {
    const collectorId = source.collectorId;
    const prompt = generateHealingPrompt(evalResult, {
      sourceUrl: source.sourceUrl,
      providerName: provider.name,
      collectorId,
    });

    const attemptNumber = 1;
    await repository.updateIncident(incidentRow.id, {
      status: "healing",
      healingAttemptCount: attemptNumber,
    });

    await repository.recordHealingAttempt({
      incidentId: incidentRow.id,
      sourceId: source.id,
      collectorId,
      attemptNumber,
      prompt,
      status: "initiated",
      startedAt: new Date().toISOString(),
    });

    try {
      const healResult = await healer.healScraper<T>(
        {
          collectorId,
          prompt,
          sourceUrl: source.sourceUrl,
        },
        contract,
      );

      // Validate repaired candidate
      if (healResult.success && healResult.candidateData && healResult.candidateData.length > 0) {
        // Candidate passed Sentinel validation! Ingest candidate into canonical store
        const persistence = await persistCanonical(healResult.candidateData, observedAt);

        await repository.recordHealingAttempt({
          incidentId: incidentRow.id,
          sourceId: source.id,
          collectorId,
          attemptNumber,
          prompt,
          status: "approved",
          candidateRecordsCount: healResult.candidateData.length,
          candidatePassedValidation: true,
          completedAt: new Date().toISOString(),
        });

        const updatedIncident = await repository.updateIncident(incidentRow.id, {
          status: "resolved",
          resolutionNote: `Autonomous self-healing completed: repaired collector validated and ingested ${persistence.acceptedCount} records.`,
          resolvedAt: observedAt,
        });

        return {
          success: true,
          status: "recovered",
          isQuarantined: false,
          recordsSeen: evalResult.recordsSeen,
          recordsAccepted: persistence.acceptedCount,
          recordsRejected: 0,
          changesDetected: persistence.changesDetected,
          lastKnownGoodCount: persistence.acceptedCount,
          lastKnownGoodPreserved: true,
          incident: {
            id: updatedIncident.id,
            sourceId: updatedIncident.source_id,
            providerId: updatedIncident.provider_id,
            runId: updatedIncident.run_id,
            status: updatedIncident.status,
            severity: updatedIncident.severity,
            reasonCodes: updatedIncident.reason_codes,
            summary: updatedIncident.summary,
            recordsSeen: updatedIncident.records_seen,
            recordsValid: updatedIncident.records_valid,
            recordsInvalid: updatedIncident.records_invalid,
            expectedCount: updatedIncident.expected_count,
            lastKnownGoodCount: updatedIncident.last_known_good_count,
            lastKnownGoodRunId: updatedIncident.last_known_good_run_id,
            lastKnownGoodAt: updatedIncident.last_known_good_at,
            healingAttemptCount: updatedIncident.healing_attempt_count,
            createdAt: updatedIncident.created_at,
            updatedAt: updatedIncident.updated_at,
            resolvedAt: updatedIncident.resolved_at,
          },
          reasonCodes: evalResult.reasonCodes,
          summary: `Self-healing recovered: candidate validated and ingested ${persistence.acceptedCount} records.`,
          healingAttempted: true,
          healingOutcome: "healed_and_recovered",
          durationMs: Date.now() - startedAt,
        };
      }

      // Heal failed validation or timed out
      await repository.recordHealingAttempt({
        incidentId: incidentRow.id,
        sourceId: source.id,
        collectorId,
        attemptNumber,
        prompt,
        status: healResult.status === "rejected" ? "candidate_rejected" : "failed",
        candidatePassedValidation: false,
        errorMessage: healResult.error ?? "Healed candidate failed Sentinel contract checks",
        completedAt: new Date().toISOString(),
      });

      const nextStatus = getNextIncidentStatus("open", "max_retries_exceeded");
      const updatedIncident = await repository.updateIncident(incidentRow.id, {
        status: nextStatus,
        resolutionNote: `Self-healing attempt 1 failed validation: ${healResult.error}`,
      });

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
        incident: {
          id: updatedIncident.id,
          sourceId: updatedIncident.source_id,
          providerId: updatedIncident.provider_id,
          runId: updatedIncident.run_id,
          status: updatedIncident.status,
          severity: updatedIncident.severity,
          reasonCodes: updatedIncident.reason_codes,
          summary: updatedIncident.summary,
          recordsSeen: updatedIncident.records_seen,
          recordsValid: updatedIncident.records_valid,
          recordsInvalid: updatedIncident.records_invalid,
          expectedCount: updatedIncident.expected_count,
          lastKnownGoodCount: updatedIncident.last_known_good_count,
          lastKnownGoodRunId: updatedIncident.last_known_good_run_id,
          lastKnownGoodAt: updatedIncident.last_known_good_at,
          healingAttemptCount: updatedIncident.healing_attempt_count,
          createdAt: updatedIncident.created_at,
          updatedAt: updatedIncident.updated_at,
          resolvedAt: updatedIncident.resolved_at,
        },
        reasonCodes: evalResult.reasonCodes,
        summary: `Quarantined: self-healing candidate rejected (${healResult.error}). Requires review.`,
        healingAttempted: true,
        healingOutcome: "healing_failed_quarantined",
        durationMs: Date.now() - startedAt,
      };
    } catch (healErr) {
      const errorMsg = healErr instanceof Error ? healErr.message : String(healErr);
      await repository.recordHealingAttempt({
        incidentId: incidentRow.id,
        sourceId: source.id,
        collectorId,
        attemptNumber,
        prompt,
        status: "failed",
        candidatePassedValidation: false,
        errorMessage: errorMsg,
        completedAt: new Date().toISOString(),
      });

      const updatedIncident = await repository.updateIncident(incidentRow.id, {
        status: "needs_review",
        resolutionNote: `Self-healing error: ${errorMsg}`,
      });

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
        incident: {
          id: updatedIncident.id,
          sourceId: updatedIncident.source_id,
          providerId: updatedIncident.provider_id,
          runId: updatedIncident.run_id,
          status: updatedIncident.status,
          severity: updatedIncident.severity,
          reasonCodes: updatedIncident.reason_codes,
          summary: updatedIncident.summary,
          recordsSeen: updatedIncident.records_seen,
          recordsValid: updatedIncident.records_valid,
          recordsInvalid: updatedIncident.records_invalid,
          expectedCount: updatedIncident.expected_count,
          lastKnownGoodCount: updatedIncident.last_known_good_count,
          lastKnownGoodRunId: updatedIncident.last_known_good_run_id,
          lastKnownGoodAt: updatedIncident.last_known_good_at,
          healingAttemptCount: updatedIncident.healing_attempt_count,
          createdAt: updatedIncident.created_at,
          updatedAt: updatedIncident.updated_at,
          resolvedAt: updatedIncident.resolved_at,
        },
        reasonCodes: evalResult.reasonCodes,
        summary: `Quarantined: healing failed (${errorMsg}).`,
        healingAttempted: true,
        healingOutcome: "healing_errored_quarantined",
        durationMs: Date.now() - startedAt,
      };
    }
  }

  // Quarantined without healing
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
    incident: {
      id: incidentRow.id,
      sourceId: incidentRow.source_id,
      providerId: incidentRow.provider_id,
      runId: incidentRow.run_id,
      status: incidentRow.status,
      severity: incidentRow.severity,
      reasonCodes: incidentRow.reason_codes,
      summary: incidentRow.summary,
      recordsSeen: incidentRow.records_seen,
      recordsValid: incidentRow.records_valid,
      recordsInvalid: incidentRow.records_invalid,
      expectedCount: incidentRow.expected_count,
      lastKnownGoodCount: incidentRow.last_known_good_count,
      lastKnownGoodRunId: incidentRow.last_known_good_run_id,
      lastKnownGoodAt: incidentRow.last_known_good_at,
      healingAttemptCount: incidentRow.healing_attempt_count,
      createdAt: incidentRow.created_at,
      updatedAt: incidentRow.updated_at,
      resolvedAt: incidentRow.resolved_at,
    },
    reasonCodes: evalResult.reasonCodes,
    summary: evalResult.summary,
    healingAttempted: false,
    durationMs: Date.now() - startedAt,
  };
}
