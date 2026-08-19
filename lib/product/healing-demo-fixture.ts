/**
 * Explicit fixture adapter for healing-demo UI tests and local visual work.
 *
 * It is never registered as the production default. Importing `lib/product`
 * installs the canonical fail-closed adapter instead. Tests must call
 * `setHealingDemoAdapter(createFixtureHealingDemoAdapter())`.
 *
 * The fixture still refuses to auto-advance into a successful preview or a
 * recovered state. Those snapshots exist only when a test asks for that phase.
 */

import type { SentinelSnapshotView } from "../../components/radar/sentinel/types";
import {
  DEFAULT_HEALING_DEMO_IDENTITY,
  HEALING_DEMO_TIMELINE_STEPS,
  projectHealingDemoSnapshot,
  type HealingDemoAction,
  type HealingDemoAdapter,
  type HealingDemoBackendSnapshot,
  type HealingDemoPhase,
  type HealingDemoReadModel,
  type HealingDemoTimelineStage,
} from "./healing-demo";

export const FIXTURE_HEALING_DEMO_ADAPTER_ID = "fixture-healing-demo-v1";

export const FIXTURE_HEALING_DEMO_SOURCE_ID = "src-healing-demo-isolated";
export const FIXTURE_HEALING_DEMO_COLLECTOR_ID = "c_healing_demo_studio";

const GENERATED_AT = "2026-08-19T16:00:00.000Z";

const ISOLATED_IDENTITY = {
  ...DEFAULT_HEALING_DEMO_IDENTITY,
  sourceId: FIXTURE_HEALING_DEMO_SOURCE_ID,
  sourceName: "Isolated SourcePulse demo collector",
  sourceUrl: "https://demo.local/isolated-sourcepulse",
  providerName: "SourcePulse demo",
};

const LKG: SentinelSnapshotView = {
  label: "Trusted current · Last-known-good · Unchanged",
  runId: "run-lkg-healthy",
  observedAt: "2026-08-19T15:40:00.000Z",
  recordCount: 18,
  invalidCount: 0,
};

const INVALID_CANDIDATE: SentinelSnapshotView = {
  label: "Latest attempt · Invalid / Quarantined",
  runId: "run-candidate-broken",
  observedAt: "2026-08-19T15:52:00.000Z",
  recordCount: 3,
  invalidCount: 3,
};

const VALIDATED_CANDIDATE: SentinelSnapshotView = {
  label: "New trusted current · Validated",
  runId: "run-candidate-healed",
  observedAt: "2026-08-19T15:58:00.000Z",
  recordCount: 18,
  invalidCount: 0,
};

const PHASE_ORDER: HealingDemoPhase[] = [
  "healthy",
  "break",
  "detected",
  "quarantined",
  "healing",
  "preview_waiting",
  "preview_failed",
  "preview_validated",
  "approved",
  "rerun",
  "recovered",
];

const STEP_INDEX: Record<string, number> = Object.fromEntries(
  HEALING_DEMO_TIMELINE_STEPS.map((step, index) => [step.id, index]),
);

function timestampForStep(index: number): string {
  const start = Date.parse("2026-08-19T15:40:00.000Z");
  return new Date(start + index * 90_000).toISOString();
}

function stageStatus(
  phase: HealingDemoPhase,
  stepId: string,
): HealingDemoTimelineStage["status"] {
  const activeStep = activeStepForPhase(phase);
  const step = STEP_INDEX[stepId] ?? 0;
  const active = STEP_INDEX[activeStep] ?? 0;
  if (phase === "preview_failed" && stepId === "preview_validation") return "failed";
  if (phase === "break" && stepId === "extraction_failure") return "failed";
  if (phase === "detected" && stepId === "contract_violation") return "failed";
  if (step < active) return "done";
  if (step === active) {
    if (phase === "recovered" || phase === "healthy") return "done";
    if (phase === "preview_failed" || phase === "break" || phase === "detected") {
      return "failed";
    }
    return "active";
  }
  return "pending";
}

