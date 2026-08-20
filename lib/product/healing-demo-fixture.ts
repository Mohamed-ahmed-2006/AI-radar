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
  HEALING_DEMO_RECOVERY_PROOF_NOTE,
  HEALING_DEMO_RECOVERY_STAGE_IDS,
  HEALING_DEMO_RECOVERY_STAGE_LABELS,
  HEALING_DEMO_TIMELINE_STEPS,
  projectHealingDemoSnapshot,
  type HealingDemoAction,
  type HealingDemoAdapter,
  type HealingDemoBackendSnapshot,
  type HealingDemoPhase,
  type HealingDemoReadModel,
  type HealingDemoRecoveryProof,
  type HealingDemoRecoveryStage,
  type HealingDemoRecoveryStageId,
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
    // The fixture describes one staged phase, not a source with a past.
    history: null,
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

/**
 * UI-test double of Claude's historical proof shape. Never registered as the
 * production adapter snapshot — attach it explicitly in rendering tests.
 */
export function fixtureHistoricalRecoveryProof(): HealingDemoRecoveryProof {
  const stage = (
    id: HealingDemoRecoveryStageId,
    input: Omit<HealingDemoRecoveryStage, "id" | "order" | "title">,
  ): HealingDemoRecoveryStage => ({
    id,
    order: HEALING_DEMO_RECOVERY_STAGE_IDS.indexOf(id),
    title: HEALING_DEMO_RECOVERY_STAGE_LABELS[id],
    ...input,
  });

  return {
    available: true,
    unavailableReason: null,
    isHistorical: true,
    isLiveEvidence: true,
    note: HEALING_DEMO_RECOVERY_PROOF_NOTE,
    title: "Verified recovery · Sentinel self-healing demo source",
    recoveredAt: "2026-08-20T09:56:59.462Z",
    source: {
      label: "Sentinel self-healing demo source",
      healthyUrl: "https://ai-radar-orpin.vercel.app/demo-source/healthy",
      brokenUrl: "https://ai-radar-orpin.vercel.app/demo-source/broken",
    },
    collector: {
      ref: FIXTURE_HEALING_DEMO_COLLECTOR_ID,
      sameCollectorConfirmed: true,
      sameCollectorEvidence:
        "All 3 healing attempts recorded collector c_healing_demo_studio, which is the collector the recovered source is registered against.",
      refactorJobId: "ia_test_refactor_job",
    },
    summary: {
      baselineRecords: 10,
      failedRecords: 0,
      recoveredRecords: 10,
      lastKnownGoodPreserved: true,
      lastKnownGoodEvidence:
        "Baseline run run-lkg-healthy held 10 records when the incident opened and still holds 10 canonical rows.",
      zeroBadCanonicalWrites: true,
      canonicalWritesFromInvalidRun: 0,
      reasonCodes: ["ZERO_RECORDS"],
      finalState: "recovered",
      incidentId: "inc-healing-demo",
      incidentStatus: "resolved",
      baselineRunId: "run-lkg-healthy",
      invalidRunId: "run-candidate-broken",
      recoveryRunId: "run-candidate-healed",
      distinctRunIds: true,
    },
    stages: [
      stage("trusted_baseline", {
        kind: "observed",
        at: "2026-08-20T09:55:08.310Z",
        summary:
          "The collector ran against the layout its extraction template was built against and Sentinel accepted every record.",
        evidence: [
          { label: "Baseline run", value: "run-lkg-healthy" },
          { label: "Records seen", value: "10" },
          { label: "Records accepted", value: "10" },
          { label: "Canonical rows written", value: "10" },
        ],
      }),
      stage("source_layout_changed", {
        kind: "context",
        at: null,
        summary:
          "The demo source publishes the same records under two layouts: quote cards, and the same records re-rendered as a table.",
        evidence: [
          { label: "Healthy layout", value: "https://ai-radar-orpin.vercel.app/demo-source/healthy" },
          { label: "Changed layout", value: "https://ai-radar-orpin.vercel.app/demo-source/broken" },
        ],
      }),
      stage("invalid_extraction", {
        kind: "observed",
        at: "2026-08-20T09:55:20.371Z",
        summary: "The same collector ran and returned an extraction the contract could not accept.",
        evidence: [
          { label: "Run", value: "run-candidate-broken" },
          { label: "Run status", value: "failed" },
          { label: "Records seen", value: "0" },
          { label: "Records accepted", value: "0" },
          { label: "Collector error", value: "Collector output contains zero records" },
        ],
      }),
      stage("sentinel_detected", {
        kind: "observed",
        at: "2026-08-20T09:55:22.704Z",
        summary: "Collector output contains zero records",
        evidence: [
          { label: "Incident", value: "inc-healing-demo" },
          { label: "Severity", value: "critical" },
          { label: "Reason codes", value: "ZERO_RECORDS" },
          { label: "Records seen", value: "0" },
          { label: "Records valid", value: "0" },
          { label: "Expected records", value: "10" },
        ],
      }),
      stage("quarantined", {
        kind: "observed",
        at: "2026-08-20T09:55:22.800Z",
        summary:
          "The refused payload was isolated against the incident so healing and review had the evidence, and no part of it reached a canonical table.",
        evidence: [
          { label: "Quarantine record", value: "q-healing-demo" },
          { label: "Quarantined run", value: "run-candidate-broken" },
          { label: "Canonical writes from this run", value: "0" },
        ],
      }),
      stage("last_known_good_preserved", {
        kind: "observed",
        at: "2026-08-20T09:55:08.310Z",
        summary:
          "The previous trusted run stayed the newest accepted run throughout the incident, so the canonical store kept serving it.",
        evidence: [
          { label: "Last-known-good run", value: "run-lkg-healthy" },
          { label: "Records at incident time", value: "10" },
          { label: "Canonical rows today", value: "10" },
        ],
      }),
      stage("bright_data_repair", {
        kind: "observed",
        at: "2026-08-20T09:55:21.560Z",
        summary:
          "Bright Data was asked to refactor the extraction on the same dedicated collector. No production collector was involved.",
        evidence: [
          { label: "Healing attempt", value: "attempt-preview" },
          { label: "Attempt number", value: "1" },
          { label: "Collector", value: FIXTURE_HEALING_DEMO_COLLECTOR_ID },
          { label: "Refactor job", value: "ia_test_refactor_job" },
        ],
      }),
      stage("candidate_validated", {
        kind: "observed",
        at: "2026-08-20T09:56:42.073Z",
        summary:
          "The repaired candidate was judged by the same contract that refused the original payload, and passed.",
        evidence: [
          { label: "Healing attempt", value: "attempt-approved" },
          { label: "Preview records", value: "10" },
          { label: "Contract verdict", value: "passed" },
          { label: "Attempt status", value: "approved" },
        ],
      }),
      stage("approved", {
        kind: "observed",
        at: "2026-08-20T09:56:42.238Z",
        summary:
          "The validated candidate was approved and saved to the collector, and the incident was resolved.",
        evidence: [
          { label: "Approved attempt", value: "attempt-approved" },
          { label: "Attempt status", value: "approved" },
          { label: "Incident status", value: "resolved" },
          { label: "Resolved at", value: "2026-08-20T09:56:42.238Z" },
        ],
      }),
      stage("recovery_rerun", {
        kind: "observed",
        at: "2026-08-20T09:56:59.462Z",
        summary:
          "The repaired collector ran again — a separate run from the one that failed — and went through the same gate.",
        evidence: [
          { label: "Recovery run", value: "run-candidate-healed" },
          { label: "Run status", value: "succeeded" },
          { label: "Records seen", value: "10" },
          { label: "Records accepted", value: "10" },
          { label: "Distinct from failed run", value: "run-candidate-broken" },
        ],
      }),
      stage("recovered", {
        kind: "observed",
        at: "2026-08-20T09:56:59.462Z",
        summary: "Sentinel accepted the run and the source returned to serving trusted data.",
        evidence: [
          { label: "Final incident status", value: "resolved" },
          { label: "Canonical rows from the recovery run", value: "10" },
          { label: "Recovered at", value: "2026-08-20T09:56:59.462Z" },
        ],
      }),
    ],
  };
}

export function fixtureHealingDemoReadModelWithProof(
  phase: HealingDemoPhase = "healthy",
): HealingDemoReadModel {
  const model = fixtureHealingDemoReadModel(phase);
  return { ...model, recoveryProof: fixtureHistoricalRecoveryProof() };
}
