/**
 * Single-source execution.
 *
 * The order of operations is fixed and is the whole point of this module:
 *
 *   lease  →  collector (bounded retries, per-attempt timeout)
 *          →  ingestion pipeline, which runs the Sentinel gate inline:
 *               raw contract validation → health evaluation
 *               → unsafe: incident + quarantine, canonical writes never happen
 *               → safe: canonical persistence and change detection
 *          →  bounded self-healing when a payload was refused
 *          →  orchestration-run reporting
 *          →  lease release
 *
 * Nothing here scrapes, validates or persists on its own. Collection is
 * `lib/brightdata`, persistence is `lib/pipeline`, safety is `lib/sentinel`.
 */

import type { CollectorRunResult } from "../brightdata/types";
import {
  PricingIngestionError,
  SentinelQuarantineError,
  type OpenAiPricingIngestionResult,
} from "../pipeline";
import {
  BrightDataScraperHealer,
  attemptSentinelHealing,
  createSentinelRepository,
  type SentinelHealer,
  type SentinelRepository,
} from "../sentinel";
import {
  createOrchestrationRepository,
  type OrchestrationRepository,
} from "./repository";
import { computeBackoffMs, computeNextRunAt, evaluateSchedule } from "./schedule";
import type {
  CollectionSourceDefinition,
  SourceRunOutcome,
  SourceRunResult,
  SourceRunStatus,
  SourceSentinelReport,
} from "./types";

export class CollectionTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollectionTimeoutError";
  }
}

