/**
 * Typed seam between the judge-facing SourcePulse recovery demo and Claude's
 * real Bright Data healing backend.
 *
 * The UI renders this read model and dispatches allowlisted actions. It does
 * not invent healing stages, simulate a successful preview, locally advance
 * state, fabricate timestamps, or fake recovery. Those belong to the adapter.
 *
 * Claude replaces the backend by implementing `HealingDemoBackendPort` and
 * calling `registerHealingDemoBackend`. The fixture adapter is for tests and
 * explicit development only — it is never the production default.
 */

import type {
  SentinelIncidentStatus,
  SentinelReasonCode,
  SentinelSeverity,
  SentinelSnapshotView,
  SentinelStageStatus,
  SentinelStatus,
  SentinelTimelineStage,
} from "../../components/radar/sentinel/types";

export const HEALING_DEMO_HREF = "/demo/healing";
export const SOURCE_HEALTH_HREF = "/source-health";

export const HEALING_DEMO_UNAVAILABLE_TITLE = "Real healing demo unavailable";

export const HEALING_DEMO_KIND_LABELS = {
  real_bright_data_demo: "Real Bright Data demo",
  fixture: "Fixture / tests only",
  unavailable: "Real Bright Data demo",
} as const;

export const HEALING_DEMO_PHASES = [
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
] as const;

export type HealingDemoPhase = (typeof HEALING_DEMO_PHASES)[number];

export const HEALING_DEMO_ACTIONS = [
  "reset",
  "establish_baseline",
  "trigger_failure",
  "run_broken_collector",
  "start_healing",
  "approve_preview",
  "rerun_recover",
] as const;

export type HealingDemoAction = (typeof HEALING_DEMO_ACTIONS)[number];

export const HEALING_DEMO_ACTION_LABELS: Record<HealingDemoAction, string> = {
  reset: "Reset demo",
  establish_baseline: "Establish healthy baseline",
  trigger_failure: "Trigger controlled failure",
  run_broken_collector: "Run broken collector",
  start_healing: "Start healing",
  approve_preview: "Approve validated preview",
  rerun_recover: "Rerun / Recover",
};

export const HEALING_DEMO_DANGEROUS_ACTIONS: readonly HealingDemoAction[] = [
  "reset",
  "trigger_failure",
  "run_broken_collector",
];

export const HEALING_DEMO_KINDS = [
  "real_bright_data_demo",
  "fixture",
  "unavailable",
] as const;

export type HealingDemoKind = (typeof HEALING_DEMO_KINDS)[number];

export const HEALING_DEMO_TIMELINE_STEPS = [
  { id: "healthy_baseline", label: "Healthy baseline" },
  { id: "extraction_failure", label: "Extraction failure" },
  { id: "contract_violation", label: "Contract / Sentinel violation detected" },
  { id: "candidate_quarantined", label: "Candidate quarantined" },
  { id: "lkg_preserved", label: "Last-known-good preserved" },
  { id: "heal_requested", label: "Bright Data healing requested" },
  { id: "preview_returned", label: "Preview returned" },
  { id: "preview_validation", label: "Preview validation" },
  { id: "approval", label: "Approval" },
  { id: "rerun", label: "Rerun" },
  { id: "recovery", label: "Recovery" },
] as const;

export type HealingDemoTimelineStepId =
  (typeof HEALING_DEMO_TIMELINE_STEPS)[number]["id"];

export interface HealingDemoIdentity {
  product: "SourcePulse";
  guardian: "Sentinel";
  sourceId: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  providerName: string | null;
  collectorLabel: string;
  isolationNote: string;
}

export interface HealingDemoBrightDataView {
  collectorId: string | null;
  studio: "Scraper Studio";
  healRequested: boolean;
  healRequestedAt: string | null;
  previewState:
    | "idle"
    | "requested"
    | "waiting"
    | "returned"
    | "failed"
    | "validated"
    | null;
  approvalState: "not_required" | "blocked" | "available" | "approved" | null;
  rerunState: "idle" | "in_progress" | "complete" | null;
  refactorJobId: string | null;
}

