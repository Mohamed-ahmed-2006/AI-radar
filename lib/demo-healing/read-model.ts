/**
 * Judge-facing read model for the self-healing demonstration.
 *
 * Assembled from the real tables — `collection_runs`, `sentinel_incidents`,
 * `sentinel_healing_attempts`, `demo_quote_snapshots` — plus the phase marker.
 * Nothing here is a fixture, and the `evidence.isLive` flag says plainly
 * whether the run it describes talked to Bright Data or to a double.
 *
 * Two shapes are produced. The public one is safe to render anywhere: it
 * carries no collector id, no prompts, no raw payloads and no diagnostics. The
 * authorized one adds operational detail for an operator holding the shared
 * secret.
 */

import type {
  CollectionRunRow,
  DemoBreakMode,
  DemoQuoteSnapshotRow,
  SentinelDemoApprovalState,
  SentinelDemoEventRow,
  SentinelDemoPhase,
  SentinelDemoStateRow,
  SentinelHealingAttemptRow,
  SentinelIncidentRow,
} from "../supabase/types";
import type { DemoHarnessRepository } from "./repository";
import {
  DEMO_PROVIDER_NAME,
  DEMO_SOURCE_KEY,
  DEMO_SOURCE_LABEL,
  type DemoLayout,
  type DemoSourceConfiguration,
} from "./source";
import type { DemoAction } from "./orchestrator";

export interface DemoRunSummary {
  runId: string;
  status: CollectionRunRow["status"];
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  recordsSeen: number;
  recordsAccepted: number;
  recordsRejected: number;
  canonicalRecordsWritten: number;
}

export interface DemoIncidentSummary {
  incidentId: string;
  status: SentinelIncidentRow["status"];
  severity: string;
  reasonCodes: string[];
  summary: string | null;
  recordsSeen: number;
  recordsValid: number;
  recordsInvalid: number;
  lastKnownGoodCount: number | null;
  lastKnownGoodAt: string | null;
  healingAttemptCount: number;
  createdAt: string;
  resolvedAt: string | null;
}

export interface DemoHealingSummary {
  attemptId: string;
  attemptNumber: number;
  status: SentinelHealingAttemptRow["status"];
  candidateRecordsCount: number | null;
  candidatePassedValidation: boolean | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
}

export interface DemoTimelineEntry {
  at: string;
  phase: SentinelDemoPhase;
  action: string;
  status: SentinelDemoEventRow["status"];
  summary: string;
}

export interface DemoPhaseDescriptor {
  phase: SentinelDemoPhase;
  /** One line a presenter can read aloud. */
  headline: string;
  /** Which actions are legal from here. */
  availableActions: DemoAction[];
}

/**
 * What this demo source has actually done, independent of the phase it is
 * currently parked in.
 *
 * Resetting the demonstration clears the phase marker and the event journal so
 * the next run starts from a clean stage, but it deliberately does not delete
 * the incidents, healing attempts and runs that recorded the previous recovery.
 * Those rows are the proof. Without them the screen has to describe a feature
 * that has genuinely completed a live recovery as though it had never run.
 *
 * Every field here is read from those tables. Nothing is asserted that the
 * database does not already record.
 */
export interface DemoHealingHistory {
  /** True once at least one incident on this source reached `resolved`. */
  hasCompletedRecovery: boolean;
  completedRecoveries: number;
  lastRecoveryAt: string | null;
  healingAttemptsRecorded: number;
  approvedHealingAttempts: number;
  /** Record count the last-known-good baseline held while quarantined. */
  lastKnownGoodCount: number | null;
  lastKnownGoodAt: string | null;
}

