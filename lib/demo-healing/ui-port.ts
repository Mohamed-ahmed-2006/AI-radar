/**
 * The seam between the real healing backend and the SourcePulse demo UI.
 *
 * This module is a projection and nothing else. It runs no collector, calls no
 * Bright Data endpoint and writes no row — it asks the orchestrator to execute
 * an allowlisted step, then reshapes the backend's read model into the
 * snapshot the UI expects.
 *
 * Two properties matter here and are enforced rather than assumed:
 *
 *   * every phase, status and timestamp is *derived* from what the backend
 *     reports. Nothing is advanced locally, and there is no branch that
 *     produces a validated preview or a recovered state the backend did not
 *     report.
 *   * `approve_preview` is offered only when the backend says the preview
 *     passed validation. The UI projector re-checks this, and the orchestrator
 *     refuses an unvalidated approval regardless — three independent places,
 *     because it is the invariant that matters most.
 *
 * Server-only.
 */

import type { HealingDemoBackendPort } from "../healing-demo/backend";
import type {
  HealingDemoAction,
  HealingDemoBackendSnapshot,
  HealingDemoPhase,
  HealingDemoTimelineStage,
} from "../product/healing-demo";
import {
  DEFAULT_HEALING_DEMO_IDENTITY,
  HEALING_DEMO_TIMELINE_STEPS,
} from "../product/healing-demo";
import type {
  SentinelSnapshotView,
  SentinelStageStatus,
  SentinelStatus,
} from "../../components/radar/sentinel/types";
import type { SentinelIncidentStatus, SentinelReasonCode } from "../sentinel/types";
import type { SentinelDemoPhase } from "../supabase/types";
import {
  DemoHealingOrchestrator,
  type DemoAction,
  type DemoOrchestratorDependencies,
} from "./orchestrator";
import { getDemoHealingReadModel, type DemoHealingReadModel } from "./read-model";
import { DEMO_PROVIDER_NAME, DEMO_SOURCE_LABEL } from "./source";

/**
 * Which backend steps each UI action runs.
 *
 * `start_healing` covers two: Bright Data returns a candidate, and that
 * candidate is immediately judged. They are one button because a candidate
 * nobody has judged is not a state the demo should rest in — but they remain
 * two real, separate backend steps, and the validation genuinely runs.
 */
const ACTION_PLAN: Record<HealingDemoAction, DemoAction[]> = {
  reset: ["reset"],
  establish_baseline: ["run_baseline"],
  trigger_failure: ["arm_failure"],
  run_broken_collector: ["run_broken"],
  start_healing: ["request_heal", "validate_preview"],
  approve_preview: ["approve"],
  rerun_recover: ["rerun"],
};

/**
 * Which UI action offers each backend step.
 *
 * `break_template` is deliberately absent: the contingency break is an
 * operator tool, not something a page visitor can trigger.
 */
const ACTION_FOR_BACKEND_STEP: Partial<Record<DemoAction, HealingDemoAction>> = {
  reset: "reset",
  run_baseline: "establish_baseline",
  arm_failure: "trigger_failure",
  run_broken: "run_broken_collector",
  request_heal: "start_healing",
  validate_preview: "start_healing",
  approve: "approve_preview",
  rerun: "rerun_recover",
};

const PHASE_LABELS: Record<SentinelDemoPhase, string> = {
  unprepared: "Not started",
  healthy: "Healthy",
  failure_armed: "Break armed",
  quarantined: "Quarantined",
  healing: "Healing",
  preview_rejected: "Preview failed",
  preview_validated: "Preview validated",
  approved: "Approved",
  recovered: "Recovered",
  needs_review: "Needs review",
};

const SENTINEL_STATUS: Record<SentinelDemoPhase, SentinelStatus> = {
  unprepared: "healthy",
  healthy: "healthy",
  failure_armed: "degraded",
  quarantined: "quarantined",
  healing: "healing",
  preview_rejected: "quarantined",
  preview_validated: "healing",
  approved: "healing",
  recovered: "recovered",
  needs_review: "needs_review",
};

/**
 * Maps a backend phase onto the UI's vocabulary.
 *
 * `healing` splits in two: the UI distinguishes "the refactor is running" from
 * "a candidate is back and waiting to be judged", and the backend tells them
 * apart by whether it has preview records yet.
 */
function uiPhase(model: DemoHealingReadModel): HealingDemoPhase {
  switch (model.phase.phase) {
    case "unprepared":
    case "healthy":
      return "healthy";
    case "failure_armed":
      return "break";
    case "quarantined":
      return "quarantined";
    case "healing":
      return (model.healing.previewRecordsCount ?? 0) > 0 ? "preview_waiting" : "healing";
    case "preview_rejected":
      return "preview_failed";
    case "preview_validated":
      return "preview_validated";
    case "approved":
      return "approved";
    case "recovered":
      return "recovered";
    case "needs_review":
      return "quarantined";
  }
}

