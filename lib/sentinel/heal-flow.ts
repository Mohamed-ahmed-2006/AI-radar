/**
 * Sentinel healing flow — one implementation, shared by every caller that
 * responds to a quarantine.
 *
 * The healed candidate is applied through the caller's own ingestion path, so
 * it is re-validated on the way in. Healing repairs a collector; it is never a
 * way around the gate.
 */

import { generateHealingPrompt, type SentinelHealer } from "./healing";
import type { SentinelRepository } from "./repository";
import { getNextIncidentStatus } from "./state-machine";
import type {
  SentinelEvaluationResult,
  SentinelIncidentStatus,
  SourceHealthContract,
} from "./types";

export interface SentinelCandidateApplication {
  acceptedCount: number;
  rejectedCount: number;
  changesDetected: number;
}

export interface SentinelHealingFlowInput<T = unknown> {
  incidentId: string;
  sourceId: string;
  collectorId: string;
  sourceUrl: string;
  providerName: string;
  contract: SourceHealthContract<T>;
  evaluation: SentinelEvaluationResult<T>;
  repository: SentinelRepository;
  healer: SentinelHealer;
  attemptNumber?: number;
  /** Bounded by `contract.failurePolicy.maxHealingAttempts` unless overridden. */
  maxAttempts?: number;
  /**
   * Applies a validated candidate. Supplying it makes the attempt succeed only
   * when the candidate actually lands, and resolves the incident when it does.
   */
  applyCandidate?: (candidate: T[]) => Promise<SentinelCandidateApplication>;
  /** Timestamp used when resolving the incident. */
  resolvedAt?: string;
}

export type SentinelHealingFlowResult<T = unknown> =
  | {
      status: "healed";
      candidateData: T[];
      applied: SentinelCandidateApplication | null;
      prompt: string;
      attemptNumber: number;
    }
  | {
      status: "rejected" | "failed" | "exhausted";
      error: string;
      prompt: string;
      attemptNumber: number;
      incidentStatus: SentinelIncidentStatus;
    };

/**
 * Runs one bounded healing attempt against Scraper Studio and records the
 * audit trail. Never loops: whether another attempt is worth making is the
 * caller's decision on the next scheduled run.
 */
export async function attemptSentinelHealing<T = unknown>(
  input: SentinelHealingFlowInput<T>,
): Promise<SentinelHealingFlowResult<T>> {
  const attemptNumber = input.attemptNumber ?? 1;
  const maxAttempts = input.maxAttempts ?? input.contract.failurePolicy.maxHealingAttempts;
  const prompt = generateHealingPrompt(input.evaluation, {
    sourceUrl: input.sourceUrl,
    providerName: input.providerName,
    collectorId: input.collectorId,
  });

  if (attemptNumber > maxAttempts) {
    const incidentStatus = getNextIncidentStatus("open", "max_retries_exceeded");
    await input.repository.updateIncident(input.incidentId, {
      status: incidentStatus,
      resolutionNote: `Healing budget exhausted after ${maxAttempts} attempts.`,
    });
    return {
      status: "exhausted",
      error: `Healing budget exhausted after ${maxAttempts} attempts`,
      prompt,
      attemptNumber,
      incidentStatus,
    };
  }

  await input.repository.updateIncident(input.incidentId, {
    status: "healing",
    healingAttemptCount: attemptNumber,
  });
  await input.repository.recordHealingAttempt({
    incidentId: input.incidentId,
    sourceId: input.sourceId,
    collectorId: input.collectorId,
    attemptNumber,
    prompt,
    status: "initiated",
    startedAt: new Date().toISOString(),
  });

  const recordFailure = async (
    status: "candidate_rejected" | "failed",
    error: string,
    incidentStatus: SentinelIncidentStatus,
    note: string,
  ) => {
    await input.repository.recordHealingAttempt({
      incidentId: input.incidentId,
      sourceId: input.sourceId,
      collectorId: input.collectorId,
      attemptNumber,
      prompt,
      status,
      candidatePassedValidation: false,
      errorMessage: error,
      completedAt: new Date().toISOString(),
    });
    await input.repository.updateIncident(input.incidentId, {
      status: incidentStatus,
      resolutionNote: note,
    });
  };

  try {
    const healResult = await input.healer.healScraper<T>(
      { collectorId: input.collectorId, prompt, sourceUrl: input.sourceUrl },
      input.contract,
    );

    if (!healResult.success || !healResult.candidateData || healResult.candidateData.length === 0) {
      const error = healResult.error ?? "Healed candidate failed Sentinel contract checks";
      // A candidate that fails validation ends the automated cycle: the
      // collector needs a human before it is trusted again.
      const incidentStatus = getNextIncidentStatus("open", "max_retries_exceeded");
      await recordFailure(
        healResult.status === "rejected" ? "candidate_rejected" : "failed",
        error,
        incidentStatus,
        `Self-healing attempt ${attemptNumber} failed validation: ${error}`,
      );
      return {
        status: healResult.status === "rejected" ? "rejected" : "failed",
        error,
        prompt,
        attemptNumber,
        incidentStatus,
      };
    }

    const candidateData = healResult.candidateData;
    if (!input.applyCandidate) {
      await input.repository.recordHealingAttempt({
        incidentId: input.incidentId,
        sourceId: input.sourceId,
        collectorId: input.collectorId,
        attemptNumber,
        prompt,
        status: "candidate_validated",
        candidateRecordsCount: candidateData.length,
        candidatePassedValidation: true,
        completedAt: new Date().toISOString(),
      });
      return { status: "healed", candidateData, applied: null, prompt, attemptNumber };
    }

    let applied: SentinelCandidateApplication;
    try {
      applied = await input.applyCandidate(candidateData);
    } catch (applyError) {
      const error = applyError instanceof Error ? applyError.message : String(applyError);
      await recordFailure(
        "candidate_rejected",
        error,
        getNextIncidentStatus("open", "max_retries_exceeded"),
        `Self-healing candidate was refused on re-ingestion: ${error}`,
      );
      return {
        status: "rejected",
        error,
        prompt,
        attemptNumber,
        incidentStatus: "needs_review",
      };
    }

    await input.repository.recordHealingAttempt({
      incidentId: input.incidentId,
      sourceId: input.sourceId,
      collectorId: input.collectorId,
      attemptNumber,
      prompt,
      status: "approved",
      candidateRecordsCount: candidateData.length,
      candidatePassedValidation: true,
      completedAt: new Date().toISOString(),
    });
    await input.repository.updateIncident(input.incidentId, {
      status: "resolved",
      resolutionNote: `Autonomous self-healing completed: repaired collector validated and ingested ${applied.acceptedCount} records.`,
      resolvedAt: input.resolvedAt ?? new Date().toISOString(),
    });
    return { status: "healed", candidateData, applied, prompt, attemptNumber };
  } catch (thrown) {
    const error = thrown instanceof Error ? thrown.message : String(thrown);
    await recordFailure("failed", error, "needs_review", `Self-healing error: ${error}`);
    return {
      status: "failed",
      error,
      prompt,
      attemptNumber,
      incidentStatus: "needs_review",
    };
  }
}