export interface HealingDemoIncidentView {
  id: string;
  status: SentinelIncidentStatus;
  severity: SentinelSeverity;
  reasonCodes: SentinelReasonCode[];
  summary: string | null;
  recordsSeen: number | null;
  recordsValid: number | null;
  recordsInvalid: number | null;
  healingAttemptCount: number;
  createdAt: string;
}

export interface HealingDemoQuarantineView {
  active: boolean;
  summary: string | null;
  at: string | null;
}

export interface HealingDemoHealingView {
  attemptNumber: number | null;
  status: string | null;
  startedAt: string | null;
  completedAt: string | null;
  summary: string | null;
}

export interface HealingDemoPreviewView {
  state: HealingDemoBrightDataView["previewState"];
  returnedAt: string | null;
  summary: string | null;
}

export interface HealingDemoValidationView {
  passed: boolean | null;
  summary: string | null;
  at: string | null;
}

export interface HealingDemoApprovalView {
  available: boolean;
  approved: boolean;
  at: string | null;
  summary: string | null;
}

export interface HealingDemoRerunView {
  state: HealingDemoBrightDataView["rerunState"];
  at: string | null;
  summary: string | null;
}

export interface HealingDemoRecoveryView {
  recovered: boolean;
  at: string | null;
  summary: string | null;
}

export interface HealingDemoTimelineStage {
  id: string;
  stepId: HealingDemoTimelineStepId | string;
  label: string;
  evidence: string | null;
  at: string | null;
  durationMs: number | null;
  status: SentinelStageStatus;
}

/**
 * The demonstration's durable record, separate from the phase it is parked in.
 *
 * A reset returns the stage to its starting position; it does not erase the
 * incidents and healing attempts already on file. This carries those facts so
 * the page can say the feature has genuinely completed a live recovery while
 * still reporting, truthfully, that the current phase is not started.
 */
export interface HealingDemoHistoryView {
  hasCompletedRecovery: boolean;
  completedRecoveries: number;
  lastRecoveryAt: string | null;
  healingAttemptsRecorded: number;
  approvedHealingAttempts: number;
  lastKnownGoodCount: number | null;
  lastKnownGoodAt: string | null;
}

// ---------------------------------------------------------------------------
// Historical recovery proof
// ---------------------------------------------------------------------------

/**
 * The replay of a recovery that already happened, read back from the rows it
 * left behind.
 *
 * This is deliberately *not* the demo's current state. The phase above says
 * where the demonstration is parked right now — often "not started" — while
 * this says what the source has already been through and survived. A judge can
 * read the proof on a clean stage without either claim contradicting the other,
 * which is why the two live in separate fields rather than one merged status.
 *
 * Every field is derived from persisted evidence: collection runs, Sentinel
 * incidents, quarantine payload references, healing attempts and canonical
 * rows. Nothing here is asserted that the database does not already record —
 * a fact with no row behind it is reported as unavailable rather than invented.
 * There is no action, dispatch or write anywhere in this shape.
 */
export const HEALING_DEMO_RECOVERY_STAGE_IDS = [
  "trusted_baseline",
  "source_layout_changed",
  "invalid_extraction",
  "sentinel_detected",
  "quarantined",
  "last_known_good_preserved",
  "bright_data_repair",
  "candidate_validated",
  "approved",
  "recovery_rerun",
  "recovered",
] as const;

export type HealingDemoRecoveryStageId =
  (typeof HEALING_DEMO_RECOVERY_STAGE_IDS)[number];

export const HEALING_DEMO_RECOVERY_STAGE_LABELS: Record<
  HealingDemoRecoveryStageId,
  string
