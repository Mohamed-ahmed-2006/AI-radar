/**
 * The historical recovery replay, assembled from rows that already exist.
 *
 * This module is a read. It runs no collector, requests no refactor, spends no
 * Bright Data quota and writes nothing: every function here takes rows that
 * were persisted when the recovery actually happened and reshapes them into one
 * coherent story. There is no code path from this file to the orchestrator.
 *
 * Two rules govern what it may say:
 *
 *   * a stage exists only when a row exists behind it. A missing incident, a
 *     missing run or a missing healing attempt removes the stage rather than
 *     producing an empty one, so the replay can never be longer than the
 *     evidence.
 *   * a claim is *derived*, never asserted. "Zero bad canonical writes" is the
 *     canonical row count of the refused run read back from the database, and
 *     it is false the moment that count is unknown. The same applies to the
 *     preserved baseline and to the same-collector confirmation.
 *
 * The one deliberate exception is the layout stage, which describes the demo's
 * fixed public setup rather than a recorded event. It is marked `kind:
 * "context"` precisely so nothing downstream can present configuration as an
 * observation.
 */

import {
  HEALING_DEMO_RECOVERY_PROOF_NOTE,
  HEALING_DEMO_RECOVERY_STAGE_IDS,
  HEALING_DEMO_RECOVERY_STAGE_LABELS,
  unavailableHealingDemoRecoveryProof,
  type HealingDemoRecoveryEvidenceItem,
  type HealingDemoRecoveryFinalState,
  type HealingDemoRecoveryProof,
  type HealingDemoRecoveryStage,
  type HealingDemoRecoveryStageId,
  type HealingDemoRecoveryStageKind,
} from "../product/healing-demo";
import type { SentinelIncidentStatus } from "../sentinel/types";
import type {
  CollectionRunRow,
  SentinelHealingAttemptRow,
  SentinelIncidentRow,
} from "../supabase/types";
import type { DemoQuarantinePayloadReference } from "./repository";
import type { DemoSourceConfiguration } from "./source";

/** The two reads the proof needs beyond the rows it is handed. */
export interface DemoRecoveryEvidencePort {
  countCanonicalRecordsForRun(runId: string): Promise<number>;
  getQuarantinePayloadForIncident(
    incidentId: string,
  ): Promise<DemoQuarantinePayloadReference | null>;
}

export interface BuildDemoRecoveryProofInput {
  /** Runs for the demo source, in any order. Not mutated. */
  runs: readonly CollectionRunRow[];
  incidents: readonly SentinelIncidentRow[];
  attempts: readonly SentinelHealingAttemptRow[];
  configuration: DemoSourceConfiguration;
  /** `sources.collector_id` as persisted, not as configured. */
  sourceCollectorId: string | null;
  /** False when any dependency behind the recorded evidence was a double. */
  isLiveEvidence: boolean;
  evidence: DemoRecoveryEvidencePort;
}

const NO_RESOLVED_INCIDENT =
  "No resolved Sentinel incident is on file for the demo source, so there is no "
  + "completed recovery to replay.";