export interface DemoHealingReadModel {
  source: {
    sourceKey: typeof DEMO_SOURCE_KEY;
    providerName: typeof DEMO_PROVIDER_NAME;
    label: typeof DEMO_SOURCE_LABEL;
    /** Which of the two allowlisted layouts is currently targeted. */
    armedLayout: DemoLayout;
    layoutDescription: string;
    /** Which controlled failure mechanism is currently in play. */
    breakMode: DemoBreakMode;
    /** Present only for authorized callers. */
    collectorId?: string;
    sourceUrl?: string;
  };
  phase: DemoPhaseDescriptor;
  sentinel: {
    state: "healthy" | "quarantined" | "healing" | "recovered" | "needs_review" | "unknown";
    anomalyReason: string | null;
    reasonCodes: string[];
  };
  currentRun: DemoRunSummary | null;
  lastKnownGoodRun: DemoRunSummary | null;
  lastKnownGoodPreserved: boolean;
  canonicalRecordTotal: number;
  quarantine: {
    incident: DemoIncidentSummary | null;
    /** Canonical rows the refused run managed to write. Always 0. */
    canonicalWritesFromRefusedRun: number | null;
  };
  healing: {
    requestedAt: string | null;
    attempt: DemoHealingSummary | null;
    previewRecordsCount: number | null;
    previewValidationPassed: boolean | null;
    previewValidationSummary: string | null;
    previewReasonCodes: string[];
    approvalState: SentinelDemoApprovalState;
    approvedAt: string | null;
    /** Present only for authorized callers. */
    prompt?: string | null;
    refactorJobId?: string | null;
  };
  recovery: {
    recovered: boolean;
    recoveredRunId: string | null;
    recoveredAt: string | null;
  };
  history: DemoHealingHistory;
  timeline: DemoTimelineEntry[];
  evidence: {
    /** False when any Bright Data or Supabase dependency was a double. */
    isLive: boolean;
    canBreak: boolean;
    canReset: boolean;
    generatedAt: string;
  };
  latestRecords?: { author: string; quoteText: string; observedAt: string }[];
}

const PHASE_HEADLINES: Record<SentinelDemoPhase, string> = {
  unprepared: "No baseline yet. Run the healthy collection to establish last-known-good.",
  healthy: "Source healthy. Canonical data is current and a last-known-good run is on record.",
  failure_armed:
    "The page has been re-laid-out under the collector. Its extraction template has not been changed.",
  quarantined:
    "Sentinel refused the collector output and isolated it. Canonical data was not touched; last-known-good still serves.",
  healing: "Bright Data is refactoring the extraction template and has a candidate to judge.",
  preview_rejected:
    "The repaired candidate failed the same Sentinel contract. Approval is blocked.",
  preview_validated:
    "The repaired candidate passed the same Sentinel contract. It may now be approved.",
  approved: "Repaired template approved and saved. A verifying re-run is still required.",
  recovered:
    "Repaired collector re-ran through the same gate and was accepted. The source is healthy again.",
  needs_review: "Automated healing is exhausted or errored. The collector needs a human.",
};

const PHASE_ACTIONS: Record<SentinelDemoPhase, DemoAction[]> = {
  unprepared: ["run_baseline", "reset"],
  healthy: ["arm_failure", "break_template", "run_baseline", "reset"],
  failure_armed: ["run_broken", "reset"],
  quarantined: ["request_heal", "reset"],
  healing: ["validate_preview", "reset"],
  preview_rejected: ["request_heal", "reset"],
  preview_validated: ["approve", "reset"],
  approved: ["rerun", "reset"],
  recovered: ["reset", "arm_failure", "break_template"],
  needs_review: ["reset"],
};

function sentinelStateFor(phase: SentinelDemoPhase): DemoHealingReadModel["sentinel"]["state"] {
  switch (phase) {
    case "healthy":
    case "failure_armed":
      return "healthy";
    case "quarantined":
      return "quarantined";
    case "healing":
    case "preview_rejected":
    case "preview_validated":
    case "approved":
      return "healing";
    case "recovered":
      return "recovered";
    case "needs_review":
      return "needs_review";
    default:
      return "unknown";
  }
}