> = {
  trusted_baseline: "Trusted baseline",
  source_layout_changed: "Source layout changed",
  invalid_extraction: "Invalid extraction",
  sentinel_detected: "Sentinel detected the violation",
  quarantined: "Payload quarantined",
  last_known_good_preserved: "Last-known-good preserved",
  bright_data_repair: "Bright Data repaired the collector",
  candidate_validated: "Candidate validated through the same gate",
  approved: "Repair approved",
  recovery_rerun: "Recovery re-run",
  recovered: "Source recovered",
};

/**
 * Whether a stage is a recorded database observation or truthful context.
 *
 * `observed` means one or more rows stand behind the stage and its timestamp
 * is theirs. `context` means the stage describes the demonstration's fixed,
 * public setup — the two allowlisted layouts — which is true but was never
 * written to a table as an event. Marking the difference is what stops the
 * replay from quietly upgrading configuration into evidence.
 */
export type HealingDemoRecoveryStageKind = "observed" | "context";

export interface HealingDemoRecoveryEvidenceItem {
  label: string;
  value: string;
}

export interface HealingDemoRecoveryStage {
  id: HealingDemoRecoveryStageId;
  /** Fixed position in `HEALING_DEMO_RECOVERY_STAGE_IDS`. Never re-sorted. */
  order: number;
  kind: HealingDemoRecoveryStageKind;
  title: string;
  /** Recorded time of the row behind the stage; `null` for context stages. */
  at: string | null;
  summary: string;
  evidence: HealingDemoRecoveryEvidenceItem[];
}

export interface HealingDemoRecoverySourceView {
  label: string;
  healthyUrl: string | null;
  brokenUrl: string | null;
}

export interface HealingDemoRecoveryCollectorView {
  /**
   * The dedicated demo collector. Public: the same identifier is already
   * published for every source by the sources read model. Never a key.
   */
  ref: string | null;
  /**
   * True only when every healing attempt on the incident recorded the same
   * collector, and that collector is the one the recovered source is
   * registered against.
   */
  sameCollectorConfirmed: boolean;
  sameCollectorEvidence: string | null;
  refactorJobId: string | null;
}

export type HealingDemoRecoveryFinalState =
  | "recovered"
  | "approved_awaiting_rerun";

export interface HealingDemoRecoverySummaryView {
  baselineRecords: number | null;
  failedRecords: number | null;
  recoveredRecords: number | null;
  lastKnownGoodPreserved: boolean;
  lastKnownGoodEvidence: string | null;
  /** Derived from the canonical row count of the refused run. Never asserted. */
  zeroBadCanonicalWrites: boolean;
  canonicalWritesFromInvalidRun: number | null;
  reasonCodes: string[];
  finalState: HealingDemoRecoveryFinalState;
  incidentId: string | null;
  incidentStatus: SentinelIncidentStatus | null;
  baselineRunId: string | null;
  invalidRunId: string | null;
  recoveryRunId: string | null;
  /** True when baseline, invalid and recovery are three different runs. */
  distinctRunIds: boolean;
}

export interface HealingDemoRecoveryProof {
  available: boolean;
  unavailableReason: string | null;
  /**
   * Marks the payload as a replay of the past. It is a literal so no caller can
   * mistake this block for the demo's live state.
   */
  isHistorical: true;
  /** False when any dependency behind the recorded evidence was a double. */
  isLiveEvidence: boolean;
  note: string;
  title: string | null;
  recoveredAt: string | null;
  source: HealingDemoRecoverySourceView | null;
  collector: HealingDemoRecoveryCollectorView | null;
  summary: HealingDemoRecoverySummaryView | null;
  stages: HealingDemoRecoveryStage[];
}

export const HEALING_DEMO_RECOVERY_PROOF_NOTE =
  "Historical evidence from a recovery that already completed. It is not the "
  + "demonstration's current phase and no control on this page replays it.";

