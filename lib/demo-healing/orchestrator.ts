/**
 * The self-healing demonstration state machine.
 *
 * Each action below is one step a presenter can take, and each one does real
 * work: it runs the real collector, calls the real Sentinel gate, or talks to
 * the real Bright Data refactor API. None of them sets a health status
 * directly, fabricates an incident, or returns a canned recovery — the phase
 * recorded in `sentinel_demo_state` is always a *description* of what the
 * underlying machinery just did, never a substitute for doing it.
 *
 * Server-only.
 */

import { BrightDataClient } from "../brightdata/client";
import type { CollectorRunResult } from "../brightdata/types";
import { SentinelQuarantineError } from "../pipeline";
import { evaluateSourceHealth } from "../sentinel/evaluator";
import { createSentinelRepository, type SentinelRepository } from "../sentinel/repository";
import { getNextIncidentStatus } from "../sentinel/state-machine";
import type { SentinelEvaluationResult } from "../sentinel/types";
import type { Json, SentinelDemoPhase, SentinelDemoStateRow } from "../supabase/types";
import {
  createDemoPreviewContract,
  createDemoSourceHealthContract,
  type RawDemoQuoteRecord,
} from "./contract";
import {
  BrightDataDemoHealer,
  buildDemoHealingPrompt,
  type DemoCollectorHealer,
} from "./healer";
import {
  ingestDemoObservation,
  type DemoPipelineRepository,
} from "./persistence";
import {
  createDemoHarnessRepository,
  type DemoHarnessRepository,
} from "./repository";
import {
  assertDemoSourceKey,
  DEMO_SOURCE_KEY,
  DEMO_TEMPLATE_BREAK_PROMPT,
  DEMO_TEMPLATE_RESTORE_PROMPT,
  resolveDemoSourceConfiguration,
  type DemoLayout,
  type DemoSourceConfiguration,
} from "./source";

/** Every step the demo exposes. Nothing else is callable over HTTP. */
export type DemoAction =
  | "reset"
  | "run_baseline"
  | "arm_failure"
  | "break_template"
  | "run_broken"
  | "request_heal"
  | "validate_preview"
  | "approve"
  | "rerun";

export const DEMO_ACTIONS: readonly DemoAction[] = [
  "reset",
  "run_baseline",
  "arm_failure",
  "break_template",
  "run_broken",
  "request_heal",
  "validate_preview",
  "approve",
  "rerun",
];

export function isDemoAction(value: unknown): value is DemoAction {
  return typeof value === "string" && (DEMO_ACTIONS as readonly string[]).includes(value);
}

/** Runs the demo collector against one of the two allowlisted layouts. */
export interface DemoCollectorRunner {
  run(
    configuration: DemoSourceConfiguration,
    layout: DemoLayout,
  ): Promise<CollectorRunResult<unknown>>;
}

export class BrightDataDemoCollectorRunner implements DemoCollectorRunner {
  private readonly client: BrightDataClient;

  constructor(client?: BrightDataClient) {
    this.client = client ?? new BrightDataClient();
  }

  public run(
    configuration: DemoSourceConfiguration,
    layout: DemoLayout,
  ): Promise<CollectorRunResult<unknown>> {
    // The URL comes from the two-entry layout allowlist, never from a caller.
    const url = configuration.layouts[layout].url;
    return this.client.runCollector({
      collectorId: configuration.collectorId,
      inputs: [{ url }],
    });
  }
}

export interface DemoOrchestratorDependencies {
  configuration?: DemoSourceConfiguration;
  harness?: DemoHarnessRepository;
  sentinelRepository?: SentinelRepository;
  pipelineRepository?: DemoPipelineRepository;
  collector?: DemoCollectorRunner;
  healer?: DemoCollectorHealer;
  now?: () => Date;
  /**
   * False when any Bright Data or Supabase dependency is a double. The read
   * model surfaces this verbatim so a rehearsal is never mistaken for a live
   * proof.
   */
  live?: boolean;
  /** Bounds `request_heal`. Real refactors take minutes, not seconds. */
  healTimeoutMs?: number;
}

export interface DemoActionResult {
  action: DemoAction;
  status: "ok" | "refused" | "failed";
  phase: SentinelDemoPhase;
  summary: string;
  /** Populated only for authorized callers by the handler. */
  detail?: Json;
}

