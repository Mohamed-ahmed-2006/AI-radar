/**
 * Doubles for the self-healing demo harness.
 *
 * Only Bright Data and Supabase are replaced. The contract, the evaluator, the
 * Sentinel gate, the ingestion function and the orchestrator are the real ones,
 * so a canonical row recorded here is a row a live run would genuinely have
 * written — and an absent row is a write that genuinely did not happen.
 */

import type { CollectorRunResult } from "../../../lib/brightdata/types";
import type {
  DemoCollectorRunner,
} from "../../../lib/demo-healing";
import type {
  DemoHealGateOutcome,
  DemoCollectorHealer,
  DemoHealRequest,
} from "../../../lib/demo-healing/healer";
import type {
  DemoPipelineRepository,
  DemoQuoteSnapshotInput,
} from "../../../lib/demo-healing/persistence";
import type {
  DemoHarnessRepository,
  DemoQuarantinePayloadReference,
  DemoStatePatch,
  RecordDemoEventInput,
} from "../../../lib/demo-healing/repository";
import type { DemoLayout, DemoSourceConfiguration } from "../../../lib/demo-healing/source";
import { InMemorySentinelRepository } from "../../../lib/sentinel";
import type { LastKnownGoodBaseline } from "../../../lib/sentinel/types";
import type {
  CollectionRunRow,
  DemoQuoteSnapshotRow,
  Json,
  ProviderRow,
  SentinelDemoEventRow,
  SentinelDemoStateRow,
  SentinelHealingAttemptRow,
  SentinelIncidentRow,
  SourceRow,
} from "../../../lib/supabase/types";

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${(counter += 1)}`;

export const DEMO_SOURCE_ID = "src-demo-0001";
export const DEMO_PROVIDER_ID = "prov-demo-0001";

export function testDemoConfiguration(
  overrides: Partial<DemoSourceConfiguration> = {},
): DemoSourceConfiguration {
  return {
    sourceKey: "sentinel-demo-quotes",
    providerSlug: "sentinel-demo",
    providerName: "Sentinel Demo",
    providerHomepageUrl: "https://quotes.toscrape.com",
    label: "Sentinel self-healing demo source",
    collectorId: "c_test_demo_collector",
    canonicalSourceUrl: "https://quotes.toscrape.com/",
    layouts: {
      healthy: {
        layout: "healthy",
        url: "https://quotes.toscrape.com/",
        description: "healthy layout",
      },
      broken: {
        layout: "broken",
        url: "https://quotes.toscrape.com/tableful/",
        description: "table layout",
      },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Canonical persistence double
// ---------------------------------------------------------------------------

/**
 * Records every canonical write and every run transition. `quoteSnapshots` is
 * the assertion surface for "zero canonical writes": if the gate did its job,
 * a refused run adds nothing to it.
 */
export class FakeDemoPipelineRepository implements DemoPipelineRepository {
  public readonly quoteSnapshots: DemoQuoteSnapshotInput[] = [];
  public readonly runs: CollectionRunRow[] = [];
  /** What the `sources` row records, as the real upsert would have stored it. */
  public readonly collectorIdBySource = new Map<string, string | null>();

  public async upsertProvider(): Promise<ProviderRow> {
    return {
      id: DEMO_PROVIDER_ID,
      slug: "sentinel-demo",
      name: "Sentinel Demo",
      homepage_url: "https://quotes.toscrape.com",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  public async upsertSource(input: {
    providerId: string;
    sourceUrl: string;
    collectorId?: string | null;
    label?: string | null;
  }): Promise<SourceRow> {
    this.collectorIdBySource.set(DEMO_SOURCE_ID, input.collectorId ?? null);
    return {
      id: DEMO_SOURCE_ID,
      provider_id: input.providerId,
      kind: "other",
      collector_id: input.collectorId ?? null,
      source_url: input.sourceUrl,
      label: input.label ?? null,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  public async startCollectionRun(input: {
    sourceId: string;
    externalRunId?: string | null;
    triggeredBy?: string;
  }): Promise<CollectionRunRow> {
    const row: CollectionRunRow = {
      id: nextId("run"),
      source_id: input.sourceId,
      status: "running",
      external_run_id: input.externalRunId ?? null,
      triggered_by: input.triggeredBy ?? "test",
      started_at: new Date().toISOString(),
      completed_at: null,
      records_seen: 0,
      records_accepted: 0,
      records_rejected: 0,
      error_message: null,
      error_details: null,
      validation_errors: [],
      created_at: new Date().toISOString(),
    };
    this.runs.push(row);
    return row;
  }

  public async completeCollectionRun(
    runId: string,
    counts: { recordsSeen: number; recordsAccepted: number; recordsRejected: number },
  ): Promise<CollectionRunRow> {
    const run = this.runs.find((candidate) => candidate.id === runId);
    if (!run) throw new Error(`Unknown run ${runId}`);
    run.status = counts.recordsRejected > 0 ? "partial" : "succeeded";
    run.completed_at = new Date().toISOString();
    run.records_seen = counts.recordsSeen;
    run.records_accepted = counts.recordsAccepted;
    run.records_rejected = counts.recordsRejected;
    return run;
  }

  public async failCollectionRun(
    runId: string,
    error: { message: string; details?: Json },
    counts?: Partial<{ recordsSeen: number; recordsAccepted: number; recordsRejected: number }>,
  ): Promise<CollectionRunRow> {
    const run = this.runs.find((candidate) => candidate.id === runId);
    if (!run) throw new Error(`Unknown run ${runId}`);
    run.status = "failed";
    run.completed_at = new Date().toISOString();
    run.error_message = error.message;
    run.error_details = error.details ?? null;
    if (counts?.recordsSeen !== undefined) run.records_seen = counts.recordsSeen;
    if (counts?.recordsAccepted !== undefined) run.records_accepted = counts.recordsAccepted;
    if (counts?.recordsRejected !== undefined) run.records_rejected = counts.recordsRejected;
    return run;
  }

  public async saveDemoQuoteSnapshots(
    input: readonly DemoQuoteSnapshotInput[],
  ): Promise<{ id: string }[]> {
    this.quoteSnapshots.push(...input);
    return input.map(() => ({ id: nextId("snap") }));
  }

  public snapshotsForRun(runId: string): DemoQuoteSnapshotInput[] {
    return this.quoteSnapshots.filter((snapshot) => snapshot.runId === runId);
  }
}

/**
 * Sentinel repository whose last-known-good baseline is derived from the run
 * log, exactly as the real one derives it from `collection_runs`. That is what
 * makes the "baseline survives a refusal" assertion meaningful rather than
 * circular.
 */
export class RunBackedSentinelRepository extends InMemorySentinelRepository {
  constructor(private readonly pipeline: FakeDemoPipelineRepository) {
    super();
  }

  public override async getLastKnownGoodBaseline(
    sourceId: string,
  ): Promise<LastKnownGoodBaseline | null> {
    const succeeded = [...this.pipeline.runs]
      .reverse()
      .find((run) => run.source_id === sourceId && run.status === "succeeded");
    if (!succeeded) return null;
    return {
      runId: succeeded.id,
      recordCount: succeeded.records_accepted,
      observedAt: succeeded.completed_at ?? succeeded.started_at,
      externalRunId: succeeded.external_run_id,
    };
  }
}

// ---------------------------------------------------------------------------
// Harness state double
// ---------------------------------------------------------------------------

export class InMemoryDemoHarnessRepository implements DemoHarnessRepository {
  public state: SentinelDemoStateRow;
  public events: SentinelDemoEventRow[] = [];

  constructor(
    private readonly pipeline: FakeDemoPipelineRepository,
    private readonly sentinel: RunBackedSentinelRepository,
  ) {
    const now = new Date().toISOString();
    this.state = {
      source_key: "sentinel-demo-quotes",
      source_id: null,
      armed_layout: "healthy",
      break_mode: "layout",
      phase: "unprepared",
      baseline_run_id: null,
      broken_run_id: null,
      recovered_run_id: null,
      current_incident_id: null,
      current_healing_attempt_id: null,
      healing_job_id: null,
      healing_requested_at: null,
      preview_records_count: null,
      preview_passed: null,
      preview_reason_codes: [],
      preview_summary: null,
      approval_state: "not_requested",
      approved_at: null,
      is_live: false,
      created_at: now,
      updated_at: now,
    };
  }

  public async getState(): Promise<SentinelDemoStateRow> {
    return this.state;
  }

  public async patchState(patch: DemoStatePatch): Promise<SentinelDemoStateRow> {
    const map: Record<string, keyof SentinelDemoStateRow> = {
      sourceId: "source_id",
      armedLayout: "armed_layout",
      breakMode: "break_mode",
      phase: "phase",
      baselineRunId: "baseline_run_id",
      brokenRunId: "broken_run_id",
      recoveredRunId: "recovered_run_id",
      currentIncidentId: "current_incident_id",
      currentHealingAttemptId: "current_healing_attempt_id",
      healingJobId: "healing_job_id",
      healingRequestedAt: "healing_requested_at",
      previewRecordsCount: "preview_records_count",
      previewPassed: "preview_passed",
      previewReasonCodes: "preview_reason_codes",
      previewSummary: "preview_summary",
      approvalState: "approval_state",
      approvedAt: "approved_at",
      isLive: "is_live",
    };
    for (const [key, column] of Object.entries(map)) {
      const value = (patch as Record<string, unknown>)[key];
      if (value !== undefined) {
        (this.state as Record<string, unknown>)[column] = value;
      }
    }
    this.state.updated_at = new Date().toISOString();
    return this.state;
  }

  public async recordEvent(input: RecordDemoEventInput): Promise<SentinelDemoEventRow> {
    const row: SentinelDemoEventRow = {
      id: nextId("evt"),
      source_key: "sentinel-demo-quotes",
      phase: input.phase,
      action: input.action,
      status: input.status,
      summary: input.summary,
      run_id: input.runId ?? null,
      incident_id: input.incidentId ?? null,
      detail: input.detail ?? {},
      created_at: new Date().toISOString(),
    };
    this.events.push(row);
    return row;
  }

  public async listEvents(limit = 100): Promise<SentinelDemoEventRow[]> {
    return this.events.slice(0, limit);
  }

  public async clearEvents(): Promise<void> {
    this.events = [];
  }

  public async listRunsForSource(sourceId: string, limit = 20): Promise<CollectionRunRow[]> {
    return [...this.pipeline.runs]
      .filter((run) => run.source_id === sourceId)
      .reverse()
      .slice(0, limit);
  }

  public async listIncidentsForSource(
    sourceId: string,
    limit = 20,
  ): Promise<SentinelIncidentRow[]> {
    return this.sentinel.incidents
      .filter((incident) => incident.source_id === sourceId)
      .slice()
      .reverse()
      .slice(0, limit);
  }

  public async listHealingAttemptsForSource(
    sourceId: string,
    limit = 20,
  ): Promise<SentinelHealingAttemptRow[]> {
    return this.sentinel.healingAttempts
      .filter((attempt) => attempt.source_id === sourceId)
      .slice()
      .reverse()
      .slice(0, limit);
  }

  public async countCanonicalRecords(sourceId: string): Promise<number> {
    return this.pipeline.quoteSnapshots.filter((snap) => snap.sourceId === sourceId).length;
  }

  public async countCanonicalRecordsForRun(runId: string): Promise<number> {
    return this.pipeline.snapshotsForRun(runId).length;
  }

  public async getQuarantinePayloadForIncident(
    incidentId: string,
  ): Promise<DemoQuarantinePayloadReference | null> {
    const row = this.sentinel.quarantinePayloads.find(
      (payload) => payload.incident_id === incidentId,
    );
    if (!row) return null;
    // Deliberately narrow: the double returns exactly the columns the real
    // query selects, so a test cannot pass by reading a payload production
    // never fetches.
    return {
      id: row.id,
      incidentId: row.incident_id,
      runId: row.run_id,
      createdAt: row.created_at,
    };
  }

  public async getSourceCollectorId(sourceId: string): Promise<string | null> {
    return this.pipeline.collectorIdBySource.get(sourceId) ?? null;
  }

  public async latestCanonicalRecords(
    sourceId: string,
    limit = 10,
  ): Promise<DemoQuoteSnapshotRow[]> {
    return this.pipeline.quoteSnapshots
      .filter((snap) => snap.sourceId === sourceId)
      .slice(-limit)
      .map((snap) => ({
        id: nextId("snap"),
        run_id: snap.runId,
        source_id: snap.sourceId,
        provider_id: snap.providerId,
        quote_key: snap.quoteKey,
        quote_text: snap.quoteText,
        author: snap.author,
        tags: snap.tags,
        source_url: snap.sourceUrl,
        observed_at: snap.observedAt,
        created_at: snap.observedAt,
      }));
  }
}

// ---------------------------------------------------------------------------
// Bright Data doubles
// ---------------------------------------------------------------------------

/** Returns a scripted payload per layout, as a real collector run would. */
export class ScriptedCollectorRunner implements DemoCollectorRunner {
  public readonly calls: { layout: DemoLayout; url: string }[] = [];

  constructor(
    private readonly payloads: Record<DemoLayout, unknown[]>,
    private readonly options: { failOn?: DemoLayout } = {},
  ) {}

  public async run(
    configuration: DemoSourceConfiguration,
    layout: DemoLayout,
  ): Promise<CollectorRunResult<unknown>> {
    const url = configuration.layouts[layout].url;
    this.calls.push({ layout, url });
    const failed = this.options.failOn === layout;
    const data = failed ? [] : this.payloads[layout];
    return {
      success: !failed,
      data,
      metadata: {
        collectorId: configuration.collectorId,
        runId: nextId("j"),
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 1,
        resultCount: data.length,
        status: failed ? "failed" : "success",
        ...(failed ? { error: "scripted collector failure" } : {}),
      },
    };
  }

  /** Swaps what a layout returns, standing in for an approved template repair. */
  public setPayload(layout: DemoLayout, payload: unknown[]): void {
    this.payloads[layout] = payload;
  }
}

export class ScriptedHealer implements DemoCollectorHealer {
  public readonly healRequests: DemoHealRequest[] = [];
  public readonly decisions: boolean[] = [];

  constructor(
    private outcome: DemoHealGateOutcome,
    private readonly hooks: { onApprove?: () => void } = {},
  ) {}

  public setOutcome(outcome: DemoHealGateOutcome): void {
    this.outcome = outcome;
  }

  public async requestHeal(request: DemoHealRequest): Promise<{ jobId: string | null }> {
    this.healRequests.push(request);
    return { jobId: nextId("ia") };
  }

  /** The scripted outcome, whichever collector or poll options are supplied. */
  public async waitForGate(): Promise<DemoHealGateOutcome> {
    return this.outcome;
  }

  public async applyDecision(_collectorId: string, approve: boolean): Promise<void> {
    this.decisions.push(approve);
    if (approve) this.hooks.onApprove?.();
  }
}

export function awaitingApproval(previewRecords: unknown[]): DemoHealGateOutcome {
  return {
    kind: "awaiting_approval",
    previewRecords,
    diffSummary: "Proposed template has 4 extraction step(s).",
    completedSteps: ["planner", "code_fixer", "step_preview_runner"],
    rawStatus: "pending_answer",
  };
}