export function unavailableHealingDemoRecoveryProof(
  reason: string,
): HealingDemoRecoveryProof {
  return {
    available: false,
    unavailableReason: reason,
    isHistorical: true,
    isLiveEvidence: false,
    note: HEALING_DEMO_RECOVERY_PROOF_NOTE,
    title: null,
    recoveredAt: null,
    source: null,
    collector: null,
    summary: null,
    stages: [],
  };
}

export function healingDemoRecoveryStageOrder(
  id: HealingDemoRecoveryStageId,
): number {
  return HEALING_DEMO_RECOVERY_STAGE_IDS.indexOf(id);
}

export interface HealingDemoLinks {
  sourceHealthHref: string;
  sourceDetailHref: string | null;
  provenanceHref: string | null;
}

/**
 * Backend-owned snapshot. Claude's real healing demo fills this in. Missing
 * fields stay missing; the projector does not invent stages or recovery.
 */
export interface HealingDemoBackendSnapshot {
  generatedAt: string;
  phase: HealingDemoPhase;
  phaseLabel?: string;
  sentinelStatus: SentinelStatus;
  identity: HealingDemoIdentity;
  brightData: HealingDemoBrightDataView | null;
  lastKnownGood: SentinelSnapshotView | null;
  candidate: SentinelSnapshotView | null;
  comparisonMode: "healthy" | "quarantine" | "recovered" | "none";
  incident: HealingDemoIncidentView | null;
  quarantine: HealingDemoQuarantineView | null;
  healing: HealingDemoHealingView | null;
  preview: HealingDemoPreviewView | null;
  validation: HealingDemoValidationView | null;
  approval: HealingDemoApprovalView | null;
  rerun: HealingDemoRerunView | null;
  recovery: HealingDemoRecoveryView | null;
  history: HealingDemoHistoryView | null;
  /**
   * Historical recovery evidence. Optional so a backend that has none simply
   * omits it and the projector reports it unavailable — never fabricated.
   */
  recoveryProof?: HealingDemoRecoveryProof | null;
  timeline: HealingDemoTimelineStage[];
  allowedActions: HealingDemoAction[];
  pollAfterMs: number | null;
  busy?: boolean;
}

export interface HealingDemoReadModel {
  available: boolean;
  unavailableTitle: string | null;
  unavailableReason: string | null;
  kind: HealingDemoKind;
  kindLabel: string;
  generatedAt: string;
  adapterId: string;
  isFixture: boolean;
  /** True only for the explicit test/dev fixture. Never for the real demo. */
  isDemo: boolean;
  phase: HealingDemoPhase | null;
  phaseLabel: string | null;
  sentinelStatus: SentinelStatus | null;
  identity: HealingDemoIdentity | null;
  brightData: HealingDemoBrightDataView | null;
  lastKnownGood: SentinelSnapshotView | null;
  candidate: SentinelSnapshotView | null;
  comparisonMode: "healthy" | "quarantine" | "recovered" | "none";
  incident: HealingDemoIncidentView | null;
  quarantine: HealingDemoQuarantineView | null;
  healing: HealingDemoHealingView | null;
  preview: HealingDemoPreviewView | null;
  validation: HealingDemoValidationView | null;
  approval: HealingDemoApprovalView | null;
  rerun: HealingDemoRerunView | null;
  recovery: HealingDemoRecoveryView | null;
  history: HealingDemoHistoryView | null;
  /** Always present. `available: false` when no recovery is on record. */
  recoveryProof: HealingDemoRecoveryProof;
  timeline: HealingDemoTimelineStage[];
  allowedActions: HealingDemoAction[];
  links: HealingDemoLinks;
  pollAfterMs: number | null;
  busy: boolean;
}

export interface HealingDemoAdapter {
  readonly id: string;
  readonly label: string;
  readonly isFixture: boolean;
  getState(): Promise<HealingDemoReadModel>;
  runAction(action: HealingDemoAction): Promise<HealingDemoReadModel>;
}