function shortRef(id: string | null | undefined): string {
  if (!id) return "unknown";
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function ascendingByStart(
  left: { started_at: string },
  right: { started_at: string },
): number {
  return left.started_at.localeCompare(right.started_at);
}

/**
 * The incident whose recovery is being replayed.
 *
 * The newest incident that actually reached `resolved`. An open or healing
 * incident is not a recovery and is never picked, which is what keeps a live
 * failure from being replayed as a success.
 */
export function selectRecoveryIncident(
  incidents: readonly SentinelIncidentRow[],
): SentinelIncidentRow | null {
  const resolved = incidents.filter(
    (incident) => incident.status === "resolved" && incident.resolved_at !== null,
  );
  if (resolved.length === 0) return null;
  return [...resolved].sort((left, right) =>
    (right.resolved_at ?? "").localeCompare(left.resolved_at ?? ""),
  )[0];
}

/**
 * The verifying re-run, if one happened.
 *
 * The earliest accepted run that started after the incident was resolved, which
 * is the run that exercised the repaired template through the same gate. A
 * later baseline from a subsequent rehearsal is therefore never mistaken for
 * the recovery, and neither is the baseline that preceded the failure.
 */
export function selectRecoveryRun(
  runs: readonly CollectionRunRow[],
  incident: SentinelIncidentRow,
  excludeRunIds: readonly (string | null)[],
): CollectionRunRow | null {
  const resolvedAt = incident.resolved_at;
  if (!resolvedAt) return null;
  const excluded = new Set(excludeRunIds.filter((id): id is string => id !== null));
  const candidates = runs
    .filter(
      (run) =>
        !excluded.has(run.id) &&
        (run.status === "succeeded" || run.status === "partial") &&
        run.records_accepted > 0 &&
        run.started_at.localeCompare(resolvedAt) >= 0,
    )
    .sort(ascendingByStart);
  return candidates[0] ?? null;
}

interface StageDraft {
  id: HealingDemoRecoveryStageId;
  kind?: HealingDemoRecoveryStageKind;
  at: string | null;
  summary: string;
  evidence: HealingDemoRecoveryEvidenceItem[];
}

function toStage(draft: StageDraft): HealingDemoRecoveryStage {
  return {
    id: draft.id,
    order: HEALING_DEMO_RECOVERY_STAGE_IDS.indexOf(draft.id),
    kind: draft.kind ?? "observed",
    title: HEALING_DEMO_RECOVERY_STAGE_LABELS[draft.id],
    at: draft.at,
    summary: draft.summary,
    evidence: draft.evidence,
  };
}

/**
 * Builds the replay.
 *
 * Every await in here is a `SELECT`. The function returns an unavailable proof
 * rather than throwing when the evidence is not there, because a demo page that
 * has never been run should say so plainly instead of failing.
 */
export async function buildDemoRecoveryProof(
  input: BuildDemoRecoveryProofInput,
): Promise<HealingDemoRecoveryProof> {
  const incident = selectRecoveryIncident(input.incidents);
  if (!incident) return unavailableHealingDemoRecoveryProof(NO_RESOLVED_INCIDENT);

  const runById = new Map(input.runs.map((run) => [run.id, run]));
  const invalidRunId = incident.run_id;
  const invalidRun = invalidRunId ? (runById.get(invalidRunId) ?? null) : null;

  const baselineRunId = incident.last_known_good_run_id;
  const baselineRun = baselineRunId ? (runById.get(baselineRunId) ?? null) : null;

  const recoveryRun = selectRecoveryRun(input.runs, incident, [
    invalidRunId,
    baselineRunId,
  ]);

  const attempts = input.attempts
    .filter((attempt) => attempt.incident_id === incident.id)
    .slice()
    .sort(ascendingByStart);

  const repairAttempt =
    attempts.find((attempt) => attempt.refactor_job_id !== null) ?? attempts[0] ?? null;
  const candidateAttempt =
    attempts.find((attempt) => attempt.candidate_passed_validation === true) ??
    attempts.find((attempt) => attempt.candidate_records_count !== null) ??
    null;
  const approvedAttempt =
    attempts.find((attempt) => attempt.status === "approved") ?? null;

  const [quarantine, baselineCanonical, invalidCanonical, recoveryCanonical] =
    await Promise.all([
      input.evidence.getQuarantinePayloadForIncident(incident.id),
      baselineRunId ? input.evidence.countCanonicalRecordsForRun(baselineRunId) : null,
      invalidRunId ? input.evidence.countCanonicalRecordsForRun(invalidRunId) : null,
      recoveryRun ? input.evidence.countCanonicalRecordsForRun(recoveryRun.id) : null,
    ]);

  // --- derived claims -------------------------------------------------------

  // The refused run is only credited with zero canonical writes when the
  // database was actually asked how many rows carry its id. An unknown run id
  // yields `false`, never an optimistic `true`.
  const zeroBadCanonicalWrites = invalidRunId !== null && invalidCanonical === 0;

  const recordedBaselineCount = incident.last_known_good_count;
  const lastKnownGoodPreserved =
    baselineRunId !== null &&
    baselineCanonical !== null &&
    baselineCanonical > 0 &&
    (recordedBaselineCount === null || baselineCanonical >= recordedBaselineCount);
  const lastKnownGoodEvidence = lastKnownGoodPreserved
    ? `Baseline run ${shortRef(baselineRunId)} held `
      + `${plural(recordedBaselineCount ?? baselineCanonical ?? 0, "record")} when the `
      + `incident opened and still holds ${plural(baselineCanonical ?? 0, "canonical row")}.`
    : baselineRunId === null
      ? "The incident recorded no last-known-good run, so preservation cannot be derived."
      : `Baseline run ${shortRef(baselineRunId)} no longer holds the canonical rows it `
        + "was credited with.";

  const attemptCollectorIds = new Set(
    attempts
      .map((attempt) => attempt.collector_id)
      .filter((id): id is string => id !== null),
  );
  const repairCollectorId =
    attemptCollectorIds.size === 1 ? [...attemptCollectorIds][0] : null;
  const sameCollectorConfirmed =
    attempts.length > 0 &&
    repairCollectorId !== null &&
    attempts.every((attempt) => attempt.collector_id === repairCollectorId) &&
    input.sourceCollectorId !== null &&
    input.sourceCollectorId === repairCollectorId &&
    repairCollectorId === input.configuration.collectorId;
  const sameCollectorEvidence = sameCollectorConfirmed
    ? `All ${plural(attempts.length, "healing attempt")} recorded collector `
      + `${repairCollectorId}, which is the collector the recovered source is `
      + "registered against."
    : repairCollectorId === null
      ? "The healing attempts did not all record the same collector, so the repair "
        + "cannot be tied to one collector."
      : "The repaired collector does not match the collector the source is "
        + "registered against.";

  const distinctRunIds =
    baselineRunId !== null &&
    invalidRunId !== null &&
    recoveryRun !== null &&
    new Set([baselineRunId, invalidRunId, recoveryRun.id]).size === 3;

  const finalState: HealingDemoRecoveryFinalState = recoveryRun
    ? "recovered"
    : "approved_awaiting_rerun";
  const recoveredAt = recoveryRun
    ? (recoveryRun.completed_at ?? recoveryRun.started_at)
    : null;

  // --- stages ---------------------------------------------------------------

  const stages: HealingDemoRecoveryStage[] = [];

  if (baselineRun) {
    stages.push(
      toStage({
        id: "trusted_baseline",
        at: baselineRun.completed_at ?? baselineRun.started_at,
        summary:
          `The collector ran against the layout its extraction template was built `
          + `against and Sentinel accepted every record.`,
        evidence: [
          { label: "Baseline run", value: baselineRun.id },
          { label: "Records seen", value: String(baselineRun.records_seen) },
          { label: "Records accepted", value: String(baselineRun.records_accepted) },
          ...(baselineCanonical !== null
            ? [{ label: "Canonical rows written", value: String(baselineCanonical) }]
            : []),
        ],
      }),
    );
  }

  const layouts = input.configuration.layouts;
  if (invalidRun && layouts.healthy.url && layouts.broken.url) {
    stages.push(
      toStage({
        id: "source_layout_changed",
        kind: "context",
        at: null,
        summary:
          "The demo source publishes the same records under two layouts: the one the "
          + "extraction template was generated against, and the same records re-rendered "
          + "as a table, which invalidates the template's selectors. Which layout a past "
          + "run targeted is not stored on the run row, so this stage is the "
          + "demonstration's published setup rather than a recorded observation.",
        evidence: [
          { label: "Healthy layout", value: layouts.healthy.url },
          { label: "Changed layout", value: layouts.broken.url },
        ],
      }),
    );
  }

  if (invalidRun) {
    stages.push(
      toStage({
        id: "invalid_extraction",
        at: invalidRun.completed_at ?? invalidRun.started_at,
        summary:
          "The same collector ran and returned an extraction the contract could not "
          + "accept.",
        evidence: [
          { label: "Run", value: invalidRun.id },
          { label: "Run status", value: invalidRun.status },
          { label: "Records seen", value: String(invalidRun.records_seen) },
          { label: "Records accepted", value: String(invalidRun.records_accepted) },
          ...(invalidRun.error_message
            ? [{ label: "Collector error", value: invalidRun.error_message }]
            : []),
        ],
      }),
    );
  }

  stages.push(
    toStage({
      id: "sentinel_detected",
      at: incident.created_at,
      summary:
        incident.summary
        ?? "Sentinel evaluated the payload against the source contract and refused it.",
      evidence: [
        { label: "Incident", value: incident.id },
        { label: "Severity", value: incident.severity },
        {
          label: "Reason codes",
          value: incident.reason_codes.join(" · ") || "contract violation",
        },
        { label: "Records seen", value: String(incident.records_seen) },
        { label: "Records valid", value: String(incident.records_valid) },
        ...(incident.expected_count !== null
          ? [{ label: "Expected records", value: String(incident.expected_count) }]
          : []),
      ],
    }),
  );

  if (quarantine) {
    stages.push(
      toStage({
        id: "quarantined",
        at: quarantine.createdAt,
        summary:
          "The refused payload was isolated against the incident so healing and review "
          + "had the evidence, and no part of it reached a canonical table.",
        evidence: [
          { label: "Quarantine record", value: quarantine.id },
          ...(quarantine.runId
            ? [{ label: "Quarantined run", value: quarantine.runId }]
            : []),
          ...(invalidCanonical !== null
            ? [
                {
                  label: "Canonical writes from this run",
                  value: String(invalidCanonical),
                },
              ]
            : []),
        ],
      }),
    );
  }

  if (baselineRunId && baselineCanonical !== null) {
    stages.push(
      toStage({
        id: "last_known_good_preserved",
        at: incident.last_known_good_at ?? incident.created_at,
        summary: lastKnownGoodPreserved
          ? "The previous trusted run stayed the newest accepted run throughout the "
            + "incident, so the canonical store kept serving it."
          : "The recorded last-known-good baseline could not be confirmed intact.",
        evidence: [
          { label: "Last-known-good run", value: baselineRunId },
          ...(recordedBaselineCount !== null
            ? [
                {
                  label: "Records at incident time",
                  value: String(recordedBaselineCount),
                },
              ]
            : []),
          { label: "Canonical rows today", value: String(baselineCanonical) },
        ],
      }),
    );
  }

  if (repairAttempt) {
    stages.push(
      toStage({
        id: "bright_data_repair",
        at: repairAttempt.started_at,
        summary:
          "Bright Data was asked to refactor the extraction on the same dedicated "
          + "collector. No production collector was involved.",
        evidence: [
          { label: "Healing attempt", value: repairAttempt.id },
          { label: "Attempt number", value: String(repairAttempt.attempt_number) },
          ...(repairAttempt.collector_id
            ? [{ label: "Collector", value: repairAttempt.collector_id }]
            : []),
          ...(repairAttempt.refactor_job_id
            ? [{ label: "Refactor job", value: repairAttempt.refactor_job_id }]
            : []),
        ],
      }),
    );
  }

  if (candidateAttempt && candidateAttempt.candidate_records_count !== null) {
    stages.push(
      toStage({
        id: "candidate_validated",
        at: candidateAttempt.completed_at ?? candidateAttempt.started_at,
        summary:
          candidateAttempt.candidate_passed_validation === true
            ? "The repaired candidate was judged by the same contract that refused the "
              + "original payload, and passed."
            : "The repaired candidate was judged by the same contract and did not pass.",
        evidence: [
          { label: "Healing attempt", value: candidateAttempt.id },
          {
            label: "Preview records",
            value: String(candidateAttempt.candidate_records_count),
          },
          {
            label: "Contract verdict",
            value:
              candidateAttempt.candidate_passed_validation === true
                ? "passed"
                : candidateAttempt.candidate_passed_validation === false
                  ? "failed"
                  : "not recorded",
          },
          { label: "Attempt status", value: candidateAttempt.status },
        ],
      }),
    );
  }

  if (approvedAttempt || incident.resolved_at) {
    const approvedAt = approvedAttempt?.completed_at ?? incident.resolved_at;
    stages.push(
      toStage({
        id: "approved",
        at: approvedAt,
        summary:
          "The validated candidate was approved and saved to the collector, and the "
          + "incident was resolved.",
        evidence: [
          ...(approvedAttempt
            ? [
                { label: "Approved attempt", value: approvedAttempt.id },
                { label: "Attempt status", value: approvedAttempt.status },
              ]
            : []),
          { label: "Incident status", value: incident.status },
          ...(incident.resolved_at
            ? [{ label: "Resolved at", value: incident.resolved_at }]
            : []),
          ...(incident.resolution_note
            ? [{ label: "Resolution note", value: incident.resolution_note }]
            : []),
        ],
      }),
    );
  }

  if (recoveryRun) {
    stages.push(
      toStage({
        id: "recovery_rerun",
        at: recoveryRun.completed_at ?? recoveryRun.started_at,
        summary:
          "The repaired collector ran again — a separate run from the one that failed — "
          + "and went through the same gate.",
        evidence: [
          { label: "Recovery run", value: recoveryRun.id },
          { label: "Run status", value: recoveryRun.status },
          { label: "Records seen", value: String(recoveryRun.records_seen) },
          { label: "Records accepted", value: String(recoveryRun.records_accepted) },
          ...(invalidRunId
            ? [{ label: "Distinct from failed run", value: invalidRunId }]
            : []),
        ],
      }),
    );

    stages.push(
      toStage({
        id: "recovered",
        at: recoveredAt,
        summary:
          "Sentinel accepted the run and the source returned to serving trusted data.",
        evidence: [
          { label: "Final incident status", value: incident.status },
          ...(recoveryCanonical !== null
            ? [
                {
                  label: "Canonical rows from the recovery run",
                  value: String(recoveryCanonical),
                },
              ]
            : []),
          ...(recoveredAt ? [{ label: "Recovered at", value: recoveredAt }] : []),
        ],
      }),
    );
  }

  stages.sort((left, right) => left.order - right.order);

  return {
    available: true,
    unavailableReason: null,
    isHistorical: true,
    isLiveEvidence: input.isLiveEvidence,
    note: HEALING_DEMO_RECOVERY_PROOF_NOTE,
    title: `Verified recovery · ${input.configuration.label}`,
    recoveredAt,
    source: {
      label: input.configuration.label,
      healthyUrl: layouts.healthy.url || null,
      brokenUrl: layouts.broken.url || null,
    },
    collector: {
      ref: repairCollectorId ?? input.sourceCollectorId,
      sameCollectorConfirmed,
      sameCollectorEvidence,
      refactorJobId: repairAttempt?.refactor_job_id ?? null,
    },
    summary: {
      baselineRecords: baselineRun?.records_accepted ?? recordedBaselineCount,
      failedRecords: invalidRun?.records_accepted ?? incident.records_valid,
      recoveredRecords: recoveryRun?.records_accepted ?? null,
      lastKnownGoodPreserved,
      lastKnownGoodEvidence,
      zeroBadCanonicalWrites,
      canonicalWritesFromInvalidRun: invalidCanonical,
      reasonCodes: [...incident.reason_codes],
      finalState,
      incidentId: incident.id,
      incidentStatus: incident.status as SentinelIncidentStatus,
      baselineRunId,
      invalidRunId,
      recoveryRunId: recoveryRun?.id ?? null,
      distinctRunIds,
    },
    stages,
  };
}