function activeStepForPhase(phase: HealingDemoPhase): string {
  switch (phase) {
    case "healthy":
      return "healthy_baseline";
    case "break":
      return "extraction_failure";
    case "detected":
      return "contract_violation";
    case "quarantined":
      return "candidate_quarantined";
    case "healing":
      return "heal_requested";
    case "preview_waiting":
      return "preview_returned";
    case "preview_failed":
      return "preview_validation";
    case "preview_validated":
      return "preview_validation";
    case "approved":
      return "approval";
    case "rerun":
      return "rerun";
    case "recovered":
      return "recovery";
  }
}

function evidenceFor(stepId: string, phase: HealingDemoPhase): string | null {
  switch (stepId) {
    case "healthy_baseline":
      return "18 records accepted against the SourcePulse contract.";
    case "extraction_failure":
      return "Bright Data collector returned an empty price table.";
    case "contract_violation":
      return "Sentinel: RECORD_COUNT_COLLAPSE · ALL_PRICES_NULL.";
    case "candidate_quarantined":
      return "Broken snapshot held. Trusted current unchanged.";
    case "lkg_preserved":
      return "Last-known-good run-lkg-healthy still served.";
    case "heal_requested":
      return "Scraper Studio refactor requested for the isolated collector.";
    case "preview_returned":
      return phase === "preview_waiting"
        ? "Waiting for Bright Data preview."
        : "Preview candidate returned from Scraper Studio.";
    case "preview_validation":
      if (phase === "preview_failed") return "Preview failed Sentinel contract checks.";
      if (
        phase === "preview_validated" ||
        phase === "approved" ||
        phase === "rerun" ||
        phase === "recovered"
      ) {
        return "Preview passed Sentinel validation.";
      }
      return "Awaiting contract validation.";
    case "approval":
      return "Operator approved the validated preview.";
    case "rerun":
      return "Isolated collector rerun with the healed definition.";
    case "recovery":
      return "SourcePulse recovered. New trusted current is the validated snapshot.";
    default:
      return null;
  }
}

function fixtureTimeline(phase: HealingDemoPhase): HealingDemoTimelineStage[] {
  const active = STEP_INDEX[activeStepForPhase(phase)] ?? 0;
  return HEALING_DEMO_TIMELINE_STEPS.map((step, index) => {
    const status = stageStatus(phase, step.id);
    const reached = index <= active || status === "failed";
    return {
      id: `fixture-${step.id}`,
      stepId: step.id,
      label: step.label,
      evidence: reached ? evidenceFor(step.id, phase) : null,
      at: reached ? timestampForStep(index) : null,
      durationMs: status === "done" || status === "failed" ? 12_000 + index * 1_500 : null,
      status,
    };
  });
}

function allowedFor(phase: HealingDemoPhase): HealingDemoAction[] {
  switch (phase) {
    case "healthy":
      return ["reset", "establish_baseline", "trigger_failure"];
    case "break":
      return ["reset", "run_broken_collector"];
    case "detected":
      return ["reset", "run_broken_collector"];
    case "quarantined":
      return ["reset", "start_healing"];
    case "healing":
    case "preview_waiting":
    case "rerun":
      return ["reset"];
    case "preview_failed":
      return ["reset", "start_healing"];
    case "preview_validated":
      return ["reset", "approve_preview"];
    case "approved":
      return ["reset", "rerun_recover"];
    case "recovered":
      return ["reset"];
  }
}

function sentinelStatusFor(phase: HealingDemoPhase): HealingDemoBackendSnapshot["sentinelStatus"] {
  switch (phase) {
    case "healthy":
      return "healthy";
    case "break":
    case "detected":
      return "degraded";
    case "quarantined":
    case "preview_failed":
      return "quarantined";
    case "healing":
    case "preview_waiting":
    case "preview_validated":
    case "approved":
    case "rerun":
      return "healing";
    case "recovered":
      return "recovered";
  }
}