export const HEALING_DEMO_PHASE_LABELS: Record<HealingDemoPhase, string> = {
  healthy: "Healthy",
  break: "Break",
  detected: "Detected",
  quarantined: "Quarantined",
  healing: "Healing",
  preview_waiting: "Preview",
  preview_failed: "Preview failed",
  preview_validated: "Preview validated",
  approved: "Approved",
  rerun: "Rerun",
  recovered: "Recovered",
};

export const DEFAULT_HEALING_DEMO_IDENTITY: HealingDemoIdentity = {
  product: "SourcePulse",
  guardian: "Sentinel",
  sourceId: null,
  sourceName: null,
  sourceUrl: null,
  providerName: null,
  collectorLabel: "Bright Data Scraper Studio",
  isolationNote:
    "Controls affect only this isolated demo source. They cannot retarget another collector, URL or production source.",
};

let installedAdapter: HealingDemoAdapter | null = null;
let defaultAdapterFactory: (() => HealingDemoAdapter) | null = null;

export function registerDefaultHealingDemoAdapter(
  factory: () => HealingDemoAdapter,
): void {
  defaultAdapterFactory = factory;
}

export function setHealingDemoAdapter(adapter: HealingDemoAdapter | null): void {
  installedAdapter = adapter;
}

export function getHealingDemoAdapter(): HealingDemoAdapter {
  if (installedAdapter) return installedAdapter;
  if (!defaultAdapterFactory) {
    throw new Error(
      "No healing demo adapter is installed. Import the canonical adapter or call setHealingDemoAdapter().",
    );
  }
  installedAdapter = defaultAdapterFactory();
  return installedAdapter;
}

export function isHealingDemoPhase(value: unknown): value is HealingDemoPhase {
  return (
    typeof value === "string" &&
    (HEALING_DEMO_PHASES as readonly string[]).includes(value)
  );
}

export function isHealingDemoAction(value: unknown): value is HealingDemoAction {
  return (
    typeof value === "string" &&
    (HEALING_DEMO_ACTIONS as readonly string[]).includes(value)
  );
}

export function healingDemoActionLabel(action: HealingDemoAction): string {
  return HEALING_DEMO_ACTION_LABELS[action];
}

export function isDangerousHealingDemoAction(action: HealingDemoAction): boolean {
  return HEALING_DEMO_DANGEROUS_ACTIONS.includes(action);
}

export function healingDemoPhaseLabel(phase: HealingDemoPhase | null): string | null {
  return phase ? HEALING_DEMO_PHASE_LABELS[phase] : null;
}

export function sourceDetailHref(sourceId: string | null | undefined): string | null {
  if (!sourceId) return null;
  return `/sources/${encodeURIComponent(sourceId)}`;
}

export function healingDemoHref(): string {
  return HEALING_DEMO_HREF;
}

export function sanitizeHealingDemoActions(
  actions: readonly unknown[] | null | undefined,
): HealingDemoAction[] {
  if (!actions) return [];
  const seen = new Set<HealingDemoAction>();
  const allowed: HealingDemoAction[] = [];
  for (const action of actions) {
    if (!isHealingDemoAction(action) || seen.has(action)) continue;
    seen.add(action);
    allowed.push(action);
  }
  return allowed;
}

export function timelineToSentinelStages(
  stages: readonly HealingDemoTimelineStage[],
): SentinelTimelineStage[] {
  return stages.map((stage) => ({
    id: stage.id,
    label: stage.label,
    detail: stage.evidence ?? undefined,
    at: stage.at,
    status: stage.status,
    durationMs: stage.durationMs,
  }));
}