const DEMO_TRIGGERED_BY = "sentinel-demo-harness";

/**
 * Serialises a detail payload for the event journal. Round-tripping through
 * JSON is not ceremony: it guarantees the value really is storable as `jsonb`
 * rather than asserting it.
 */
function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function evaluationDetail(evaluation: SentinelEvaluationResult): Json {
  return asJson({
    status: evaluation.status,
    reasonCodes: evaluation.reasonCodes,
    recordsSeen: evaluation.recordsSeen,
    recordsValid: evaluation.recordsValid,
    recordsInvalid: evaluation.recordsInvalid,
    summary: evaluation.summary,
    issues: evaluation.issues.slice(0, 10).map((issue) => issue.message),
  });
}

export class DemoHealingOrchestrator {
  private readonly configuration: DemoSourceConfiguration;
  private readonly harness: DemoHarnessRepository;
  private readonly sentinelRepository: SentinelRepository;
  private readonly pipelineRepository?: DemoPipelineRepository;
  private readonly collector: DemoCollectorRunner;
  private readonly healer: DemoCollectorHealer;
  private readonly now: () => Date;
  private readonly live: boolean;
  private readonly healTimeoutMs: number;

  constructor(dependencies: DemoOrchestratorDependencies = {}) {
    this.configuration = dependencies.configuration ?? resolveDemoSourceConfiguration();
    this.harness = dependencies.harness ?? createDemoHarnessRepository();
    this.sentinelRepository = dependencies.sentinelRepository ?? createSentinelRepository();
    this.pipelineRepository = dependencies.pipelineRepository;
    this.collector = dependencies.collector ?? new BrightDataDemoCollectorRunner();
    this.healer = dependencies.healer ?? new BrightDataDemoHealer();
    this.now = dependencies.now ?? (() => new Date());
    this.live = dependencies.live ?? true;
    this.healTimeoutMs = dependencies.healTimeoutMs ?? 600_000;

    assertDemoSourceKey(this.configuration.sourceKey);
  }

  public getConfiguration(): DemoSourceConfiguration {
    return this.configuration;
  }

  public getHarnessRepository(): DemoHarnessRepository {
    return this.harness;
  }

  public async getState(): Promise<SentinelDemoStateRow> {
    return this.harness.getState();
  }

  public async execute(action: DemoAction): Promise<DemoActionResult> {
    switch (action) {
      case "reset":
        return this.reset();
      case "run_baseline":
        return this.runObservation("run_baseline", "healthy");
      case "arm_failure":
        return this.armFailure();
      case "break_template":
        return this.breakTemplate();
      case "run_broken":
        return this.runObservation("run_broken", await this.armedLayout());
      case "request_heal":
        return this.requestHeal();
      case "validate_preview":
        return this.validatePreview();
      case "approve":
        return this.approve();
      case "rerun":
        return this.runObservation("rerun", await this.armedLayout());
    }
  }

  // -------------------------------------------------------------------------
  // reset — return the demo to a repeatable starting point
  // -------------------------------------------------------------------------

  /**
   * Points the collector back at the healthy layout and clears the phase
   * markers. Historical runs, incidents and canonical rows are left in place:
   * resetting the demonstration must not erase the evidence it produced.
   */
  private async reset(): Promise<DemoActionResult> {
    const previous = await this.harness.getState();
    await this.harness.clearEvents();

    // A layout break is undone by pointing back at the healthy page. A template
    // break left a defective template on the collector, so undoing it means a
    // real restorative refactor — otherwise "reset" would hand the next
    // presenter a broken collector.
    let restoreNote = "";
    if (previous.break_mode === "template") {
      try {
        await this.healer.requestHeal({
          collectorId: this.configuration.collectorId,
          prompt: DEMO_TEMPLATE_RESTORE_PROMPT,
        });
        const gate = await this.healer.waitForGate(this.configuration.collectorId, {
          timeoutMs: this.healTimeoutMs,
        });
        if (gate.kind === "awaiting_approval") {
          await this.healer.applyDecision(this.configuration.collectorId, true);
          restoreNote = " The defective template was repaired and re-approved.";
        } else if (gate.kind === "completed_without_gate") {
          restoreNote = " The defective template was repaired.";
        } else {
          restoreNote =
            ` The collector template could NOT be restored (${gate.error}); repair it before the next run.`;
        }
      } catch (error) {
        restoreNote = ` The collector template could NOT be restored (${
          error instanceof Error ? error.message : String(error)
        }); repair it before the next run.`;
      }
    }

    await this.harness.patchState({
      armedLayout: "healthy",
      breakMode: "layout",
      phase: "unprepared",
      baselineRunId: null,
      brokenRunId: null,
      recoveredRunId: null,
      currentIncidentId: null,
      currentHealingAttemptId: null,
      healingJobId: null,
      healingRequestedAt: null,
      previewRecordsCount: null,
      previewPassed: null,
      previewReasonCodes: [],
      previewSummary: null,
      approvalState: "not_requested",
      approvedAt: null,
      isLive: this.live,
    });
    return this.emit({
      action: "reset",
      status: "ok",
      phase: "unprepared",
      summary: `Demo reset. The collector is pointed back at the healthy layout.${restoreNote}`,
    });
  }

