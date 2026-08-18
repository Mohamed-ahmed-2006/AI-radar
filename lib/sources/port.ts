/**
 * Read port for the source-detail and provenance read models.
 *
 * The read models never talk to Supabase directly; they talk to this port. That
 * keeps two properties true:
 *
 *   * The public assembly logic is testable without a database.
 *   * Every query that backs a public response is declared in one place, so the
 *     column lists that keep service-role-only data out of anon reads cannot be
 *     bypassed by a stray `select()` somewhere in the assembler.
 */

import {
  createSupabaseServerClient,
  type SupabaseServerClient,
} from "../supabase/server";
import type {
  ChangeEventRow,
  CollectionRunRow,
  LifecycleSnapshotRow,
  ModelRow,
  PricingSnapshotRow,
  ProviderRow,
  SentinelHealingAttemptRow,
  SentinelIncidentRow,
  SentinelSourceHealthRow,
  SourceRow,
} from "../supabase/types";

/** A collection run without the service-role-only diagnostic columns. */
export type PublicCollectionRunRow = Omit<
  CollectionRunRow,
  "error_details" | "validation_errors"
>;

/**
 * A healing attempt without `validation_details` (revoked from anon by the
 * migration) and without `prompt`. The prompt is granted to anon at the SQL
 * level, but it is authored operator text describing collector internals, so
 * the public read path does not carry it.
 */
export type PublicHealingAttemptRow = Omit<
  SentinelHealingAttemptRow,
  "validation_details" | "prompt"
>;

const PUBLIC_RUN_COLUMNS =
  "id, source_id, status, external_run_id, triggered_by, started_at," +
  " completed_at, records_seen, records_accepted, records_rejected," +
  " error_message, created_at";

const PUBLIC_HEALING_COLUMNS =
  "id, incident_id, source_id, collector_id, attempt_number, status," +
  " refactor_job_id, candidate_records_count, candidate_passed_validation," +
  " error_message, started_at, completed_at, created_at";

export interface SourceReadPort {
  listSources(): Promise<SourceRow[]>;
  getSource(sourceId: string): Promise<SourceRow | null>;
  listProviders(): Promise<ProviderRow[]>;
  getProvider(providerId: string): Promise<ProviderRow | null>;
  listSentinelHealth(): Promise<SentinelSourceHealthRow[]>;
  listRuns(sourceId: string, limit?: number): Promise<PublicCollectionRunRow[]>;
  /**
   * Recent runs across every source in one query, so the catalog can report an
   * accurate last-attempt and last-success per source without N+1 reads.
   */
  listRecentRuns(limit?: number): Promise<PublicCollectionRunRow[]>;
  getRun(runId: string): Promise<PublicCollectionRunRow | null>;
  listIncidents(sourceId: string, limit?: number): Promise<SentinelIncidentRow[]>;
  listHealingAttempts(
    sourceId: string,
    limit?: number,
  ): Promise<PublicHealingAttemptRow[]>;
  listPricingSnapshots(
    sourceId: string,
    limit?: number,
  ): Promise<PricingSnapshotRow[]>;
  listLifecycleSnapshots(
    sourceId: string,
    limit?: number,
  ): Promise<LifecycleSnapshotRow[]>;
  getPricingSnapshot(snapshotId: string): Promise<PricingSnapshotRow | null>;
  getLifecycleSnapshot(snapshotId: string): Promise<LifecycleSnapshotRow | null>;
  getChangeEvent(eventId: string): Promise<ChangeEventRow | null>;
  listModelsByIds(modelIds: readonly string[]): Promise<ModelRow[]>;
}

function fail(operation: string, message: string | undefined): never {
  throw new Error(`${operation} failed: ${message ?? "unknown error"}`);
}

/**
 * Supabase-backed port.
 *
 * It is constructed with the *anon* client on purpose. Quarantine payloads and
 * per-record validation traces are not merely omitted from the queries below —
 * with this key they are unreadable, so a future careless query cannot expose
 * them either.
 */
export class SupabaseSourceReadPort implements SourceReadPort {
  private readonly db: SupabaseServerClient;

  constructor(client?: SupabaseServerClient) {
    this.db = client ?? createSupabaseServerClient();
  }

  public async listSources(): Promise<SourceRow[]> {
    const { data, error } = await this.db.from("sources").select();
    if (error) fail("listSources", error.message);
    return (data ?? []) as SourceRow[];
  }

  public async getSource(sourceId: string): Promise<SourceRow | null> {
    const { data, error } = await this.db
      .from("sources")
      .select()
      .eq("id", sourceId)
      .maybeSingle();
    if (error) fail("getSource", error.message);
    return (data as SourceRow | null) ?? null;
  }

  public async listProviders(): Promise<ProviderRow[]> {
    const { data, error } = await this.db.from("providers").select();
    if (error) fail("listProviders", error.message);
    return (data ?? []) as ProviderRow[];
  }