function comparisonModeFor(
  phase: HealingDemoPhase,
): HealingDemoBackendSnapshot["comparisonMode"] {
  if (phase === "recovered") return "recovered";
  if (phase === "healthy") return "healthy";
  if (
    phase === "quarantined" ||
    phase === "healing" ||
    phase === "preview_waiting" ||
    phase === "preview_failed" ||
    phase === "preview_validated" ||
    phase === "approved" ||
    phase === "rerun" ||
    phase === "detected" ||
    phase === "break"
  ) {
    return "quarantine";
  }
  return "none";
}

function previewStateFor(
  phase: HealingDemoPhase,
): NonNullable<HealingDemoBackendSnapshot["preview"]>["state"] {
  switch (phase) {
    case "healing":
      return "requested";
    case "preview_waiting":
      return "waiting";
    case "preview_failed":
      return "failed";
    case "preview_validated":
    case "approved":
    case "rerun":
    case "recovered":
      return "validated";
    default:
      return "idle";
  }
}

export function fixtureHealingDemoSnapshot(
  phase: HealingDemoPhase,
  generatedAt = GENERATED_AT,
): HealingDemoBackendSnapshot {
  const quarantined =
    phase !== "healthy" && phase !== "break";
  const healingStarted = PHASE_ORDER.indexOf(phase) >= PHASE_ORDER.indexOf("healing");
  const previewValidated =
    phase === "preview_validated" ||
    phase === "approved" ||
    phase === "rerun" ||
    phase === "recovered";
  const recovered = phase === "recovered";
  const validationPassed =
    phase === "preview_failed" ? false : previewValidated ? true : null;

  return {
    generatedAt,
    phase,
    sentinelStatus: sentinelStatusFor(phase),
    identity: ISOLATED_IDENTITY,
    brightData: {
      collectorId: FIXTURE_HEALING_DEMO_COLLECTOR_ID,
      studio: "Scraper Studio",
      healRequested: healingStarted,
      healRequestedAt: healingStarted ? "2026-08-19T15:53:30.000Z" : null,
      previewState: previewStateFor(phase),
      approvalState:
        phase === "preview_failed"
          ? "blocked"
          : phase === "preview_validated"
            ? "available"
            : phase === "approved" || phase === "rerun" || recovered
              ? "approved"
              : "not_required",
      rerunState:
        phase === "rerun" ? "in_progress" : recovered ? "complete" : "idle",
      refactorJobId: healingStarted ? "job-demo-refactor-1" : null,
    },
    lastKnownGood: LKG,
    candidate: recovered
      ? VALIDATED_CANDIDATE
      : phase === "healthy"
        ? null
        : INVALID_CANDIDATE,
    comparisonMode: comparisonModeFor(phase),
    incident: quarantined
      ? {
          id: "inc-healing-demo",
          status:
            recovered
              ? "resolved"
              : healingStarted
                ? "healing"
                : "open",
          severity: "critical",
          reasonCodes: ["RECORD_COUNT_COLLAPSE", "ALL_PRICES_NULL"],
          summary:
            "Isolated demo collector collapsed from 18 trusted records to 3 invalid prices.",
          recordsSeen: 3,
          recordsValid: 0,
          recordsInvalid: 3,
          healingAttemptCount: healingStarted ? 1 : 0,
          createdAt: "2026-08-19T15:52:00.000Z",
        }
      : null,
    quarantine: {
      active: quarantined && !recovered,
      summary: quarantined
        ? recovered
          ? "Quarantine released after validated recovery."
          : "Broken candidate held. Last-known-good still served."
        : null,
      at: quarantined ? "2026-08-19T15:52:10.000Z" : null,
    },
    healing: healingStarted
      ? {
          attemptNumber: 1,
          status:
            phase === "healing"
              ? "in_progress"
              : previewValidated
                ? "candidate_validated"
                : phase === "preview_failed"
                  ? "candidate_rejected"
                  : "awaiting_approval",
          startedAt: "2026-08-19T15:53:30.000Z",
          completedAt: previewValidated || phase === "preview_failed" ? "2026-08-19T15:56:00.000Z" : null,
          summary: "Bright Data Scraper Studio heal/refactor for the isolated collector.",
        }
      : null,
    preview: {
      state: previewStateFor(phase),
      returnedAt:
        PHASE_ORDER.indexOf(phase) >= PHASE_ORDER.indexOf("preview_waiting")
          ? "2026-08-19T15:55:00.000Z"
          : null,
      summary:
        phase === "preview_waiting"
          ? "Waiting for Scraper Studio preview."
          : phase === "preview_failed"
            ? "Preview returned but failed validation."
            : previewValidated
              ? "Preview returned and passed Sentinel validation."
              : null,
    },
    validation: {
      passed: validationPassed,
      summary:
        validationPassed === true
          ? "Preview matched the SourcePulse contract."
          : validationPassed === false
            ? "Preview failed the SourcePulse contract."
            : null,
      at: validationPassed !== null ? "2026-08-19T15:56:00.000Z" : null,
    },
    approval: {
      available: phase === "preview_validated" && validationPassed === true,
      approved: phase === "approved" || phase === "rerun" || recovered,
      at:
        phase === "approved" || phase === "rerun" || recovered
          ? "2026-08-19T15:57:00.000Z"
          : null,
      summary:
        phase === "preview_validated"
          ? "Approval is available because the preview is valid."
          : phase === "preview_failed"
            ? "Approval is blocked until a preview passes validation."
            : null,
    },
    rerun: {
      state: phase === "rerun" ? "in_progress" : recovered ? "complete" : "idle",
      at: phase === "rerun" || recovered ? "2026-08-19T15:58:00.000Z" : null,
      summary:
        recovered
          ? "Healed collector reran and was accepted."
          : phase === "rerun"
            ? "Rerun in progress on the isolated collector."
            : null,
    },
    recovery: {
      recovered,
      at: recovered ? "2026-08-19T15:59:00.000Z" : null,
      summary: recovered
        ? "SourcePulse recovered. New trusted current is validated."
        : null,
    },
    timeline: fixtureTimeline(phase),
    allowedActions: allowedFor(phase),
    pollAfterMs:
      phase === "healing" || phase === "preview_waiting" || phase === "rerun"
        ? 2_000
        : null,
    busy: phase === "healing" || phase === "preview_waiting" || phase === "rerun",
  };
}