/** The timeline step the demo has currently reached. */
function activeStep(phase: SentinelDemoPhase, previewReturned: boolean): string {
  switch (phase) {
    case "unprepared":
    case "healthy":
      return "healthy_baseline";
    case "failure_armed":
      return "extraction_failure";
    case "quarantined":
      return "lkg_preserved";
    case "healing":
      return previewReturned ? "preview_returned" : "heal_requested";
    case "preview_rejected":
    case "preview_validated":
      return "preview_validation";
    case "approved":
      return "approval";
    case "recovered":
      return "recovery";
    case "needs_review":
      return "preview_validation";
  }
}

const STEP_ORDER: Record<string, number> = Object.fromEntries(
  HEALING_DEMO_TIMELINE_STEPS.map((step, index) => [step.id, index]),
);

/**
 * Builds the timeline from what the backend reports.
 *
 * A step is only given evidence and a timestamp once the run behind it has
 * actually happened. Steps the demo has not reached carry `null`, which is why
 * the UI cannot render a stage that did not occur.
 */
function buildTimeline(model: DemoHealingReadModel): HealingDemoTimelineStage[] {
  const phase = model.phase.phase;
  const previewReturned = (model.healing.previewRecordsCount ?? 0) > 0;
  const active = STEP_ORDER[activeStep(phase, previewReturned)] ?? 0;
  const incident = model.quarantine.incident;
  const failedValidation = phase === "preview_rejected" || phase === "needs_review";

  const evidence: Record<string, string | null> = {
    healthy_baseline: model.lastKnownGoodRun
      ? `${model.lastKnownGoodRun.canonicalRecordsWritten} records accepted and persisted.`
      : null,
    extraction_failure: phase === "unprepared" || phase === "healthy"
      ? null
      : model.source.layoutDescription,
    contract_violation: incident
      ? `Sentinel: ${incident.reasonCodes.join(" · ") || "contract violation"}.`
      : null,
    candidate_quarantined: incident
      ? `${incident.recordsInvalid} of ${incident.recordsSeen} records refused. `
        + `${model.quarantine.canonicalWritesFromRefusedRun ?? 0} canonical writes from this run.`
      : null,
    lkg_preserved: model.lastKnownGoodRun
      ? `Last-known-good ${model.lastKnownGoodRun.runId} still served.`
      : null,
    heal_requested: model.healing.requestedAt
      ? "Scraper Studio refactor requested for the isolated demo collector."
      : null,
    preview_returned: previewReturned
      ? `${model.healing.previewRecordsCount} preview record(s) returned for judging.`
      : null,
    preview_validation:
      model.healing.previewValidationPassed === true
        ? "Preview passed the same Sentinel contract."
        : model.healing.previewValidationPassed === false
          ? model.healing.previewValidationSummary
            ?? `Preview refused: ${model.healing.previewReasonCodes.join(" · ")}.`
          : null,
    approval: model.healing.approvedAt
      ? "Repaired template approved after passing validation."
      : null,
    rerun: model.recovery.recoveredRunId ? "Repaired collector re-ran through the same gate." : null,
    recovery: model.recovery.recovered
      ? `Recovered. ${model.canonicalRecordTotal} canonical records on record.`
      : null,
  };

  return HEALING_DEMO_TIMELINE_STEPS.map((step, index) => {
    const order = STEP_ORDER[step.id] ?? index;
    let status: SentinelStageStatus;
    if (step.id === "preview_validation" && failedValidation) status = "failed";
    else if (step.id === "contract_violation" && incident) status = "failed";
    else if (step.id === "extraction_failure" && incident) status = "failed";
    else if (order < active) status = "done";
    else if (order === active) status = phase === "recovered" || phase === "healthy" ? "done" : "active";
    else status = "pending";

    const reached = order <= active || status === "failed";
    return {
      id: `demo-${step.id}`,
      stepId: step.id,
      label: step.label,
      evidence: reached ? (evidence[step.id] ?? null) : null,
      // Timestamps come from the backend's own event journal, never invented.
      at: reached ? (timestampFor(model, step.id) ?? null) : null,
      durationMs: null,
      status,
    };
  });
}

