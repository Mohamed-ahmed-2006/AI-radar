/**
 * In-memory implementation of the model explorer read port.
 *
 * It holds *rows* and reproduces what the database views do, so the assembly
 * logic under test is the logic that runs in production:
 *
 *   * pricing collapses to the newest row per (model, pricing mode, tier)
 *   * capability and lifecycle collapse to the newest row per (model, API id)
 *   * only runs that succeeded or partially succeeded are current evidence
 *
 * Tests supply `runStatuses` when they want a failed run's rows to be visible
 * as history but excluded from current evidence; rows whose run is unlisted are
 * treated as comparable, which keeps simple fixtures short.
 */

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
  RunStatus,
  SourceRow,
} from "../supabase/types";
import type { ModelExplorerReadPort } from "./port";

export interface InMemoryExplorerData {
  providers?: ProviderRow[];
  sources?: SourceRow[];
  models?: ModelRow[];
  modelAliases?: ModelAliasRow[];
  pricingSnapshots?: PricingSnapshotRow[];
  capabilitySnapshots?: CapabilitySnapshotRow[];
  lifecycleSnapshots?: LifecycleSnapshotRow[];
  changeEvents?: ChangeEventRow[];
  /** Run id to status; absent ids count as comparable. */
  runStatuses?: Record<string, RunStatus>;
  externalRunIds?: Record<string, string | null>;
}

function newestFirst<T extends { observed_at: string; created_at?: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    const byObserved = Date.parse(b.observed_at) - Date.parse(a.observed_at);
    if (byObserved !== 0) return byObserved;
    return Date.parse(b.created_at ?? b.observed_at) -
      Date.parse(a.created_at ?? a.observed_at);
  });
}

/** Reproduces `select distinct on (...) ... order by observed_at desc`. */
function distinctOnNewest<T extends { observed_at: string; created_at?: string }>(
  rows: readonly T[],
  key: (row: T) => string,
): T[] {
  const seen = new Set<string>();
  const picked: T[] = [];
  for (const row of newestFirst(rows)) {
    const rowKey = key(row);
    if (seen.has(rowKey)) continue;
    seen.add(rowKey);
    picked.push(row);
  }
  return picked;
}

export class InMemoryModelExplorerReadPort implements ModelExplorerReadPort {
  public readonly data: Required<InMemoryExplorerData>;

  constructor(data: InMemoryExplorerData = {}) {
    this.data = {
      providers: data.providers ?? [],
      sources: data.sources ?? [],
      models: data.models ?? [],
      modelAliases: data.modelAliases ?? [],
      pricingSnapshots: data.pricingSnapshots ?? [],
      capabilitySnapshots: data.capabilitySnapshots ?? [],
      lifecycleSnapshots: data.lifecycleSnapshots ?? [],
      changeEvents: data.changeEvents ?? [],
      runStatuses: data.runStatuses ?? {},
      externalRunIds: data.externalRunIds ?? {},
    };
  }

  private comparable<T extends { run_id: string }>(rows: readonly T[]): T[] {
    return rows.filter((row) => {
      const status = this.data.runStatuses[row.run_id];
      return status === undefined || status === "succeeded" || status === "partial";
    });
  }

  private wanted<T extends { model_id: string }>(
    rows: readonly T[],
    modelIds: readonly string[] | undefined,
  ): T[] {
    if (!modelIds) return [...rows];
    const set = new Set(modelIds);
    return rows.filter((row) => set.has(row.model_id));
  }

  private providerOf(providerId: string): ProviderRow | undefined {
    return this.data.providers.find((provider) => provider.id === providerId);
  }

  private modelOf(modelId: string): ModelRow | undefined {
    return this.data.models.find((model) => model.id === modelId);
  }

  /** The three joined columns every `latest_*` view adds. */
  private joined<T extends { model_id: string; provider_id: string }>(row: T) {
    return {
      ...row,
      model_name: this.modelOf(row.model_id)?.model_name ?? "",
      provider_slug: this.providerOf(row.provider_id)?.slug ?? "",
      provider_name: this.providerOf(row.provider_id)?.name ?? "",
    };
  }

  public async listProviders(): Promise<ProviderRow[]> {
    return [...this.data.providers];
  }

  public async listSources(): Promise<SourceRow[]> {
    return [...this.data.sources];
  }

  public async listModels(
    options: { modelIds?: readonly string[] } = {},
  ): Promise<ModelRow[]> {
    const models = options.modelIds
      ? this.data.models.filter((model) => options.modelIds!.includes(model.id))
      : [...this.data.models];
    return models.sort((a, b) => a.model_name.localeCompare(b.model_name));
  }

  public async listModelAliases(
    modelIds: readonly string[],
  ): Promise<ModelAliasRow[]> {
    const wanted = new Set(modelIds);
    return this.data.modelAliases.filter((alias) => wanted.has(alias.model_id));
  }

  public async listCurrentPricing(
    options: { modelIds?: readonly string[] } = {},
  ): Promise<LatestPricingSnapshotRow[]> {
    const rows = distinctOnNewest(
      this.comparable(this.wanted(this.data.pricingSnapshots, options.modelIds)),
      (row) => `${row.model_id}|${row.pricing_mode}|${row.context_tier}`,
    );
    return rows.map((row) => this.joined(row));
  }

  public async listCurrentCapabilities(
    options: { modelIds?: readonly string[] } = {},
  ): Promise<LatestCapabilitySnapshotRow[]> {
    const rows = distinctOnNewest(
      this.comparable(this.wanted(this.data.capabilitySnapshots, options.modelIds)),
      (row) => `${row.model_id}|${row.api_model_id}`,
    );
    return rows.map((row) => this.joined(row));
  }

  public async listCurrentLifecycle(
    options: { modelIds?: readonly string[] } = {},
  ): Promise<LatestLifecycleSnapshotRow[]> {
    const rows = distinctOnNewest(
      this.comparable(this.wanted(this.data.lifecycleSnapshots, options.modelIds)),
      (row) => `${row.model_id}|${row.api_model_id}`,
    );
    return rows.map((row) => ({
      ...this.joined(row),
      projected_lifecycle_state: this.modelOf(row.model_id)?.lifecycle_state ?? null,
    }));
  }

  public async listPricingHistory(
    modelId: string,
    limit = 100,
  ): Promise<PricingSnapshotRow[]> {
    return newestFirst(
      this.data.pricingSnapshots.filter((row) => row.model_id === modelId),
    ).slice(0, limit);
  }

  public async listCapabilityHistory(
    modelId: string,
    limit = 100,
  ): Promise<CapabilitySnapshotRow[]> {
    return newestFirst(
      this.data.capabilitySnapshots.filter((row) => row.model_id === modelId),
    ).slice(0, limit);
  }

  public async listLifecycleHistory(
    modelId: string,
    limit = 100,
  ): Promise<LifecycleSnapshotRow[]> {
    return newestFirst(
      this.data.lifecycleSnapshots.filter((row) => row.model_id === modelId),
    ).slice(0, limit);
  }

  public async listModelChangeEvents(
    modelId: string,
    limit = 50,
  ): Promise<ChangeEventRow[]> {
    return [...this.data.changeEvents]
      .filter((event) => event.model_id === modelId)
      .sort((a, b) => Date.parse(b.detected_at) - Date.parse(a.detected_at))
      .slice(0, limit);
  }

  public async listExternalRunIds(
    runIds: readonly string[],
  ): Promise<Array<{ id: string; external_run_id: string | null }>> {
    return [...new Set(runIds)].map((id) => ({
      id,
      external_run_id: this.data.externalRunIds[id] ?? null,
    }));
  }
}
