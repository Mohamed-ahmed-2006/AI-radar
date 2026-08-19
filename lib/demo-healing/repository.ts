/**
 * Persistence for the demo harness's own state and evidence trail.
 *
 * Everything that constitutes *proof* — runs, incidents, quarantined payloads,
 * healing attempts, canonical rows — lives in the tables the production system
 * already uses. This repository only owns which phase the demonstration is in
 * and the narrative journal, so the read model can tell a coherent story
 * without inventing any of the underlying facts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "../supabase";
import type {
  CollectionRunRow,
  Database,
  DemoBreakMode,
  DemoQuoteSnapshotRow,
  Json,
  SentinelDemoApprovalState,
  SentinelDemoEventRow,
  SentinelDemoPhase,
  SentinelDemoStateRow,
  SentinelHealingAttemptRow,
  SentinelIncidentRow,
} from "../supabase/types";
import { DEMO_SOURCE_KEY, type DemoLayout } from "./source";

export interface DemoStatePatch {
  sourceId?: string | null;
  armedLayout?: DemoLayout;
  breakMode?: DemoBreakMode;
  phase?: SentinelDemoPhase;
  baselineRunId?: string | null;
  brokenRunId?: string | null;
  recoveredRunId?: string | null;
  currentIncidentId?: string | null;
  currentHealingAttemptId?: string | null;
  healingJobId?: string | null;
  healingRequestedAt?: string | null;
  previewRecordsCount?: number | null;
  previewPassed?: boolean | null;
  previewReasonCodes?: string[];
  previewSummary?: string | null;
  approvalState?: SentinelDemoApprovalState;
  approvedAt?: string | null;
  isLive?: boolean;
}

export interface RecordDemoEventInput {
  phase: SentinelDemoPhase;
  action: string;
  status: "ok" | "refused" | "failed";
  summary: string;
  runId?: string | null;
  incidentId?: string | null;
  detail?: Json;
}

export interface DemoHarnessRepository {
  /** Reads the phase marker, creating the initial row on first use. */
  getState(): Promise<SentinelDemoStateRow>;
  patchState(patch: DemoStatePatch): Promise<SentinelDemoStateRow>;
  recordEvent(input: RecordDemoEventInput): Promise<SentinelDemoEventRow>;
  listEvents(limit?: number): Promise<SentinelDemoEventRow[]>;
  /** Clears the journal so a rehearsal does not bleed into the next run. */
  clearEvents(): Promise<void>;

  listRunsForSource(sourceId: string, limit?: number): Promise<CollectionRunRow[]>;
  listIncidentsForSource(sourceId: string, limit?: number): Promise<SentinelIncidentRow[]>;
  listHealingAttemptsForSource(
    sourceId: string,
    limit?: number,
  ): Promise<SentinelHealingAttemptRow[]>;
  countCanonicalRecords(sourceId: string): Promise<number>;
  countCanonicalRecordsForRun(runId: string): Promise<number>;
  latestCanonicalRecords(sourceId: string, limit?: number): Promise<DemoQuoteSnapshotRow[]>;
}

const INITIAL_STATE: Omit<SentinelDemoStateRow, "created_at" | "updated_at"> = {
  source_key: DEMO_SOURCE_KEY,
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
  is_live: true,
};

export class SupabaseDemoHarnessRepository implements DemoHarnessRepository {
  private readonly db: SupabaseClient<Database>;

  constructor(client?: SupabaseClient<Database>) {
    this.db = client ?? createSupabaseAdminClient();
  }

  public async getState(): Promise<SentinelDemoStateRow> {
    const { data, error } = await this.db
      .from("sentinel_demo_state")
      .select()
      .eq("source_key", DEMO_SOURCE_KEY)
      .maybeSingle();
    if (error) throw new Error(`Failed to read demo state: ${error.message}`);
    if (data) return data as SentinelDemoStateRow;

    const inserted = await this.db
      .from("sentinel_demo_state")
      .insert(INITIAL_STATE)
      .select()
      .single();
    if (inserted.error || !inserted.data) {
      throw new Error(`Failed to initialise demo state: ${inserted.error?.message}`);
    }
    return inserted.data as SentinelDemoStateRow;
  }