/** The recorded time of the run or event behind a step, when there is one. */
function timestampFor(model: DemoHealingReadModel, stepId: string): string | null {
  switch (stepId) {
    case "healthy_baseline":
    case "lkg_preserved":
      return model.lastKnownGoodRun?.completedAt ?? model.lastKnownGoodRun?.startedAt ?? null;
    case "extraction_failure":
    case "contract_violation":
    case "candidate_quarantined":
      return model.quarantine.incident?.createdAt ?? null;
    case "heal_requested":
    case "preview_returned":
      return model.healing.requestedAt;
    case "preview_validation":
      return model.healing.attempt?.completedAt ?? model.healing.attempt?.startedAt ?? null;
    case "approval":
      return model.healing.approvedAt;
    case "rerun":
    case "recovery":
      return model.recovery.recoveredAt;
    default:
      return null;
  }
}

function runSnapshot(
  run: DemoHealingReadModel["lastKnownGoodRun"],
  label: string,
): SentinelSnapshotView | null {
  if (!run) return null;
  return {
    label,
    runId: run.runId,
    observedAt: run.completedAt ?? run.startedAt,
    recordCount: run.canonicalRecordsWritten,
    invalidCount: run.recordsRejected,
  };
}

function previewState(
  model: DemoHealingReadModel,
): NonNullable<HealingDemoBackendSnapshot["preview"]>["state"] {
  const phase = model.phase.phase;
  if (phase === "preview_rejected") return "failed";
  if (phase === "preview_validated" || phase === "approved" || phase === "recovered") {
    return "validated";
  }
  if (phase === "healing") {
    return (model.healing.previewRecordsCount ?? 0) > 0 ? "waiting" : "requested";
  }
  return "idle";
}

function incidentStatus(status: string): SentinelIncidentStatus {
  const known: SentinelIncidentStatus[] = [
    "open",
    "healing",
    "resolved",
    "dismissed",
    "needs_review",
  ];
  return known.includes(status as SentinelIncidentStatus)
    ? (status as SentinelIncidentStatus)
    : "open";
}

/** Projects the backend read model into the UI's snapshot contract. */
export function toHealingDemoSnapshot(
  model: DemoHealingReadModel,
): HealingDemoBackendSnapshot {
  const phase = uiPhase(model);
  const backendPhase = model.phase.phase;
  const incident = model.quarantine.incident;
  const validationPassed = model.healing.previewValidationPassed;
  const recovered = model.recovery.recovered;

  // Only backend steps that are actually available become UI actions, so a
  // button the orchestrator would refuse is never offered.
  const allowedActions: HealingDemoAction[] = [];
  for (const step of model.phase.availableActions) {
    const action = ACTION_FOR_BACKEND_STEP[step];
    if (action && !allowedActions.includes(action)) allowedActions.push(action);
  }

  return {
    generatedAt: model.evidence.generatedAt,
    phase,
    phaseLabel: PHASE_LABELS[backendPhase],
    sentinelStatus: SENTINEL_STATUS[backendPhase],
    identity: {
      ...DEFAULT_HEALING_DEMO_IDENTITY,
      sourceId: null,
      sourceName: DEMO_SOURCE_LABEL,
      // Present only when the caller was authorized to see it.
      sourceUrl: model.source.sourceUrl ?? null,
      providerName: DEMO_PROVIDER_NAME,
      isolationNote:
        "Controls affect only the dedicated Sentinel demo source and its own collector. "
        + "No URL, collector or source can be supplied by a caller.",
    },
    brightData: {
      collectorId: model.source.collectorId ?? null,
      studio: "Scraper Studio",
      healRequested: model.healing.requestedAt !== null,
      healRequestedAt: model.healing.requestedAt,
      previewState: previewState(model),
      approvalState:
        model.healing.approvalState === "approved"
          ? "approved"
          : validationPassed === true
            ? "available"
            : validationPassed === false
              ? "blocked"
              : "not_required",
      rerunState: recovered ? "complete" : backendPhase === "approved" ? "idle" : "idle",
      refactorJobId: model.healing.refactorJobId ?? null,
    },
    lastKnownGood: runSnapshot(
      model.lastKnownGoodRun,
      recovered
        ? "Trusted current · Last-known-good"
        : "Trusted current · Last-known-good · Unchanged",
    ),
    candidate:
      backendPhase === "unprepared" || backendPhase === "healthy" || backendPhase === "failure_armed"
        ? null
        : recovered
          ? runSnapshot(model.currentRun, "New trusted current · Validated")
          : incident
            ? {
                label: "Latest attempt · Invalid / Quarantined",
                runId: model.currentRun?.runId ?? null,
                observedAt: incident.createdAt,
                recordCount: incident.recordsValid,
                invalidCount: incident.recordsInvalid,
              }
            : null,
    comparisonMode:
      recovered
        ? "recovered"
        : backendPhase === "unprepared"
          ? "none"
          : backendPhase === "healthy" || backendPhase === "failure_armed"
            ? "healthy"
            : "quarantine",
    incident: incident
      ? {
          id: incident.incidentId,
          status: incidentStatus(incident.status),
          severity: (incident.severity as "info" | "warning" | "critical") ?? "warning",
          reasonCodes: incident.reasonCodes as SentinelReasonCode[],
          summary: incident.summary,
          recordsSeen: incident.recordsSeen,
          recordsValid: incident.recordsValid,
          recordsInvalid: incident.recordsInvalid,
          healingAttemptCount: incident.healingAttemptCount,
          createdAt: incident.createdAt,
        }
      : null,
    quarantine: incident
      ? {
          active: incident.status === "open" || incident.status === "healing",
          summary:
            `${model.quarantine.canonicalWritesFromRefusedRun ?? 0} canonical writes from the refused run. `
            + (model.lastKnownGoodPreserved
              ? "Last-known-good preserved."
              : "No last-known-good on record."),
          at: incident.createdAt,
        }
      : null,
    healing: model.healing.attempt
      ? {
          attemptNumber: model.healing.attempt.attemptNumber,
          status: model.healing.attempt.status,
          startedAt: model.healing.attempt.startedAt,
          completedAt: model.healing.attempt.completedAt,
          summary: null,
        }
      : null,
    preview: {
      state: previewState(model),
      returnedAt: model.healing.requestedAt,
      summary:
        model.healing.previewRecordsCount === null
          ? null
          : `${model.healing.previewRecordsCount} candidate record(s) returned by Scraper Studio.`,
    },
    validation: {
      passed: validationPassed,
      summary: model.healing.previewValidationSummary,
      at: model.healing.attempt?.completedAt ?? null,
    },
    approval: {
      // The backend is the only thing that can make approval available, and
      // only a preview that passed the contract does so.
      available: validationPassed === true && model.healing.approvalState !== "approved",
      approved: model.healing.approvalState === "approved",
      at: model.healing.approvedAt,
      summary:
        validationPassed === false
          ? "Approval is blocked: the candidate failed the same Sentinel contract."
          : null,
    },
    rerun: {
      state: recovered ? "complete" : "idle",
      at: model.recovery.recoveredAt,
      summary: null,
    },
    recovery: {
      recovered,
      at: model.recovery.recoveredAt,
      summary: recovered
        ? `Repaired collector passed the same Sentinel gate. ${model.canonicalRecordTotal} canonical records on record.`
        : null,
    },
    timeline: buildTimeline(model),
    allowedActions,
    pollAfterMs: null,
    busy: false,
  };
}