  // -------------------------------------------------------------------------
  // arm_failure — the controlled break
  // -------------------------------------------------------------------------

  /**
   * Selects the second allowlisted layout. This changes *which page the real
   * collector is asked to scrape*; it does not touch the collector's health,
   * its incidents, or its data. The failure only materialises when the
   * collector actually runs against that layout and its selectors miss.
   */
  private async armFailure(): Promise<DemoActionResult> {
    const state = await this.harness.getState();
    if (state.phase === "unprepared") {
      return this.emit({
        action: "arm_failure",
        status: "refused",
        phase: state.phase,
        summary:
          "Refusing to arm the failure before a healthy baseline exists — without one there is no last-known-good to protect.",
      });
    }
    await this.harness.patchState({ armedLayout: "broken", phase: "failure_armed" });
    return this.emit({
      action: "arm_failure",
      status: "ok",
      phase: "failure_armed",
      summary:
        "Collector re-pointed at the alternate page layout. Its extraction template has not been told about the change.",
      detail: asJson({ layout: this.configuration.layouts.broken.description }),
    });
  }

  // -------------------------------------------------------------------------
  // break_template — contingency break, when no controllable page is reachable
  // -------------------------------------------------------------------------

  /**
   * Installs a genuinely defective extraction template through a real Bright
   * Data refactor, and approves it deliberately.
   *
   * This is the one place the harness approves a candidate without Sentinel
   * having passed it, and it is not a hole in the gate: it is the *break*. The
   * candidate being approved here is the broken one, and the payload it goes
   * on to produce still has to face the gate like any other, where it is
   * refused. Nothing downstream is bypassed.
   */
  private async breakTemplate(): Promise<DemoActionResult> {
    const state = await this.harness.getState();
    if (state.phase === "unprepared") {
      return this.emit({
        action: "break_template",
        status: "refused",
        phase: state.phase,
        summary:
          "Refusing to break the template before a healthy baseline exists — without one there is no last-known-good to protect.",
      });
    }

    try {
      await this.healer.requestHeal({
        collectorId: this.configuration.collectorId,
        prompt: DEMO_TEMPLATE_BREAK_PROMPT,
      });
      const gate = await this.healer.waitForGate(this.configuration.collectorId, {
        timeoutMs: this.healTimeoutMs,
      });
      if (gate.kind === "failed" || gate.kind === "timed_out") {
        return this.emit({
          action: "break_template",
          status: "failed",
          phase: state.phase,
          summary: `Could not install the defective template: ${gate.error}`,
        });
      }
      if (gate.kind === "awaiting_approval") {
        await this.healer.applyDecision(this.configuration.collectorId, true);
      }
    } catch (error) {
      return this.emit({
        action: "break_template",
        status: "failed",
        phase: state.phase,
        summary: `Could not install the defective template: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }

    // The template is now broken, so the healthy layout is the right target:
    // the page is fine and the scraper is not.
    await this.harness.patchState({
      breakMode: "template",
      armedLayout: "healthy",
      phase: "failure_armed",
    });
    return this.emit({
      action: "break_template",
      status: "ok",
      phase: "failure_armed",
      summary:
        "A defective extraction template was installed on the demo collector through a real Scraper Studio refactor. The page is unchanged.",
    });
  }

  // -------------------------------------------------------------------------
  // run_baseline / run_broken / rerun — one real collector run each
  // -------------------------------------------------------------------------

  private async runObservation(
    action: Extract<DemoAction, "run_baseline" | "run_broken" | "rerun">,
    layout: DemoLayout,
  ): Promise<DemoActionResult> {
    const state = await this.harness.getState();

    if (action === "run_broken" && state.phase !== "failure_armed") {
      return this.emit({
        action,
        status: "refused",
        phase: state.phase,
        summary: "The failure is not armed; there is nothing broken to run.",
      });
    }
    if (action === "rerun" && state.approval_state !== "approved") {
      return this.emit({
        action,
        status: "refused",
        phase: state.phase,
        summary:
          "Refusing to re-run: the repaired template has not been approved, so the collector still carries the failing extraction.",
      });
    }

    const collection = await this.collector.run(this.configuration, layout);
    const collectorError = collection.success
      ? null
      : (collection.metadata.error ?? collection.error?.message ?? "Collector run failed");

    try {
      const result = await ingestDemoObservation({
        configuration: this.configuration,
        layout,
        rawRecords: collection.data,
        collectorError,
        externalRunId: collection.metadata.runId ?? null,
        triggeredBy: DEMO_TRIGGERED_BY,
        observedAt: this.now().toISOString(),
        repository: this.pipelineRepository,
        sentinelRepository: this.sentinelRepository,
      });

      const phase: SentinelDemoPhase = action === "rerun" ? "recovered" : "healthy";
      await this.harness.patchState({
        sourceId: result.sourceId,
        phase,
        isLive: this.live,
        ...(action === "run_baseline" ? { baselineRunId: result.collectionRunId } : {}),
        ...(action === "rerun"
          ? {
              recoveredRunId: result.collectionRunId,
              currentIncidentId: null,
            }
          : {}),
      });

      return this.emit({
        action,
        status: "ok",
        phase,
        runId: result.collectionRunId,
        summary:
          action === "rerun"
            ? `Repaired collector re-ran and passed the same Sentinel gate: ${result.acceptedCount} records persisted. Source recovered.`
            : `Collector run accepted by Sentinel: ${result.acceptedCount} records persisted.`,
        detail: asJson({
          externalRunId: result.externalRunId,
          sentinel: result.sentinel,
          layout,
        }),
      });
    } catch (error) {
      if (error instanceof SentinelQuarantineError) {
        await this.harness.patchState({
          sourceId: error.sourceId,
          phase: "quarantined",
          currentIncidentId: error.incidentId,
          isLive: this.live,
          ...(action === "run_broken" ? { brokenRunId: error.collectionRunId ?? null } : {}),
        });
        return this.emit({
          action,
          status: "refused",
          phase: "quarantined",
          runId: error.collectionRunId ?? null,
          incidentId: error.incidentId,
          summary:
            `Sentinel refused the payload and quarantined it: ${error.reasonCodes.join(", ") || "contract violation"}. `
            + "No canonical record was written and the last-known-good run still stands.",
          detail: asJson({
            reasonCodes: error.reasonCodes,
            recordsSeen: error.recordsSeen,
            recordsValid: error.recordsValid,
            recordsInvalid: error.recordsInvalid,
            collectorError,
          }),
        });
      }
      const message = error instanceof Error ? error.message : String(error);
      return this.emit({
        action,
        status: "failed",
        phase: state.phase,
        summary: `Demo observation failed before a verdict could be reached: ${message}`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // request_heal — real Bright Data refactor up to the approval gate
  // -------------------------------------------------------------------------

  /**
   * Healing is only ever requested for a source that actually failed. The
   * open incident is the qualification: without one there is nothing to repair
   * and the request is refused rather than sent to Bright Data.
   */
  private async requestHeal(): Promise<DemoActionResult> {
    const state = await this.harness.getState();
    // Retrying after a rejected candidate is the same request, not a new one:
    // the incident is still open and still unrepaired. Refusing it here would
    // strand the demo, and would make the healing budget below unreachable.
    const healablePhases: SentinelDemoPhase[] = ["quarantined", "preview_rejected"];
    if (
      !state.source_id
      || !state.current_incident_id
      || !healablePhases.includes(state.phase)
    ) {
      return this.emit({
        action: "request_heal",
        status: "refused",
        phase: state.phase,
        summary:
          "Refusing to request healing: no open Sentinel incident. Healing follows a real failure, it does not precede one.",
      });
    }

    const incident = (await this.sentinelRepository.getLatestOpenIncident(state.source_id)) ?? null;
    if (!incident) {
      return this.emit({
        action: "request_heal",
        status: "refused",
        phase: state.phase,
        summary: "Refusing to request healing: the incident is no longer open.",
      });
    }

    const contract = createDemoSourceHealthContract(state.source_id);
    const attemptNumber = incident.healing_attempt_count + 1;
    if (attemptNumber > contract.failurePolicy.maxHealingAttempts) {
      await this.sentinelRepository.updateIncident(incident.id, {
        status: getNextIncidentStatus("open", "max_retries_exceeded"),
        resolutionNote: `Healing budget exhausted after ${contract.failurePolicy.maxHealingAttempts} attempts.`,
      });
      await this.harness.patchState({ phase: "needs_review" });
      return this.emit({
        action: "request_heal",
        status: "refused",
        phase: "needs_review",
        incidentId: incident.id,
        summary: `Healing budget exhausted after ${contract.failurePolicy.maxHealingAttempts} attempts; the collector needs a human.`,
      });
    }

    // Reconstruct the verdict from the quarantined evidence so the repair
    // prompt describes the symptom Sentinel actually observed.
    const evaluation: SentinelEvaluationResult = {
      status: "quarantined",
      isHealthy: false,
      shouldQuarantine: true,
      reasonCodes: incident.reason_codes as SentinelEvaluationResult["reasonCodes"],
      summary: incident.summary ?? "",
      recordsSeen: incident.records_seen,
      recordsValid: incident.records_valid,
      recordsInvalid: incident.records_invalid,
      validRecords: [],
      invalidRecords: [],
      issues: [],
    };
    const prompt = buildDemoHealingPrompt(evaluation, {
      sourceUrl: this.configuration.layouts[state.armed_layout].url,
    });

    await this.sentinelRepository.updateIncident(incident.id, {
      status: "healing",
      healingAttemptCount: attemptNumber,
    });
    const attempt = await this.sentinelRepository.recordHealingAttempt({
      incidentId: incident.id,
      sourceId: state.source_id,
      collectorId: this.configuration.collectorId,
      attemptNumber,
      prompt,
      status: "initiated",
      startedAt: this.now().toISOString(),
    });
    await this.harness.patchState({
      phase: "healing",
      currentHealingAttemptId: attempt.id,
      healingRequestedAt: this.now().toISOString(),
      approvalState: "not_requested",
      previewPassed: null,
      previewReasonCodes: [],
      previewRecordsCount: null,
      previewSummary: null,
    });

    let jobId: string | null = null;
    try {
      const requested = await this.healer.requestHeal({
        collectorId: this.configuration.collectorId,
        prompt,
        // The armed layout is the input that just failed Sentinel; the repair
        // has to be generated and previewed against it, not against whatever
        // input the template still carries.
        sourceUrl: this.configuration.layouts[state.armed_layout].url,
      });
      jobId = requested.jobId;
      await this.harness.patchState({ healingJobId: jobId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.failAttempt(incident.id, state.source_id, attemptNumber, prompt, message);
      return this.emit({
        action: "request_heal",
        status: "failed",
        phase: "needs_review",
        incidentId: incident.id,
        summary: `Bright Data refused the refactor request: ${message}`,
      });
    }

    const gate = await this.healer.waitForGate(this.configuration.collectorId, {
      timeoutMs: this.healTimeoutMs,
    });

    if (gate.kind === "failed" || gate.kind === "timed_out") {
      await this.failAttempt(incident.id, state.source_id, attemptNumber, prompt, gate.error);
      return this.emit({
        action: "request_heal",
        status: "failed",
        phase: "needs_review",
        incidentId: incident.id,
        summary: `Bright Data healing did not produce a candidate: ${gate.error}`,
      });
    }

    const previewRecords = gate.previewRecords;
    const awaitingDecision = gate.kind === "awaiting_approval";

    await this.sentinelRepository.recordHealingAttempt({
      incidentId: incident.id,
      sourceId: state.source_id,
      collectorId: this.configuration.collectorId,
      attemptNumber,
      prompt,
      status: awaitingDecision ? "awaiting_approval" : "in_progress",
      refactorJobId: jobId,
      candidateRecordsCount: previewRecords.length,
    });
    await this.harness.patchState({
      phase: "healing",
      approvalState: awaitingDecision ? "awaiting_decision" : "not_requested",
      previewRecordsCount: previewRecords.length,
    });

    return this.emit({
      action: "request_heal",
      status: "ok",
      phase: "healing",
      incidentId: incident.id,
      summary: awaitingDecision
        ? `Bright Data produced a repaired template and is holding it for approval, with ${previewRecords.length} preview record(s) to judge.`
        : `Bright Data completed the refactor and returned ${previewRecords.length} preview record(s).`,
      detail: asJson({
        jobId,
        prompt,
        awaitingDecision,
        completedSteps: gate.completedSteps,
        diffSummary: gate.kind === "awaiting_approval" ? gate.diffSummary : null,
        previewRecords: previewRecords.slice(0, 5),
      }),
    });
  }

  private async failAttempt(
    incidentId: string,
    sourceId: string,
    attemptNumber: number,
    prompt: string,
    error: string,
  ): Promise<void> {
    await this.sentinelRepository.recordHealingAttempt({
      incidentId,
      sourceId,
      collectorId: this.configuration.collectorId,
      attemptNumber,
      prompt,
      status: "failed",
      candidatePassedValidation: false,
      errorMessage: error,
      completedAt: this.now().toISOString(),
    });
    await this.sentinelRepository.updateIncident(incidentId, {
      status: "needs_review",
      resolutionNote: `Healing attempt ${attemptNumber} failed: ${error}`,
    });
    await this.harness.patchState({ phase: "needs_review", approvalState: "not_requested" });
  }

  // -------------------------------------------------------------------------
  // validate_preview — the same contract, applied to the candidate
  // -------------------------------------------------------------------------

  /**
   * Judges Bright Data's candidate with `evaluateSourceHealth` and the demo's
   * own contract — the identical evaluation the gate runs on a real payload.
   * A candidate that would be quarantined as live data is rejected here, and
   * the approval path is closed behind it.
   */
  private async validatePreview(): Promise<DemoActionResult> {
    const state = await this.harness.getState();
    if (!state.source_id || state.phase !== "healing") {
      return this.emit({
        action: "validate_preview",
        status: "refused",
        phase: state.phase,
        summary: "There is no healing candidate awaiting validation.",
      });
    }

    const gate = await this.healer.waitForGate(this.configuration.collectorId, {
      timeoutMs: this.healTimeoutMs,
    });
    if (gate.kind === "failed" || gate.kind === "timed_out") {
      return this.emit({
        action: "validate_preview",
        status: "failed",
        phase: state.phase,
        summary: `Could not read the healing candidate: ${gate.error}`,
      });
    }

    // Judged with the preview-scoped contract: same record schema and same
    // semantic invariants, volume thresholds relaxed because a preview is a
    // sample. No baseline is passed for the same reason.
    const contract = createDemoPreviewContract(state.source_id);
    const evaluation = evaluateSourceHealth<RawDemoQuoteRecord>(
      gate.previewRecords,
      contract,
    );
    const passed = evaluation.isHealthy && !evaluation.shouldQuarantine;
    const phase: SentinelDemoPhase = passed ? "preview_validated" : "preview_rejected";

    await this.harness.patchState({
      phase,
      previewPassed: passed,
      previewRecordsCount: evaluation.recordsSeen,
      previewReasonCodes: evaluation.reasonCodes,
      previewSummary: evaluation.summary,
      approvalState: passed ? "awaiting_decision" : "rejected",
    });

    if (!passed) {
      // Sentinel's refusal has to reach Bright Data too. The refactor job is
      // parked at its approval gate; leaving it parked keeps the collector
      // locked, so the next `request_heal` is rejected with 409 and the
      // contract's remaining healing attempts can never be spent. Rejecting
      // releases the collector with the template it already had.
      //
      // A vendor failure here must not swallow the verdict: the candidate is
      // rejected either way, and the attempt below still records why.
      try {
        await this.healer.applyDecision(this.configuration.collectorId, false);
      } catch {
        // Reported through the refusal that follows.
      }
    }

    if (state.current_incident_id && !passed) {
      await this.sentinelRepository.recordHealingAttempt({
        incidentId: state.current_incident_id,
        sourceId: state.source_id,
        collectorId: this.configuration.collectorId,
        attemptNumber: await this.currentAttemptNumber(state.source_id),
        prompt: "(preview validation)",
        status: "candidate_rejected",
        candidateRecordsCount: evaluation.recordsSeen,
        candidatePassedValidation: false,
        errorMessage: evaluation.summary,
        completedAt: this.now().toISOString(),
      });
    }

    return this.emit({
      action: "validate_preview",
      status: passed ? "ok" : "refused",
      phase,
      incidentId: state.current_incident_id,
      summary: passed
        ? `Repaired candidate passed the same Sentinel contract: ${evaluation.recordsValid}/${evaluation.recordsSeen} records valid. It may now be approved.`
        : `Repaired candidate failed the same Sentinel contract: ${evaluation.summary}. Approval is refused.`,
      detail: evaluationDetail(evaluation as SentinelEvaluationResult),
    });
  }

  // -------------------------------------------------------------------------
  // approve — commit the repaired template, only on a passing preview
  // -------------------------------------------------------------------------

  private async approve(): Promise<DemoActionResult> {
    const state = await this.harness.getState();
    if (state.preview_passed !== true || state.phase !== "preview_validated") {
      // Tell Bright Data to discard the candidate rather than leaving the job
      // parked, then keep the collector on the template it already had.
      if (state.approval_state === "awaiting_decision") {
        await this.healer.applyDecision(this.configuration.collectorId, false).catch(() => undefined);
      }
      await this.harness.patchState({ approvalState: "rejected" });
      return this.emit({
        action: "approve",
        status: "refused",
        phase: state.phase,
        summary:
          "Refusing to approve: the candidate has not passed Sentinel validation. A failed preview is never approved.",
      });
    }

    await this.healer.applyDecision(this.configuration.collectorId, true);

    if (state.current_incident_id && state.source_id) {
      await this.sentinelRepository.recordHealingAttempt({
        incidentId: state.current_incident_id,
        sourceId: state.source_id,
        collectorId: this.configuration.collectorId,
        attemptNumber: await this.currentAttemptNumber(state.source_id),
        prompt: "(approval)",
        status: "approved",
        candidateRecordsCount: state.preview_records_count,
        candidatePassedValidation: true,
        completedAt: this.now().toISOString(),
      });
      await this.sentinelRepository.updateIncident(state.current_incident_id, {
        status: "resolved",
        resolutionNote:
          "Repaired collector template approved after passing Sentinel validation. Awaiting a verifying re-run.",
        resolvedAt: this.now().toISOString(),
      });
    }

    await this.harness.patchState({
      phase: "approved",
      approvalState: "approved",
      approvedAt: this.now().toISOString(),
    });

    return this.emit({
      action: "approve",
      status: "ok",
      phase: "approved",
      incidentId: state.current_incident_id,
      summary:
        "Repaired template approved and saved to the collector. The next run will exercise it through the same gate.",
    });
  }

  // -------------------------------------------------------------------------

  /** The layout the failure was armed against; the two break modes differ. */
  private async armedLayout(): Promise<DemoLayout> {
    return (await this.harness.getState()).armed_layout;
  }

  /**
   * Which healing attempt the incident is currently on. Read from the incident
   * rather than tracked separately, so the audit trail cannot disagree with it.
   */
  private async currentAttemptNumber(sourceId: string): Promise<number> {
    const incident = await this.sentinelRepository.getLatestOpenIncident(sourceId);
    return Math.max(1, incident?.healing_attempt_count ?? 1);
  }

  private async emit(
    input: {
      action: DemoAction;
      status: "ok" | "refused" | "failed";
      phase: SentinelDemoPhase;
      summary: string;
      runId?: string | null;
      incidentId?: string | null;
      detail?: Json;
    },
  ): Promise<DemoActionResult> {
    await this.harness.recordEvent({
      phase: input.phase,
      action: input.action,
      status: input.status,
      summary: input.summary,
      runId: input.runId ?? null,
      incidentId: input.incidentId ?? null,
      detail: input.detail ?? {},
    });
    return {
      action: input.action,
      status: input.status,
      phase: input.phase,
      summary: input.summary,
      detail: input.detail,
    };
  }
}

export { DEMO_SOURCE_KEY };