/** Rejects with `CollectionTimeoutError` if `promise` outlives `timeoutMs`. */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new CollectionTimeoutError(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface RunCollectionSourceOptions {
  /** Identifies this scheduler tick; makes duplicate delivery a no-op. */
  invocationId: string;
  trigger: string;
  repository?: OrchestrationRepository;
  sentinelRepository?: SentinelRepository;
  healer?: SentinelHealer;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Ignore cadence and run anyway. Never ignores the lease. */
  force?: boolean;
  /** Lease lifetime; defaults to the source timeout budget plus headroom. */
  leaseMs?: number;
  /** Overrides the contract's own `autoHeal` flag in both directions. */
  autoHealOverride?: boolean;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function skipped(
  source: CollectionSourceDefinition,
  outcome: SourceRunOutcome,
  startedAt: string,
  nextExpectedRunAt: string | null,
  message: string,
): SourceRunResult {
  return {
    sourceKey: source.key,
    provider: source.provider,
    providerSlug: source.providerSlug,
    sourceType: source.sourceType,
    status: "skipped",
    outcome,
    attempts: 0,
    startedAt,
    completedAt: startedAt,
    durationMs: 0,
    orchestrationRunId: null,
    collectionRunId: null,
    externalRunId: null,
    recordsAccepted: 0,
    recordsRejected: 0,
    changesDetected: 0,
    sentinel: null,
    error: { code: outcome, message },
    nextExpectedRunAt,
  };
}

function failurePayload(
  source: CollectionSourceDefinition,
  startedAt: string,
  completedAt: string,
  message: string,
  timedOut: boolean,
): CollectorRunResult<unknown> {
  return {
    success: false,
    data: [],
    metadata: {
      collectorId: source.collectorId,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
      resultCount: 0,
      status: timedOut ? "timeout" : "failed",
      error: message,
    },
  };
}

/**
 * Runs one configured source end to end. Never throws: every failure mode is
 * reported as a result so a caller iterating the fleet cannot be derailed.
 */
export async function runCollectionSource(
  source: CollectionSourceDefinition,
  options: RunCollectionSourceOptions,
): Promise<SourceRunResult> {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? defaultSleep;
  const repository = options.repository ?? createOrchestrationRepository();
  const startedAt = now().toISOString();
  const startedMs = Date.now();
  const triggeredBy = `orchestrator:${options.trigger}`;

  if (!source.enabled) {
    return skipped(
      source,
      "skipped_disabled",
      startedAt,
      null,
      "Source is disabled by configuration",
    );
  }

  let lastAttemptAt: string | null = null;
  try {
    lastAttemptAt = (await repository.getLastAttempt(source.key))?.started_at ?? null;
  } catch (error) {
    return failedBeforeLease(source, startedAt, startedMs, now, error);
  }

  const schedule = evaluateSchedule(source, lastAttemptAt, now(), { force: options.force });
  if (!schedule.due) {
    return skipped(
      source,
      "skipped_not_due",
      startedAt,
      schedule.nextExpectedRunAt,
      `Not due until ${schedule.nextExpectedRunAt ?? "unknown"}`,
    );
  }

  const leaseMs = options.leaseMs ?? source.timeoutMs * source.retry.maxAttempts + 60_000;
  let lease;
  try {
    lease = await repository.acquireLease({
      sourceKey: source.key,
      providerSlug: source.providerSlug,
      sourceType: source.sourceType,
      trigger: options.trigger,
      invocationId: options.invocationId,
      leaseMs,
      startedAt,
    });
  } catch (error) {
    return failedBeforeLease(source, startedAt, startedMs, now, error);
  }

  if (!lease.acquired) {
    const outcome: SourceRunOutcome =
      lease.reason === "duplicate_invocation"
        ? "skipped_duplicate_invocation"
        : "skipped_locked";
    return skipped(
      source,
      outcome,
      startedAt,
      computeNextRunAt(lastAttemptAt, source.schedule.cadenceMinutes),
      lease.reason === "duplicate_invocation"
        ? `Invocation ${options.invocationId} already ran this source`
        : "Another execution of this source is already in flight",
    );
  }

  const orchestrationRunId = lease.run.id;
  let attempts = 0;
  let status: SourceRunStatus = "failed";
  let outcome: SourceRunOutcome = "collector_failed";
  let collectionRunId: string | null = null;
  let externalRunId: string | null = null;
  let recordsAccepted = 0;
  let recordsRejected = 0;
  let changesDetected = 0;
  let sentinelReport: SourceSentinelReport | null = null;
  let error: { code: string; message: string } | null = null;

  try {
    // --- collector: bounded retries, per-attempt timeout ------------------
    let payload: CollectorRunResult<unknown> | null = null;
    let collectorFailure:
      | { code: "collector_error" | "collector_timeout"; message: string }
      | null = null;

    while (attempts < source.retry.maxAttempts) {
      attempts += 1;
      collectorFailure = null;
      try {
        const collected = await withTimeout(
          source.collect(),
          source.timeoutMs,
          `${source.key} collector exceeded its ${source.timeoutMs}ms budget`,
        );
        payload = collected;
        if (collected.success) break;
        collectorFailure = {
          code: "collector_error",
          message:
            collected.metadata.error ??
            collected.error?.message ??
            "Bright Data collection reported failure",
        };
      } catch (collectError) {
        payload = null;
        collectorFailure = {
          code:
            collectError instanceof CollectionTimeoutError
              ? "collector_timeout"
              : "collector_error",
          message: collectError instanceof Error ? collectError.message : String(collectError),
        };
      }

      const retryable = source.retry.retryOn.includes(collectorFailure.code);
      if (!retryable || attempts >= source.retry.maxAttempts) break;
      await sleep(computeBackoffMs(source.retry, attempts));
    }

    const effectivePayload =
      collectorFailure === null && payload !== null
        ? payload
        : failurePayload(
            source,
            startedAt,
            now().toISOString(),
            collectorFailure?.message ?? "Bright Data collection failed",
            collectorFailure?.code === "collector_timeout",
          );
    externalRunId = effectivePayload.metadata.runId ?? null;

    // --- ingestion: the pipeline gates on Sentinel before it persists -----
    const ingestion = await ingestThroughPipeline(source, effectivePayload, {
      triggeredBy,
      sentinelRepository: options.sentinelRepository,
    });

    if (ingestion.kind === "persisted") {
      collectionRunId = ingestion.result.collectionRunId;
      externalRunId = ingestion.result.externalRunId ?? externalRunId;
      recordsAccepted = ingestion.result.acceptedCount;
      recordsRejected = ingestion.result.rejectedCount;
      changesDetected = ingestion.result.changesDetected;
      status = "succeeded";
      outcome = ingestion.result.idempotent ? "already_processed" : "completed";
      sentinelReport = ingestion.result.sentinel
        ? {
            status: ingestion.result.sentinel.status,
            quarantined: false,
            incidentId: null,
            reasonCodes: ingestion.result.sentinel.reasonCodes,
            healingAttempted: false,
            healingOutcome: null,
            lastKnownGoodPreserved: true,
            summary: ingestion.result.sentinel.summary,
          }
        : null;
    } else if (ingestion.kind === "quarantined") {
      const quarantine = ingestion.error;
      collectionRunId = quarantine.collectionRunId ?? null;
      externalRunId = quarantine.externalRunId ?? externalRunId;
      recordsRejected = quarantine.recordsInvalid;
      sentinelReport = {
        status: "quarantined",
        quarantined: true,
        incidentId: quarantine.incidentId,
        reasonCodes: quarantine.reasonCodes,
        healingAttempted: false,
        healingOutcome: null,
        lastKnownGoodPreserved: true,
        summary: quarantine.message,
      };

      // --- bounded self-healing, then a full re-entry through the gate ---
      const healed = await healAndRetry(source, quarantine, {
        triggeredBy,
        sentinelRepository: options.sentinelRepository,
        healer: options.healer,
        autoHealOverride: options.autoHealOverride,
        evaluationRecordsSeen: quarantine.recordsSeen,
        payload: effectivePayload,
      });

      if (healed) {
        sentinelReport.healingAttempted = true;
        sentinelReport.healingOutcome = healed.outcome;
        if (healed.result) {
          collectionRunId = healed.result.collectionRunId;
          externalRunId = healed.result.externalRunId ?? externalRunId;
          recordsAccepted = healed.result.acceptedCount;
          recordsRejected = healed.result.rejectedCount;
          changesDetected = healed.result.changesDetected;
          sentinelReport.status = "recovered";
          sentinelReport.quarantined = false;
        }
      }

      if (sentinelReport.quarantined) {
        // A collector that never delivered is a failure; a collector that
        // delivered anomalous data is a quarantine. Both stopped canonical
        // writes, but they need different operator responses.
        if (collectorFailure) {
          status = "failed";
          outcome =
            collectorFailure.code === "collector_timeout" ? "timed_out" : "collector_failed";
        } else {
          status = "quarantined";
          outcome = "quarantined";
        }
        error = { code: outcome, message: collectorFailure?.message ?? quarantine.message };
      } else {
        status = "succeeded";
        outcome = "healed";
      }
    } else {
      collectionRunId = ingestion.error.collectionRunId ?? null;
      externalRunId = ingestion.error.externalRunId ?? externalRunId;
      status = "failed";
      outcome = "persistence_failed";
      error = { code: outcome, message: ingestion.error.message };
    }
  } catch (thrown) {
    status = "failed";
    outcome = thrown instanceof CollectionTimeoutError ? "timed_out" : "persistence_failed";
    error = {
      code: outcome,
      message: thrown instanceof Error ? thrown.message : String(thrown),
    };
  }

  const completedAt = now().toISOString();
  const durationMs = Math.max(0, Date.now() - startedMs);

  try {
    await repository.completeRun(orchestrationRunId, {
      status,
      outcome,
      attemptCount: attempts,
      completedAt,
      durationMs,
      collectionRunId,
      externalRunId,
      sentinelIncidentId: sentinelReport?.incidentId ?? null,
      recordsAccepted,
      recordsRejected,
      changesDetected,
      reasonCodes: sentinelReport?.reasonCodes ?? [],
      errorMessage: error?.message ?? null,
    });
  } catch (releaseError) {
    // The lease expires on its own, so a reporting failure degrades the read
    // model rather than wedging the source.
    error ??= {
      code: "run_reporting_failed",
      message: releaseError instanceof Error ? releaseError.message : String(releaseError),
    };
  }

  return {
    sourceKey: source.key,
    provider: source.provider,
    providerSlug: source.providerSlug,
    sourceType: source.sourceType,
    status,
    outcome,
    attempts,
    startedAt,
    completedAt,
    durationMs,
    orchestrationRunId,
    collectionRunId,
    externalRunId,
    recordsAccepted,
    recordsRejected,
    changesDetected,
    sentinel: sentinelReport,
    error,
    nextExpectedRunAt: computeNextRunAt(startedAt, source.schedule.cadenceMinutes),
  };
}

type IngestionAttempt =
  | { kind: "persisted"; result: OpenAiPricingIngestionResult }
  | { kind: "quarantined"; error: SentinelQuarantineError }
  | { kind: "failed"; error: PricingIngestionError };

/** Hands the payload to the pipeline and classifies how it came back. */
async function ingestThroughPipeline(
  source: CollectionSourceDefinition,
  payload: CollectorRunResult<unknown>,
  context: { triggeredBy: string; sentinelRepository?: SentinelRepository },
): Promise<IngestionAttempt> {
  try {
    return { kind: "persisted", result: await source.persist(payload, context) };
  } catch (thrown) {
    if (thrown instanceof SentinelQuarantineError) return { kind: "quarantined", error: thrown };
    if (thrown instanceof PricingIngestionError) return { kind: "failed", error: thrown };
    throw thrown;
  }
}

interface HealOutcome {
  outcome: string;
  result: OpenAiPricingIngestionResult | null;
}

/**
 * One bounded healing attempt. A validated candidate is re-submitted through
 * the same pipeline, so it has to pass the Sentinel gate on its own merits
 * before anything is persisted — healing is not a bypass.
 */
async function healAndRetry(
  source: CollectionSourceDefinition,
  quarantine: SentinelQuarantineError,
  context: {
    triggeredBy: string;
    sentinelRepository?: SentinelRepository;
    healer?: SentinelHealer;
    autoHealOverride?: boolean;
    evaluationRecordsSeen: number;
    payload: CollectorRunResult<unknown>;
  },
): Promise<HealOutcome | null> {
  const contract = source.createHealthContract(quarantine.sourceId);
  const autoHeal = context.autoHealOverride ?? contract.failurePolicy.autoHeal;
  if (!autoHeal || !source.collectorId) return null;

  const repository = context.sentinelRepository ?? createSentinelRepository();
  const healer = context.healer ?? new BrightDataScraperHealer();

  const healing = await attemptSentinelHealing({
    incidentId: quarantine.incidentId,
    sourceId: quarantine.sourceId,
    collectorId: source.collectorId,
    sourceUrl: source.sourceUrl,
    providerName: source.provider,
    contract,
    evaluation: {
      status: "quarantined",
      isHealthy: false,
      shouldQuarantine: true,
      reasonCodes: quarantine.reasonCodes,
      summary: quarantine.message,
      recordsSeen: quarantine.recordsSeen,
      recordsValid: quarantine.recordsValid,
      recordsInvalid: quarantine.recordsInvalid,
      validRecords: [],
      invalidRecords: [],
      issues: quarantine.reasonCodes.map((code) => ({ code, message: quarantine.message })),
    },
    repository,
    healer,
  });

  if (healing.status !== "healed") {
    return { outcome: `healing_${healing.status}`, result: null };
  }

  const candidatePayload: CollectorRunResult<unknown> = {
    success: true,
    data: healing.candidateData as unknown[],
    metadata: {
      ...context.payload.metadata,
      resultCount: healing.candidateData.length,
      status: "success",
    },
  };

  const retry = await ingestThroughPipeline(source, candidatePayload, {
    triggeredBy: `${context.triggeredBy}:healed`,
    sentinelRepository: context.sentinelRepository,
  });
  if (retry.kind === "persisted") {
    return { outcome: "healed_and_recovered", result: retry.result };
  }
  return {
    outcome: retry.kind === "quarantined" ? "healed_candidate_rejected" : "healed_persist_failed",
    result: null,
  };
}

function failedBeforeLease(
  source: CollectionSourceDefinition,
  startedAt: string,
  startedMs: number,
  now: () => Date,
  thrown: unknown,
): SourceRunResult {
  const completedAt = now().toISOString();
  return {
    sourceKey: source.key,
    provider: source.provider,
    providerSlug: source.providerSlug,
    sourceType: source.sourceType,
    status: "failed",
    outcome: "persistence_failed",
    attempts: 0,
    startedAt,
    completedAt,
    durationMs: Math.max(0, Date.now() - startedMs),
    orchestrationRunId: null,
    collectionRunId: null,
    externalRunId: null,
    recordsAccepted: 0,
    recordsRejected: 0,
    changesDetected: 0,
    sentinel: null,
    error: {
      code: "orchestration_state_unavailable",
      message: thrown instanceof Error ? thrown.message : String(thrown),
    },
    nextExpectedRunAt: null,
  };
}
