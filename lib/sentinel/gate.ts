/**
 * Sentinel Gate — the single point where a collector payload is admitted to,
 * or refused from, canonical persistence.
 *
 * Every real ingestion path calls this *between* the collector and the first
 * canonical write. It is not telemetry and it is not a post-hoc audit: an
 * unsafe payload returns `safe: false`, and the caller has nothing to persist.
 *
 * Responsibilities, in order:
 *   1. load the last-known-good baseline for the source
 *   2. run raw contract validation + deterministic health evaluation
 *   3. on anomaly: open an incident and isolate the raw payload in quarantine
 *   4. on health: resolve any incident the source had left open
 */

import { evaluateSourceHealth } from "./evaluator";
import { createSentinelRepository, type SentinelRepository } from "./repository";
import { deriveSentinelSeverity } from "./state-machine";
import type { SentinelIncidentRow } from "../supabase/types";
import type { SentinelEvaluationResult, SourceHealthContract } from "./types";

export interface SentinelGateSource {
  id: string;
  providerId: string;
  collectorId?: string | null;
  sourceUrl: string;
  label?: string | null;
}

export interface SentinelGateInput<T = unknown> {
  contract: SourceHealthContract<T>;
  source: SentinelGateSource;
  rawRecords: unknown[];
  /** Set when the collector itself failed; forces a quarantine decision. */
  collectorError?: Error | string | null;
  observedAt: string;
  /** Collection run the payload belongs to, when one exists yet. */
  runId?: string | null;
  repository?: SentinelRepository;
}

export type SentinelGateDecision<T = unknown> =
  | {
      safe: true;
      evaluation: SentinelEvaluationResult<T>;
      incident: null;
      resolvedIncidentId: string | null;
    }
  | {
      safe: false;
      evaluation: SentinelEvaluationResult<T>;
      incident: SentinelIncidentRow;
      resolvedIncidentId: null;
    };

/**
 * Evaluates a payload and records the consequences. Returns the decision; it
 * never persists canonical data and never lets the caller skip the check.
 */
export async function evaluateSentinelGate<T = unknown>(
  input: SentinelGateInput<T>,
): Promise<SentinelGateDecision<T>> {
  const repository = input.repository ?? createSentinelRepository();
  const baseline = await repository.getLastKnownGoodBaseline(input.source.id);

  const evaluation = evaluateSourceHealth<T>(
    input.rawRecords,
    input.contract,
    baseline,
    {
      collectorExecutionError: input.collectorError ?? null,
      observedAt: input.observedAt,
    },
  );

  if (!evaluation.shouldQuarantine && evaluation.isHealthy) {
    const openIncident = await repository.getLatestOpenIncident(input.source.id);
    let resolvedIncidentId: string | null = null;
    if (openIncident && openIncident.status !== "resolved") {
      const resolved = await repository.updateIncident(openIncident.id, {
        status: "resolved",
        resolutionNote: `Source restored to health. Validated ${evaluation.recordsValid} records.`,
        resolvedAt: input.observedAt,
      });
      resolvedIncidentId = resolved.id;
    }
    return { safe: true, evaluation, incident: null, resolvedIncidentId };
  }

  const incident = await repository.createIncident({
    sourceId: input.source.id,
    providerId: input.source.providerId,
    runId: input.runId ?? null,
    status: "open",
    severity: deriveSentinelSeverity(evaluation.reasonCodes),
    reasonCodes: evaluation.reasonCodes,
    summary: evaluation.summary,
    recordsSeen: evaluation.recordsSeen,
    recordsValid: evaluation.recordsValid,
    recordsInvalid: evaluation.recordsInvalid,
    expectedCount: baseline?.recordCount ?? input.contract.minViableRecords,
    lastKnownGoodCount: baseline?.recordCount ?? null,
    lastKnownGoodRunId: baseline?.runId ?? null,
    lastKnownGoodAt: baseline?.observedAt ?? null,
    healingAttemptCount: 0,
  });

  // The raw payload is isolated verbatim so healing and review have the
  // evidence, and so nothing malformed reaches a canonical table.
  await repository.saveQuarantinePayload({
    incidentId: incident.id,
    sourceId: input.source.id,
    runId: input.runId ?? null,
    rawPayload: input.rawRecords,
    validationErrors: evaluation.issues,
  });

  return { safe: false, evaluation, incident, resolvedIncidentId: null };
}