function durationMs(startedAt: string, completedAt: string | null): number | null {
  if (!completedAt) return null;
  const value = Date.parse(completedAt) - Date.parse(startedAt);
  return Number.isFinite(value) ? value : null;
}

function toRunSummary(row: CollectionRunRow, canonicalRecordsWritten: number): DemoRunSummary {
  return {
    runId: row.id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: durationMs(row.started_at, row.completed_at),
    recordsSeen: row.records_seen,
    recordsAccepted: row.records_accepted,
    recordsRejected: row.records_rejected,
    canonicalRecordsWritten,
  };
}

function toIncidentSummary(row: SentinelIncidentRow): DemoIncidentSummary {
  return {
    incidentId: row.id,
    status: row.status,
    severity: row.severity,
    reasonCodes: row.reason_codes,
    summary: row.summary,
    recordsSeen: row.records_seen,
    recordsValid: row.records_valid,
    recordsInvalid: row.records_invalid,
    lastKnownGoodCount: row.last_known_good_count,
    lastKnownGoodAt: row.last_known_good_at,
    healingAttemptCount: row.healing_attempt_count,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? null,
  };
}

function toHealingSummary(row: SentinelHealingAttemptRow): DemoHealingSummary {
  return {
    attemptId: row.id,
    attemptNumber: row.attempt_number,
    status: row.status,
    candidateRecordsCount: row.candidate_records_count,
    candidatePassedValidation: row.candidate_passed_validation,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: durationMs(row.started_at, row.completed_at),
  };
}

/**
 * Assembles the durable record from the incident and healing-attempt rows the
 * demonstration left behind. A reset clears the phase, not the evidence.
 */
export function buildDemoHealingHistory(
  incidents: readonly SentinelIncidentRow[],
  attempts: readonly SentinelHealingAttemptRow[],
): DemoHealingHistory {
  const resolved = incidents
    .filter((incident) => incident.status === "resolved")
    .sort((left, right) =>
      (right.resolved_at ?? right.created_at).localeCompare(left.resolved_at ?? left.created_at),
    );
  const withBaseline = incidents
    .filter((incident) => incident.last_known_good_count !== null)
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
  const newestBaseline = withBaseline[0] ?? null;

  return {
    hasCompletedRecovery: resolved.length > 0,
    completedRecoveries: resolved.length,
    lastRecoveryAt: resolved[0]?.resolved_at ?? null,
    healingAttemptsRecorded: attempts.length,
    approvedHealingAttempts: attempts.filter((attempt) => attempt.status === "approved").length,
    lastKnownGoodCount: newestBaseline?.last_known_good_count ?? null,
    lastKnownGoodAt: newestBaseline?.last_known_good_at ?? null,
  };
}

export interface GetDemoReadModelOptions {
  configuration: DemoSourceConfiguration;
  harness: DemoHarnessRepository;
  /** Adds collector id, prompts and job ids. Never set from a public route. */
  includeOperatorDetail?: boolean;
  now?: () => Date;
}

