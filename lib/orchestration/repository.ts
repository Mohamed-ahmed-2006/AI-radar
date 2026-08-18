/**
 * Durable orchestration state: leases, run history and the status read model
 * source data.
 *
 * The lease is a database row, not process memory: serverless invocations do
 * not share memory, so an in-process mutex would let two concurrent ticks run
 * the same collector. A partial unique index on `(source_key) where status =
 * 'running'` makes overlap impossible, and a second partial unique index on
 * `(source_key, invocation_id)` makes a replayed scheduler invocation a no-op.
 */

import type { PostgrestError } from "@supabase/supabase-js";

import { createSupabaseAdminClient, type SupabaseServerClient } from "../supabase";
import type { OrchestrationRunRow, OrchestrationRunStatus } from "../supabase/types";
import type { CollectionSourceKey, SourceRunOutcome } from "./types";

export interface AcquireLeaseInput {
  sourceKey: CollectionSourceKey;
  providerSlug: string;
  sourceType: string;
  trigger: string;
  invocationId: string;
  /** How long the lease stays valid before another tick may reclaim it. */
  leaseMs: number;
  startedAt: string;
}

export type LeaseAcquisition =
  | { acquired: true; run: OrchestrationRunRow; reclaimedStaleLease: boolean }
  | {
      acquired: false;
      reason: "already_running" | "duplicate_invocation";
      existing: OrchestrationRunRow | null;
    };

export interface CompleteRunInput {
  status: OrchestrationRunStatus;
  outcome: SourceRunOutcome;
  attemptCount: number;
  completedAt: string;
  durationMs: number;
  collectionRunId?: string | null;
  externalRunId?: string | null;
  sentinelIncidentId?: string | null;
  recordsAccepted?: number;
  recordsRejected?: number;
  changesDetected?: number;
  reasonCodes?: string[];
  errorMessage?: string | null;
}

export interface OrchestrationRepository {
  acquireLease(input: AcquireLeaseInput): Promise<LeaseAcquisition>;
  completeRun(runId: string, input: CompleteRunInput): Promise<OrchestrationRunRow>;
  getLastAttempt(sourceKey: CollectionSourceKey): Promise<OrchestrationRunRow | null>;
  listRecentRuns(limit?: number): Promise<OrchestrationRunRow[]>;
  listLatestSuccessfulRuns(limit?: number): Promise<OrchestrationRunRow[]>;
}

export class OrchestrationRepositoryError extends Error {
  readonly cause: PostgrestError;

  constructor(operation: string, cause: PostgrestError) {
    super(`${operation} failed: ${cause.message}`);
    this.name = "OrchestrationRepositoryError";
    this.cause = cause;
  }
}

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: PostgrestError | null): boolean {
  return error?.code === UNIQUE_VIOLATION;
}

function violatesInvocationKey(error: PostgrestError): boolean {
  return `${error.message} ${error.details ?? ""}`.includes("invocation");
}

export class SupabaseOrchestrationRepository implements OrchestrationRepository {
  private readonly db: SupabaseServerClient;

  constructor(client?: SupabaseServerClient) {
    this.db = client ?? createSupabaseAdminClient();
  }

  public async acquireLease(input: AcquireLeaseInput): Promise<LeaseAcquisition> {
    const first = await this.insertLease(input);
    if (first.row) return { acquired: true, run: first.row, reclaimedStaleLease: false };
    if (!first.error) throw new Error("acquireLease returned neither a row nor an error");

    if (!isUniqueViolation(first.error)) {
      throw new OrchestrationRepositoryError("acquireLease", first.error);
    }
    if (violatesInvocationKey(first.error)) {
      return {
        acquired: false,
        reason: "duplicate_invocation",
        existing: await this.findRunByInvocation(input.sourceKey, input.invocationId),
      };
    }

    const active = await this.findActiveRun(input.sourceKey);
    const leaseExpired =
      active !== null && Date.parse(active.lease_expires_at) <= Date.parse(input.startedAt);
    if (!leaseExpired) {
      return { acquired: false, reason: "already_running", existing: active };
    }

    // The holder died mid-run (a serverless invocation can be killed without
    // unwinding). Close the abandoned lease, then take it.
    await this.completeRun(active.id, {
      status: "failed",
      outcome: "timed_out",
      attemptCount: active.attempt_count,
      completedAt: input.startedAt,
      durationMs: Math.max(0, Date.parse(input.startedAt) - Date.parse(active.started_at)),
      errorMessage: "Lease expired before the run reported an outcome",
    });

    const retry = await this.insertLease(input);
    if (retry.row) return { acquired: true, run: retry.row, reclaimedStaleLease: true };
    if (retry.error && isUniqueViolation(retry.error)) {
      return {
        acquired: false,
        reason: violatesInvocationKey(retry.error) ? "duplicate_invocation" : "already_running",
        existing: await this.findActiveRun(input.sourceKey),
      };
    }
    throw new OrchestrationRepositoryError(
      "acquireLease",
      retry.error as PostgrestError,
    );
  }