export function fixtureHealingDemoReadModel(
  phase: HealingDemoPhase,
  generatedAt = GENERATED_AT,
): HealingDemoReadModel {
  return projectHealingDemoSnapshot(fixtureHealingDemoSnapshot(phase, generatedAt), {
    adapterId: FIXTURE_HEALING_DEMO_ADAPTER_ID,
    kind: "fixture",
    isFixture: true,
  });
}

const ACTION_RESULT: Record<HealingDemoAction, HealingDemoPhase | null> = {
  reset: "healthy",
  establish_baseline: "healthy",
  trigger_failure: "break",
  run_broken_collector: "quarantined",
  start_healing: "healing",
  approve_preview: "approved",
  rerun_recover: "recovered",
};

export interface FixtureHealingDemoAdapter extends HealingDemoAdapter {
  setPhase(phase: HealingDemoPhase): void;
}

export function createFixtureHealingDemoAdapter(
  initialPhase: HealingDemoPhase = "healthy",
): FixtureHealingDemoAdapter {
  let phase = initialPhase;

  return {
    id: FIXTURE_HEALING_DEMO_ADAPTER_ID,
    label: "Fixture healing demo (tests / explicit development only)",
    isFixture: true,
    setPhase(next) {
      phase = next;
    },
    async getState() {
      return fixtureHealingDemoReadModel(phase);
    },
    async runAction(action: HealingDemoAction) {
      const current = fixtureHealingDemoReadModel(phase);
      if (!current.allowedActions.includes(action)) {
        return current;
      }
      const next = ACTION_RESULT[action];
      if (next) phase = next;
      return fixtureHealingDemoReadModel(phase);
    },
  };
}