export async function getDemoHealingReadModel(
  options: GetDemoReadModelOptions,
): Promise<DemoHealingReadModel> {
  const { configuration, harness } = options;
  const now = options.now ?? (() => new Date());
  const state: SentinelDemoStateRow = await harness.getState();
  const includeDetail = options.includeOperatorDetail === true;

  let runs: CollectionRunRow[] = [];
  let incidents: SentinelIncidentRow[] = [];
  let attempts: SentinelHealingAttemptRow[] = [];
  let canonicalTotal = 0;
  let latestRecords: DemoQuoteSnapshotRow[] = [];

  if (state.source_id) {
    [runs, incidents, attempts, canonicalTotal, latestRecords] = await Promise.all([
      harness.listRunsForSource(state.source_id, 20),
      harness.listIncidentsForSource(state.source_id, 10),
      harness.listHealingAttemptsForSource(state.source_id, 10),
      harness.countCanonicalRecords(state.source_id),
      harness.latestCanonicalRecords(state.source_id, 5),
    ]);
  }

  const currentRunRow = runs[0] ?? null;
  const lastGoodRow = runs.find((run) => run.status === "succeeded" || run.status === "partial") ?? null;

  const currentRunCanonical = currentRunRow
    ? await harness.countCanonicalRecordsForRun(currentRunRow.id)
    : 0;
  const lastGoodCanonical = lastGoodRow
    ? lastGoodRow.id === currentRunRow?.id
      ? currentRunCanonical
      : await harness.countCanonicalRecordsForRun(lastGoodRow.id)
    : 0;

  const activeIncident =
    incidents.find((incident) => incident.id === state.current_incident_id) ??
    incidents.find((incident) => incident.status === "open" || incident.status === "healing") ??
    null;

  const refusedRunCanonical = state.broken_run_id
    ? await harness.countCanonicalRecordsForRun(state.broken_run_id)
    : null;

  const latestAttempt = attempts[0] ?? null;
  const events = await harness.listEvents(100);

  const phase = state.phase;

  const model: DemoHealingReadModel = {
    source: {
      sourceKey: DEMO_SOURCE_KEY,
      providerName: DEMO_PROVIDER_NAME,
      label: DEMO_SOURCE_LABEL,
      armedLayout: state.armed_layout,
      layoutDescription: configuration.layouts[state.armed_layout].description,
      breakMode: state.break_mode,
      ...(includeDetail
        ? {
            collectorId: configuration.collectorId,
            sourceUrl: configuration.layouts[state.armed_layout].url,
          }
        : {}),
    },
    phase: {
      phase,
      headline: PHASE_HEADLINES[phase],
      availableActions: PHASE_ACTIONS[phase],
    },
    sentinel: {
      state: sentinelStateFor(phase),
      anomalyReason: activeIncident?.summary ?? null,
      reasonCodes: activeIncident?.reason_codes ?? [],
    },
    currentRun: currentRunRow ? toRunSummary(currentRunRow, currentRunCanonical) : null,
    lastKnownGoodRun: lastGoodRow ? toRunSummary(lastGoodRow, lastGoodCanonical) : null,
    // The baseline survives a refusal precisely because the refused run never
    // wrote anything: the previous successful run is still the newest success.
    lastKnownGoodPreserved: lastGoodRow !== null,
    canonicalRecordTotal: canonicalTotal,
    quarantine: {
      incident: activeIncident ? toIncidentSummary(activeIncident) : null,
      canonicalWritesFromRefusedRun: refusedRunCanonical,
    },
    healing: {
      requestedAt: state.healing_requested_at,
      attempt: latestAttempt ? toHealingSummary(latestAttempt) : null,
      previewRecordsCount: state.preview_records_count,
      previewValidationPassed: state.preview_passed,
      previewValidationSummary: state.preview_summary,
      previewReasonCodes: state.preview_reason_codes,
      approvalState: state.approval_state,
      approvedAt: state.approved_at,
      ...(includeDetail
        ? {
            prompt: latestAttempt?.prompt ?? null,
            refactorJobId: state.healing_job_id,
          }
        : {}),
    },
    recovery: {
      recovered: phase === "recovered",
      recoveredRunId: state.recovered_run_id,
      recoveredAt:
        phase === "recovered" && currentRunRow ? currentRunRow.completed_at : null,
    },
    history: buildDemoHealingHistory(incidents, attempts),
    timeline: events.map((event) => ({
      at: event.created_at,
      phase: event.phase,
      action: event.action,
      status: event.status,
      summary: event.summary,
    })),
    evidence: {
      isLive: state.is_live,
      canBreak: PHASE_ACTIONS[phase].includes("arm_failure"),
      canReset: PHASE_ACTIONS[phase].includes("reset"),
      generatedAt: now().toISOString(),
    },
  };

  if (includeDetail) {
    model.latestRecords = latestRecords.map((row) => ({
      author: row.author,
      quoteText: row.quote_text,
      observedAt: row.observed_at,
    }));
  }

  return model;
}