  public async patchState(patch: DemoStatePatch): Promise<SentinelDemoStateRow> {
    await this.getState();
    type StateUpdate = Database["public"]["Tables"]["sentinel_demo_state"]["Update"];
    const update: StateUpdate = {};
    const set = <K extends keyof StateUpdate>(column: K, value: StateUpdate[K] | undefined) => {
      if (value !== undefined) update[column] = value;
    };
    set("source_id", patch.sourceId);
    set("armed_layout", patch.armedLayout);
    set("break_mode", patch.breakMode);
    set("phase", patch.phase);
    set("baseline_run_id", patch.baselineRunId);
    set("broken_run_id", patch.brokenRunId);
    set("recovered_run_id", patch.recoveredRunId);
    set("current_incident_id", patch.currentIncidentId);
    set("current_healing_attempt_id", patch.currentHealingAttemptId);
    set("healing_job_id", patch.healingJobId);
    set("healing_requested_at", patch.healingRequestedAt);
    set("preview_records_count", patch.previewRecordsCount);
    set("preview_passed", patch.previewPassed);
    set("preview_reason_codes", patch.previewReasonCodes);
    set("preview_summary", patch.previewSummary);
    set("approval_state", patch.approvalState);
    set("approved_at", patch.approvedAt);
    set("is_live", patch.isLive);

    const { data, error } = await this.db
      .from("sentinel_demo_state")
      .update(update)
      .eq("source_key", DEMO_SOURCE_KEY)
      .select()
      .single();
    if (error || !data) throw new Error(`Failed to update demo state: ${error?.message}`);
    return data as SentinelDemoStateRow;
  }

  public async recordEvent(input: RecordDemoEventInput): Promise<SentinelDemoEventRow> {
    const { data, error } = await this.db
      .from("sentinel_demo_events")
      .insert({
        source_key: DEMO_SOURCE_KEY,
        phase: input.phase,
        action: input.action,
        status: input.status,
        summary: input.summary,
        run_id: input.runId ?? null,
        incident_id: input.incidentId ?? null,
        detail: (input.detail ?? {}) as never,
      })
      .select()
      .single();
    if (error || !data) throw new Error(`Failed to record demo event: ${error?.message}`);
    return data as SentinelDemoEventRow;
  }

  public async listEvents(limit = 100): Promise<SentinelDemoEventRow[]> {
    const { data, error } = await this.db
      .from("sentinel_demo_events")
      .select()
      .eq("source_key", DEMO_SOURCE_KEY)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw new Error(`Failed to list demo events: ${error.message}`);
    return (data ?? []) as SentinelDemoEventRow[];
  }

  public async clearEvents(): Promise<void> {
    const { error } = await this.db
      .from("sentinel_demo_events")
      .delete()
      .eq("source_key", DEMO_SOURCE_KEY);
    if (error) throw new Error(`Failed to clear demo events: ${error.message}`);
  }

  public async listRunsForSource(sourceId: string, limit = 20): Promise<CollectionRunRow[]> {
    const { data, error } = await this.db
      .from("collection_runs")
      .select()
      .eq("source_id", sourceId)
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Failed to list demo runs: ${error.message}`);
    return (data ?? []) as CollectionRunRow[];
  }

  public async listIncidentsForSource(
    sourceId: string,
    limit = 20,
  ): Promise<SentinelIncidentRow[]> {
    const { data, error } = await this.db
      .from("sentinel_incidents")
      .select()
      .eq("source_id", sourceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Failed to list demo incidents: ${error.message}`);
    return (data ?? []) as SentinelIncidentRow[];
  }

  public async listHealingAttemptsForSource(
    sourceId: string,
    limit = 20,
  ): Promise<SentinelHealingAttemptRow[]> {
    const { data, error } = await this.db
      .from("sentinel_healing_attempts")
      .select()
      .eq("source_id", sourceId)
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Failed to list demo healing attempts: ${error.message}`);
    return (data ?? []) as SentinelHealingAttemptRow[];
  }

  public async countCanonicalRecords(sourceId: string): Promise<number> {
    const { count, error } = await this.db
      .from("demo_quote_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("source_id", sourceId);
    if (error) throw new Error(`Failed to count demo canonical records: ${error.message}`);
    return count ?? 0;
  }

  public async countCanonicalRecordsForRun(runId: string): Promise<number> {
    const { count, error } = await this.db
      .from("demo_quote_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("run_id", runId);
    if (error) throw new Error(`Failed to count demo canonical records: ${error.message}`);
    return count ?? 0;
  }

  public async latestCanonicalRecords(
    sourceId: string,
    limit = 10,
  ): Promise<DemoQuoteSnapshotRow[]> {
    const { data, error } = await this.db
      .from("demo_quote_snapshots")
      .select()
      .eq("source_id", sourceId)
      .order("observed_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Failed to read demo canonical records: ${error.message}`);
    return (data ?? []) as DemoQuoteSnapshotRow[];
  }
}

export function createDemoHarnessRepository(
  client?: SupabaseClient<Database>,
): DemoHarnessRepository {
  return new SupabaseDemoHarnessRepository(client);
}
