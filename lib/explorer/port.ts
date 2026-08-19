/**
 * Read port for the Model Explorer, Model Detail and Model Compare read models.
 *
 * Same contract as the source-detail port and for the same two reasons: the
 * assembly logic is testable without a database, and every query that backs a
 * public model response is declared in one place.
 *
 * The current-evidence queries read the *comparable* views on purpose. Those
 * views only surface snapshots produced by a run that succeeded or partially
 * succeeded, which is what "trusted evidence" means here; a failed run's rows
 * are history, not the current truth.
 */

import {
  createSupabaseServerClient,
  type SupabaseServerClient,
} from "../supabase/server";
import type {
  CapabilitySnapshotRow,
  ChangeEventRow,
  LatestCapabilitySnapshotRow,
  LatestLifecycleSnapshotRow,
  LatestPricingSnapshotRow,
  LifecycleSnapshotRow,
  ModelAliasRow,
  ModelRow,
  PricingSnapshotRow,
  ProviderRow,
  SourceRow,
} from "../supabase/types";

export interface ModelExplorerReadPort {
  listProviders(): Promise<ProviderRow[]>;
  listSources(): Promise<SourceRow[]>;
  /** Canonical models. This — not the catalog — is the explorer's spine. */
  listModels(options?: { modelIds?: readonly string[] }): Promise<ModelRow[]>;
  listModelAliases(modelIds: readonly string[]): Promise<ModelAliasRow[]>;
  listCurrentPricing(options?: {
    modelIds?: readonly string[];
  }): Promise<LatestPricingSnapshotRow[]>;
  listCurrentCapabilities(options?: {
    modelIds?: readonly string[];
  }): Promise<LatestCapabilitySnapshotRow[]>;
  listCurrentLifecycle(options?: {
    modelIds?: readonly string[];
  }): Promise<LatestLifecycleSnapshotRow[]>;
  listPricingHistory(modelId: string, limit?: number): Promise<PricingSnapshotRow[]>;
  listCapabilityHistory(
    modelId: string,
    limit?: number,
  ): Promise<CapabilitySnapshotRow[]>;
  listLifecycleHistory(
    modelId: string,
    limit?: number,
  ): Promise<LifecycleSnapshotRow[]>;
  listModelChangeEvents(modelId: string, limit?: number): Promise<ChangeEventRow[]>;
  /** External (collector) run ids, so provenance can name the Bright Data run. */
  listExternalRunIds(
    runIds: readonly string[],
  ): Promise<Array<{ id: string; external_run_id: string | null }>>;
}

function fail(operation: string, message: string | undefined): never {
  throw new Error(`${operation} failed: ${message ?? "unknown error"}`);
}

/**
 * Supabase-backed port, constructed with the anon client. Every table it reads
 * is public-readable evidence; nothing service-role-only is reachable from
 * here even if a future query forgets to narrow its columns.
 */
export class SupabaseModelExplorerReadPort implements ModelExplorerReadPort {
  private readonly db: SupabaseServerClient;

  constructor(client?: SupabaseServerClient) {
    this.db = client ?? createSupabaseServerClient();
  }

  public async listProviders(): Promise<ProviderRow[]> {
    const { data, error } = await this.db.from("providers").select();
    if (error) fail("listProviders", error.message);
    return (data ?? []) as ProviderRow[];
  }

  public async listSources(): Promise<SourceRow[]> {
    const { data, error } = await this.db.from("sources").select();
    if (error) fail("listSources", error.message);
    return (data ?? []) as SourceRow[];
  }

  public async listModels(
    options: { modelIds?: readonly string[] } = {},
  ): Promise<ModelRow[]> {
    let query = this.db.from("models").select().order("model_name");
    if (options.modelIds) {
      if (options.modelIds.length === 0) return [];
      query = query.in("id", [...new Set(options.modelIds)]);
    }
    const { data, error } = await query;
    if (error) fail("listModels", error.message);
    return (data ?? []) as ModelRow[];
  }

  public async listModelAliases(
    modelIds: readonly string[],
  ): Promise<ModelAliasRow[]> {
    if (modelIds.length === 0) return [];
    const { data, error } = await this.db
      .from("model_aliases")
      .select()
      .in("model_id", [...new Set(modelIds)]);
    if (error) fail("listModelAliases", error.message);
    return (data ?? []) as ModelAliasRow[];
  }