  private async insertLease(
    input: AcquireLeaseInput,
  ): Promise<{ row: OrchestrationRunRow | null; error: PostgrestError | null }> {
    const { data, error } = await this.db
      .from("orchestration_runs")
      .insert({
        source_key: input.sourceKey,
        provider_slug: input.providerSlug,
        source_type: input.sourceType,
        status: "running",
        trigger: input.trigger,
        invocation_id: input.invocationId,
        started_at: input.startedAt,
        lease_expires_at: new Date(Date.parse(input.startedAt) + input.leaseMs).toISOString(),
      })
      .select()
      .single();
    return { row: (data as OrchestrationRunRow) ?? null, error };
  }

  private async findActiveRun(
    sourceKey: CollectionSourceKey,
  ): Promise<OrchestrationRunRow | null> {
    const { data, error } = await this.db
      .from("orchestration_runs")
      .select()
      .eq("source_key", sourceKey)
      .eq("status", "running")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new OrchestrationRepositoryError("findActiveRun", error);
    return (data as OrchestrationRunRow) ?? null;
  }

  private async findRunByInvocation(
    sourceKey: CollectionSourceKey,
    invocationId: string,
  ): Promise<OrchestrationRunRow | null> {
    const { data, error } = await this.db
      .from("orchestration_runs")
      .select()
      .eq("source_key", sourceKey)
      .eq("invocation_id", invocationId)
      .limit(1)
      .maybeSingle();
    if (error) throw new OrchestrationRepositoryError("findRunByInvocation", error);
    return (data as OrchestrationRunRow) ?? null;
  }

  public async completeRun(
    runId: string,
    input: CompleteRunInput,
  ): Promise<OrchestrationRunRow> {
    const { data, error } = await this.db
      .from("orchestration_runs")
      .update({
        status: input.status,
        outcome: input.outcome,
        attempt_count: input.attemptCount,
        completed_at: input.completedAt,
        duration_ms: input.durationMs,
        collection_run_id: input.collectionRunId ?? null,
        external_run_id: input.externalRunId ?? null,
        sentinel_incident_id: input.sentinelIncidentId ?? null,
        records_accepted: input.recordsAccepted ?? 0,
        records_rejected: input.recordsRejected ?? 0,
        changes_detected: input.changesDetected ?? 0,
        reason_codes: input.reasonCodes ?? [],
        error_message: input.errorMessage ?? null,
      })
      .eq("id", runId)
      .select()
      .single();
    if (error || !data) {
      throw new OrchestrationRepositoryError(
        "completeRun",
        error ?? ({ message: "no row returned" } as PostgrestError),
      );
    }
    return data as OrchestrationRunRow;
  }

  public async getLastAttempt(
    sourceKey: CollectionSourceKey,
  ): Promise<OrchestrationRunRow | null> {
    const { data, error } = await this.db
      .from("orchestration_runs")
      .select()
      .eq("source_key", sourceKey)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new OrchestrationRepositoryError("getLastAttempt", error);
    return (data as OrchestrationRunRow) ?? null;
  }

  public async listRecentRuns(limit = 120): Promise<OrchestrationRunRow[]> {
    const { data, error } = await this.db
      .from("orchestration_runs")
      .select()
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error || !data) {
      throw new OrchestrationRepositoryError(
        "listRecentRuns",
        error ?? ({ message: "no rows returned" } as PostgrestError),
      );
    }
    return data as OrchestrationRunRow[];
  }

  public async listLatestSuccessfulRuns(limit = 60): Promise<OrchestrationRunRow[]> {
    const { data, error } = await this.db
      .from("orchestration_runs")
      .select()
      .eq("status", "succeeded")
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error || !data) {
      throw new OrchestrationRepositoryError(
        "listLatestSuccessfulRuns",
        error ?? ({ message: "no rows returned" } as PostgrestError),
      );
    }
    return data as OrchestrationRunRow[];
  }
}

