/**
 * Sentinel Supabase Repository & Persistence Operations
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "../supabase";
import type {
  Database,
  SentinelHealingAttemptRow,
  SentinelIncidentRow,
  SentinelQuarantinePayloadRow,
  SentinelSourceHealthRow,
} from "../supabase/types";
import type {
  LastKnownGoodBaseline,
  SentinelIncidentStatus,
  SentinelReasonCode,
  SentinelSeverity,
} from "./types";

export interface CreateSentinelIncidentInput {
  sourceId: string;
  providerId: string;
  runId?: string | null;
  status?: SentinelIncidentStatus;
  severity?: SentinelSeverity;
  reasonCodes: SentinelReasonCode[];
  summary?: string | null;
  recordsSeen: number;
  recordsValid: number;
  recordsInvalid: number;
  expectedCount?: number | null;
  lastKnownGoodCount?: number | null;
  lastKnownGoodRunId?: string | null;
  lastKnownGoodAt?: string | null;
  healingAttemptCount?: number;
}

export interface UpdateSentinelIncidentInput {
  status?: SentinelIncidentStatus;
  severity?: SentinelSeverity;
  healingAttemptCount?: number;
  resolutionNote?: string | null;
  resolvedAt?: string | null;
  reasonCodes?: SentinelReasonCode[];
}

export interface SaveQuarantinePayloadInput {
  incidentId: string;
  sourceId: string;
  runId?: string | null;
  rawPayload: unknown;
  validationErrors: unknown;
}

export interface RecordHealingAttemptInput {
  incidentId: string;
  sourceId: string;
  collectorId?: string | null;
  attemptNumber: number;
  prompt: string;
  status: SentinelHealingAttemptRow["status"];
  refactorJobId?: string | null;
  candidateRecordsCount?: number | null;
  candidatePassedValidation?: boolean | null;
  validationDetails?: unknown;
  errorMessage?: string | null;
  startedAt?: string;
  completedAt?: string | null;
}

export interface SentinelRepository {
  createIncident(input: CreateSentinelIncidentInput): Promise<SentinelIncidentRow>;
  updateIncident(id: string, input: UpdateSentinelIncidentInput): Promise<SentinelIncidentRow>;
  getLatestOpenIncident(sourceId: string): Promise<SentinelIncidentRow | null>;
  saveQuarantinePayload(input: SaveQuarantinePayloadInput): Promise<SentinelQuarantinePayloadRow>;
  recordHealingAttempt(input: RecordHealingAttemptInput): Promise<SentinelHealingAttemptRow>;
  getLastKnownGoodBaseline(sourceId: string): Promise<LastKnownGoodBaseline | null>;
  getSentinelSourceHealth(): Promise<SentinelSourceHealthRow[]>;
  listRecentIncidents(limit?: number): Promise<SentinelIncidentRow[]>;
  listRecentHealingAttempts(limit?: number): Promise<SentinelHealingAttemptRow[]>;
}

export class SupabaseSentinelRepository implements SentinelRepository {
  private readonly db: SupabaseClient<Database>;

  constructor(client?: SupabaseClient<Database>) {
    this.db = client ?? createSupabaseAdminClient();
  }

  public async createIncident(input: CreateSentinelIncidentInput): Promise<SentinelIncidentRow> {
    const { data, error } = await this.db
      .from("sentinel_incidents")
      .insert({
        source_id: input.sourceId,
        provider_id: input.providerId,
        run_id: input.runId ?? null,
        status: input.status ?? "open",
        severity: input.severity ?? "warning",
        reason_codes: input.reasonCodes,
        summary: input.summary ?? null,
        records_seen: input.recordsSeen,
        records_valid: input.recordsValid,
        records_invalid: input.recordsInvalid,
        expected_count: input.expectedCount ?? null,
        last_known_good_count: input.lastKnownGoodCount ?? null,
        last_known_good_run_id: input.lastKnownGoodRunId ?? null,
        last_known_good_at: input.lastKnownGoodAt ?? null,
        healing_attempt_count: input.healingAttemptCount ?? 0,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create sentinel incident: ${error?.message}`);
    }
    return data as SentinelIncidentRow;
  }

  public async updateIncident(
    id: string,
    input: UpdateSentinelIncidentInput,
  ): Promise<SentinelIncidentRow> {
    const updatePayload: Database["public"]["Tables"]["sentinel_incidents"]["Update"] = {};
    if (input.status !== undefined) updatePayload.status = input.status;
    if (input.severity !== undefined) updatePayload.severity = input.severity;
    if (input.healingAttemptCount !== undefined)
      updatePayload.healing_attempt_count = input.healingAttemptCount;
    if (input.resolutionNote !== undefined)
      updatePayload.resolution_note = input.resolutionNote;
    if (input.resolvedAt !== undefined) updatePayload.resolved_at = input.resolvedAt;
    if (input.reasonCodes !== undefined) updatePayload.reason_codes = input.reasonCodes;

    const { data, error } = await this.db
      .from("sentinel_incidents")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to update sentinel incident ${id}: ${error?.message}`);
    }
    return data as SentinelIncidentRow;
  }

  public async getLatestOpenIncident(sourceId: string): Promise<SentinelIncidentRow | null> {
    const { data, error } = await this.db
      .from("sentinel_incidents")
      .select()
      .eq("source_id", sourceId)
      .in("status", ["open", "healing", "needs_review"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to get open incident for source ${sourceId}: ${error.message}`);
    }
    return (data as SentinelIncidentRow) ?? null;
  }

  public async saveQuarantinePayload(
    input: SaveQuarantinePayloadInput,
  ): Promise<SentinelQuarantinePayloadRow> {
    const { data, error } = await this.db
      .from("sentinel_quarantine_payloads")
      .insert({
        incident_id: input.incidentId,
        source_id: input.sourceId,
        run_id: input.runId ?? null,
        raw_payload: input.rawPayload as never,
        validation_errors: input.validationErrors as never,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to save quarantine payload: ${error?.message}`);
    }
    return data as SentinelQuarantinePayloadRow;
  }

  public async recordHealingAttempt(
    input: RecordHealingAttemptInput,
  ): Promise<SentinelHealingAttemptRow> {
    const { data, error } = await this.db
      .from("sentinel_healing_attempts")
      .insert({
        incident_id: input.incidentId,
        source_id: input.sourceId,
        collector_id: input.collectorId ?? null,
        attempt_number: input.attemptNumber,
        prompt: input.prompt,
        status: input.status,
        refactor_job_id: input.refactorJobId ?? null,
        candidate_records_count: input.candidateRecordsCount ?? null,
        candidate_passed_validation: input.candidatePassedValidation ?? null,
        validation_details: (input.validationDetails ?? null) as never,
        error_message: input.errorMessage ?? null,
        started_at: input.startedAt ?? new Date().toISOString(),
        completed_at: input.completedAt ?? null,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to record healing attempt: ${error?.message}`);
    }
    return data as SentinelHealingAttemptRow;
  }

  public async getLastKnownGoodBaseline(sourceId: string): Promise<LastKnownGoodBaseline | null> {
    // Find the most recent collection run that succeeded
    const { data, error } = await this.db
      .from("collection_runs")
      .select("id, records_accepted, completed_at, started_at, external_run_id")
      .eq("source_id", sourceId)
      .eq("status", "succeeded")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return {
      runId: data.id,
      recordCount: data.records_accepted,
      observedAt: data.completed_at ?? data.started_at,
      externalRunId: data.external_run_id,
    };
  }

  public async getSentinelSourceHealth(): Promise<SentinelSourceHealthRow[]> {
    const { data, error } = await this.db
      .from("sentinel_source_health")
      .select();

    if (error || !data) {
      throw new Error(`Failed to fetch sentinel source health: ${error?.message}`);
    }
    return data as SentinelSourceHealthRow[];
  }

  public async listRecentIncidents(limit = 50): Promise<SentinelIncidentRow[]> {
    const { data, error } = await this.db
      .from("sentinel_incidents")
      .select()
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error || !data) {
      throw new Error(`Failed to list sentinel incidents: ${error?.message}`);
    }
    return data as SentinelIncidentRow[];
  }

  public async listRecentHealingAttempts(limit = 50): Promise<SentinelHealingAttemptRow[]> {
    const { data, error } = await this.db
      .from("sentinel_healing_attempts")
      .select()
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error || !data) {
      throw new Error(`Failed to list healing attempts: ${error?.message}`);
    }
    return data as SentinelHealingAttemptRow[];
  }
}

export function createSentinelRepository(client?: SupabaseClient<Database>): SentinelRepository {
  return new SupabaseSentinelRepository(client);
}