export interface HealingDemoPortOptions extends DemoOrchestratorDependencies {
  /**
   * Adds collector id and source URL to the snapshot. Off by default: the
   * public page must not disclose which collector the demo drives.
   */
  includeOperatorDetail?: boolean;
}

/**
 * Builds the port the UI adapter consumes.
 *
 * Constructing the orchestrator can fail when the demo is not configured — for
 * instance with no dedicated collector id. That is surfaced as a thrown error
 * so the adapter reports "unavailable"; it never degrades into a fixture and
 * never targets a production collector.
 */
export function createHealingDemoPort(
  options: HealingDemoPortOptions = {},
): HealingDemoBackendPort {
  const { includeOperatorDetail = false, ...dependencies } = options;

  const snapshot = async (): Promise<HealingDemoBackendSnapshot> => {
    const orchestrator = new DemoHealingOrchestrator(dependencies);
    const model = await getDemoHealingReadModel({
      configuration: orchestrator.getConfiguration(),
      harness: orchestrator.getHarnessRepository(),
      includeOperatorDetail,
    });
    return toHealingDemoSnapshot(model);
  };

  return {
    getSnapshot: snapshot,
    async dispatch(action: HealingDemoAction): Promise<HealingDemoBackendSnapshot> {
      const plan = ACTION_PLAN[action];
      if (!plan) throw new Error(`Action '${action}' is not in the healing demo allowlist`);

      const orchestrator = new DemoHealingOrchestrator(dependencies);
      for (const step of plan) {
        const result = await orchestrator.execute(step);
        // A refusal is a real outcome, not a reason to keep going: the second
        // step of a plan runs only if the first actually succeeded.
        if (result.status !== "ok") break;
      }

      const model = await getDemoHealingReadModel({
        configuration: orchestrator.getConfiguration(),
        harness: orchestrator.getHarnessRepository(),
        includeOperatorDetail,
      });
      return toHealingDemoSnapshot(model);
    },
  };
}