  public async listCurrentPricing(
    options: { modelIds?: readonly string[] } = {},
  ): Promise<LatestPricingSnapshotRow[]> {
    let query = this.db.from("latest_comparable_pricing_snapshots").select();
    if (options.modelIds) {
      if (options.modelIds.length === 0) return [];
      query = query.in("model_id", [...new Set(options.modelIds)]);
    }
    const { data, error } = await query;
    if (error) fail("listCurrentPricing", error.message);
    return (data ?? []) as LatestPricingSnapshotRow[];
  }

  public async listCurrentCapabilities(
    options: { modelIds?: readonly string[] } = {},
  ): Promise<LatestCapabilitySnapshotRow[]> {
    let query = this.db.from("latest_comparable_capability_snapshots").select();
    if (options.modelIds) {
      if (options.modelIds.length === 0) return [];
      query = query.in("model_id", [...new Set(options.modelIds)]);
    }
    const { data, error } = await query;
    if (error) fail("listCurrentCapabilities", error.message);
    return (data ?? []) as LatestCapabilitySnapshotRow[];
  }

  public async listCurrentLifecycle(
    options: { modelIds?: readonly string[] } = {},
  ): Promise<LatestLifecycleSnapshotRow[]> {
    let query = this.db.from("latest_comparable_lifecycle_snapshots").select();
    if (options.modelIds) {
      if (options.modelIds.length === 0) return [];
      query = query.in("model_id", [...new Set(options.modelIds)]);
    }
    const { data, error } = await query;
    if (error) fail("listCurrentLifecycle", error.message);
    return (data ?? []) as LatestLifecycleSnapshotRow[];
  }

  public async listPricingHistory(
    modelId: string,
    limit = 100,
  ): Promise<PricingSnapshotRow[]> {
    const { data, error } = await this.db
      .from("pricing_snapshots")
      .select()
      .eq("model_id", modelId)
      .order("observed_at", { ascending: false })
      .limit(limit);
    if (error) fail("listPricingHistory", error.message);
    return (data ?? []) as PricingSnapshotRow[];
  }

  public async listCapabilityHistory(
    modelId: string,
    limit = 100,
  ): Promise<CapabilitySnapshotRow[]> {
    const { data, error } = await this.db
      .from("capability_snapshots")
      .select()
      .eq("model_id", modelId)
      .order("observed_at", { ascending: false })
      .limit(limit);
    if (error) fail("listCapabilityHistory", error.message);
    return (data ?? []) as CapabilitySnapshotRow[];
  }

  public async listLifecycleHistory(
    modelId: string,
    limit = 100,
  ): Promise<LifecycleSnapshotRow[]> {
    const { data, error } = await this.db
      .from("lifecycle_snapshots")
      .select()
      .eq("model_id", modelId)
      .order("observed_at", { ascending: false })
      .limit(limit);
    if (error) fail("listLifecycleHistory", error.message);
    return (data ?? []) as LifecycleSnapshotRow[];
  }

  public async listModelChangeEvents(
    modelId: string,
    limit = 50,
  ): Promise<ChangeEventRow[]> {
    const { data, error } = await this.db
      .from("change_events")
      .select()
      .eq("model_id", modelId)
      .order("detected_at", { ascending: false })
      .limit(limit);
    if (error) fail("listModelChangeEvents", error.message);
    return (data ?? []) as ChangeEventRow[];
  }

  public async listExternalRunIds(
    runIds: readonly string[],
  ): Promise<Array<{ id: string; external_run_id: string | null }>> {
    if (runIds.length === 0) return [];
    const { data, error } = await this.db
      .from("collection_runs")
      .select("id, external_run_id")
      .in("id", [...new Set(runIds)]);
    if (error) fail("listExternalRunIds", error.message);
    return (data ?? []) as Array<{ id: string; external_run_id: string | null }>;
  }
}

export function createModelExplorerReadPort(
  client?: SupabaseServerClient,
): ModelExplorerReadPort {
  return new SupabaseModelExplorerReadPort(client);
}