export function unavailableHealingDemoReadModel(input?: {
  generatedAt?: string;
  adapterId?: string;
  reason?: string;
}): HealingDemoReadModel {
  return {
    available: false,
    unavailableTitle: HEALING_DEMO_UNAVAILABLE_TITLE,
    unavailableReason:
      input?.reason ??
      "Claude's real Bright Data healing backend is not registered yet. This page will not substitute the in-memory Sentinel demo.",
    kind: "unavailable",
    kindLabel: HEALING_DEMO_KIND_LABELS.unavailable,
    generatedAt: input?.generatedAt ?? new Date(0).toISOString(),
    adapterId: input?.adapterId ?? "uninstalled",
    isFixture: false,
    isDemo: false,
    phase: null,
    phaseLabel: null,
    sentinelStatus: null,
    identity: {
      ...DEFAULT_HEALING_DEMO_IDENTITY,
    },
    brightData: null,
    lastKnownGood: null,
    candidate: null,
    comparisonMode: "none",
    incident: null,
    quarantine: null,
    healing: null,
    preview: null,
    validation: null,
    approval: null,
    rerun: null,
    recovery: null,
    history: null,
    recoveryProof: unavailableHealingDemoRecoveryProof(
      "The healing demo backend is unavailable, so no persisted recovery evidence could be read.",
    ),
    timeline: [],
    allowedActions: [],
    links: {
      sourceHealthHref: SOURCE_HEALTH_HREF,
      sourceDetailHref: null,
      provenanceHref: null,
    },
    pollAfterMs: null,
    busy: false,
  };
}

export function projectHealingDemoSnapshot(
  snapshot: HealingDemoBackendSnapshot,
  meta: { adapterId: string; kind: Exclude<HealingDemoKind, "unavailable">; isFixture: boolean },
): HealingDemoReadModel {
  const phase = isHealingDemoPhase(snapshot.phase) ? snapshot.phase : null;
  const approval = snapshot.approval
    ? {
        ...snapshot.approval,
        available: snapshot.approval.available === true && snapshot.validation?.passed === true,
      }
    : null;
  const allowedActions = sanitizeHealingDemoActions(snapshot.allowedActions).filter(
    (action) => action !== "approve_preview" || approval?.available === true,
  );

  return {
    available: true,
    unavailableTitle: null,
    unavailableReason: null,
    kind: meta.kind,
    kindLabel: HEALING_DEMO_KIND_LABELS[meta.kind],
    generatedAt: snapshot.generatedAt,
    adapterId: meta.adapterId,
    isFixture: meta.isFixture,
    isDemo: meta.isFixture,
    phase,
    phaseLabel: snapshot.phaseLabel ?? healingDemoPhaseLabel(phase),
    sentinelStatus: snapshot.sentinelStatus,
    identity: snapshot.identity,
    brightData: snapshot.brightData,
    lastKnownGood: snapshot.lastKnownGood,
    candidate: snapshot.candidate,
    comparisonMode: snapshot.comparisonMode,
    incident: snapshot.incident,
    quarantine: snapshot.quarantine,
    healing: snapshot.healing,
    preview: snapshot.preview,
    validation: snapshot.validation,
    approval,
    rerun: snapshot.rerun,
    recovery: snapshot.recovery,
    history: snapshot.history ?? null,
    // Carried across untouched, or reported unavailable. The projector has no
    // branch that can manufacture a stage the backend did not report.
    recoveryProof:
      snapshot.recoveryProof ??
      unavailableHealingDemoRecoveryProof(
        "This healing demo backend reports no persisted recovery evidence.",
      ),
    timeline: snapshot.timeline,
    allowedActions,
    links: {
      sourceHealthHref: SOURCE_HEALTH_HREF,
      sourceDetailHref: sourceDetailHref(snapshot.identity.sourceId),
      provenanceHref: sourceDetailHref(snapshot.identity.sourceId)
        ? `${sourceDetailHref(snapshot.identity.sourceId)}#source-provenance`
        : null,
    },
    pollAfterMs: snapshot.pollAfterMs,
    busy: snapshot.busy === true,
  };
}