export function createOrchestrationRepository(
  client?: SupabaseServerClient,
): OrchestrationRepository {
  return new SupabaseOrchestrationRepository(client);
}

/**
 * Test double with the same locking semantics as the partial unique indexes:
 * at most one `running` row per source key, and one row per
 * `(source_key, invocation_id)`.
 */
export class InMemoryOrchestrationRepository implements OrchestrationRepository {
  public runs: OrchestrationRunRow[] = [];
  private sequence = 0;

  public async acquireLease(input: AcquireLeaseInput): Promise<LeaseAcquisition> {
    const duplicate = this.runs.find(
      (run) => run.source_key === input.sourceKey && run.invocation_id === input.invocationId,
    );
    if (duplicate) {
      return { acquired: false, reason: "duplicate_invocation", existing: duplicate };
    }

    const active = this.runs.find(
      (run) => run.source_key === input.sourceKey && run.status === "running",
    );
    let reclaimedStaleLease = false;
    if (active) {
      if (Date.parse(active.lease_expires_at) > Date.parse(input.startedAt)) {
        return { acquired: false, reason: "already_running", existing: active };
      }
      await this.completeRun(active.id, {
        status: "failed",
        outcome: "timed_out",
        attemptCount: active.attempt_count,
        completedAt: input.startedAt,
        durationMs: Math.max(0, Date.parse(input.startedAt) - Date.parse(active.started_at)),
        errorMessage: "Lease expired before the run reported an outcome",
      });
      reclaimedStaleLease = true;
    }

    this.sequence += 1;
    const row: OrchestrationRunRow = {
      id: `orch-${this.sequence}`,
      source_key: input.sourceKey,
      provider_slug: input.providerSlug,
      source_type: input.sourceType,
      status: "running",
      trigger: input.trigger,
      invocation_id: input.invocationId,
      attempt_count: 0,
      started_at: input.startedAt,
      completed_at: null,
      duration_ms: null,
      lease_expires_at: new Date(Date.parse(input.startedAt) + input.leaseMs).toISOString(),
      collection_run_id: null,
      external_run_id: null,
      sentinel_incident_id: null,
      records_accepted: 0,
      records_rejected: 0,
      changes_detected: 0,
      outcome: null,
      error_message: null,
      reason_codes: [],
      created_at: input.startedAt,
    };
    this.runs.push(row);
    return { acquired: true, run: row, reclaimedStaleLease };
  }

  public async completeRun(runId: string, input: CompleteRunInput): Promise<OrchestrationRunRow> {
    const row = this.runs.find((run) => run.id === runId);
    if (!row) throw new Error(`Orchestration run ${runId} not found`);
    row.status = input.status;
    row.outcome = input.outcome;
    row.attempt_count = input.attemptCount;
    row.completed_at = input.completedAt;
    row.duration_ms = input.durationMs;
    row.collection_run_id = input.collectionRunId ?? null;
    row.external_run_id = input.externalRunId ?? null;
    row.sentinel_incident_id = input.sentinelIncidentId ?? null;
    row.records_accepted = input.recordsAccepted ?? 0;
    row.records_rejected = input.recordsRejected ?? 0;
    row.changes_detected = input.changesDetected ?? 0;
    row.reason_codes = input.reasonCodes ?? [];
    row.error_message = input.errorMessage ?? null;
    return row;
  }

  public async getLastAttempt(
    sourceKey: CollectionSourceKey,
  ): Promise<OrchestrationRunRow | null> {
    return (
      [...this.runs]
        .filter((run) => run.source_key === sourceKey)
        .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0] ?? null
    );
  }

  public async listRecentRuns(limit = 120): Promise<OrchestrationRunRow[]> {
    return [...this.runs]
      .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
      .slice(0, limit);
  }

  public async listLatestSuccessfulRuns(limit = 60): Promise<OrchestrationRunRow[]> {
    return [...this.runs]
      .filter((run) => run.status === "succeeded")
      .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
      .slice(0, limit);
  }
}