  public async getProvider(providerId: string): Promise<ProviderRow | null> {
    const { data, error } = await this.db
      .from("providers")
      .select()
      .eq("id", providerId)
      .maybeSingle();
    if (error) fail("getProvider", error.message);
    return (data as ProviderRow | null) ?? null;
  }

  public async listSentinelHealth(): Promise<SentinelSourceHealthRow[]> {
    const { data, error } = await this.db.from("sentinel_source_health").select();
    if (error) fail("listSentinelHealth", error.message);
    return (data ?? []) as SentinelSourceHealthRow[];
  }

  public async listRuns(
    sourceId: string,
    limit = 20,
  ): Promise<PublicCollectionRunRow[]> {
    const { data, error } = await this.db
      .from("collection_runs")
      .select(PUBLIC_RUN_COLUMNS)
      .eq("source_id", sourceId)
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error) fail("listRuns", error.message);
    return (data ?? []) as unknown as PublicCollectionRunRow[];
  }

  public async listRecentRuns(limit = 200): Promise<PublicCollectionRunRow[]> {
    const { data, error } = await this.db
      .from("collection_runs")
      .select(PUBLIC_RUN_COLUMNS)
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error) fail("listRecentRuns", error.message);
    return (data ?? []) as unknown as PublicCollectionRunRow[];
  }

  public async getRun(runId: string): Promise<PublicCollectionRunRow | null> {
    const { data, error } = await this.db
      .from("collection_runs")
      .select(PUBLIC_RUN_COLUMNS)
      .eq("id", runId)
      .maybeSingle();
    if (error) fail("getRun", error.message);
    return (data as unknown as PublicCollectionRunRow | null) ?? null;
  }

  public async listIncidents(
    sourceId: string,
    limit = 20,
  ): Promise<SentinelIncidentRow[]> {
    const { data, error } = await this.db
      .from("sentinel_incidents")
      .select()
      .eq("source_id", sourceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) fail("listIncidents", error.message);
    return (data ?? []) as SentinelIncidentRow[];
  }

  public async listHealingAttempts(
    sourceId: string,
    limit = 20,
  ): Promise<PublicHealingAttemptRow[]> {
    const { data, error } = await this.db
      .from("sentinel_healing_attempts")
      .select(PUBLIC_HEALING_COLUMNS)
      .eq("source_id", sourceId)
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error) fail("listHealingAttempts", error.message);
    return (data ?? []) as unknown as PublicHealingAttemptRow[];
  }

  public async listPricingSnapshots(
    sourceId: string,
    limit = 50,
  ): Promise<PricingSnapshotRow[]> {
    const { data, error } = await this.db
      .from("pricing_snapshots")
      .select()
      .eq("source_id", sourceId)
      .order("observed_at", { ascending: false })
      .limit(limit);
    if (error) fail("listPricingSnapshots", error.message);
    return (data ?? []) as PricingSnapshotRow[];
  }

  public async listLifecycleSnapshots(
    sourceId: string,
    limit = 50,
  ): Promise<LifecycleSnapshotRow[]> {
    const { data, error } = await this.db
      .from("lifecycle_snapshots")
      .select()
      .eq("source_id", sourceId)
      .order("observed_at", { ascending: false })
      .limit(limit);
    if (error) fail("listLifecycleSnapshots", error.message);
    return (data ?? []) as LifecycleSnapshotRow[];
  }

  public async getPricingSnapshot(
    snapshotId: string,
  ): Promise<PricingSnapshotRow | null> {
    const { data, error } = await this.db
      .from("pricing_snapshots")
      .select()
      .eq("id", snapshotId)
      .maybeSingle();
    if (error) fail("getPricingSnapshot", error.message);
    return (data as PricingSnapshotRow | null) ?? null;
  }

  public async getLifecycleSnapshot(
    snapshotId: string,
  ): Promise<LifecycleSnapshotRow | null> {
    const { data, error } = await this.db
      .from("lifecycle_snapshots")
      .select()
      .eq("id", snapshotId)
      .maybeSingle();
    if (error) fail("getLifecycleSnapshot", error.message);
    return (data as LifecycleSnapshotRow | null) ?? null;
  }

  public async getChangeEvent(eventId: string): Promise<ChangeEventRow | null> {
    const { data, error } = await this.db
      .from("change_events")
      .select()
      .eq("id", eventId)
      .maybeSingle();
    if (error) fail("getChangeEvent", error.message);
    return (data as ChangeEventRow | null) ?? null;
  }

  public async listModelsByIds(
    modelIds: readonly string[],
  ): Promise<ModelRow[]> {
    if (modelIds.length === 0) return [];
    const { data, error } = await this.db
      .from("models")
      .select()
      .in("id", [...new Set(modelIds)]);
    if (error) fail("listModelsByIds", error.message);
    return (data ?? []) as ModelRow[];
  }
}

export function createSourceReadPort(
  client?: SupabaseServerClient,
): SourceReadPort {
  return new SupabaseSourceReadPort(client);
}
