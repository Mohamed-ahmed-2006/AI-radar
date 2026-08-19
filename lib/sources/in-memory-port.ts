/**
 * In-memory implementation of the source read port.
 *
 * Used by the tests, and deliberately shaped like the Supabase port: it holds
 * *rows*, so the assembly logic under test is the same logic that runs in
 * production. It also mirrors the privilege boundary — quarantine payloads have
 * no accessor here at all, because the public read path has no business
 * reaching them.
 */

import type {
  ChangeEventRow,
  LifecycleSnapshotRow,
  ModelRow,
  PricingSnapshotRow,
  ProviderRow,
  SentinelIncidentRow,
  SentinelSourceHealthRow,
  SourceRow,
} from "../supabase/types";
import type {
  PublicCollectionRunRow,
  PublicHealingAttemptRow,
  SourceReadPort,
} from "./port";

export interface InMemorySourceData {
  sources?: SourceRow[];
  providers?: ProviderRow[];
  sentinelHealth?: SentinelSourceHealthRow[];
  runs?: PublicCollectionRunRow[];
  incidents?: SentinelIncidentRow[];
  healingAttempts?: PublicHealingAttemptRow[];
  pricingSnapshots?: PricingSnapshotRow[];
  lifecycleSnapshots?: LifecycleSnapshotRow[];
  changeEvents?: ChangeEventRow[];
  models?: ModelRow[];
}

function byStartedAtDesc<T extends { started_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
}

function byObservedAtDesc<T extends { observed_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));
}

export class InMemorySourceReadPort implements SourceReadPort {
  public readonly data: Required<InMemorySourceData>;

  constructor(data: InMemorySourceData = {}) {
    this.data = {
      sources: data.sources ?? [],
      providers: data.providers ?? [],
      sentinelHealth: data.sentinelHealth ?? [],
      runs: data.runs ?? [],
      incidents: data.incidents ?? [],
      healingAttempts: data.healingAttempts ?? [],
      pricingSnapshots: data.pricingSnapshots ?? [],
      lifecycleSnapshots: data.lifecycleSnapshots ?? [],
      changeEvents: data.changeEvents ?? [],
      models: data.models ?? [],
    };
  }

  public async listSources(): Promise<SourceRow[]> {
    return [...this.data.sources];
  }

  public async getSource(sourceId: string): Promise<SourceRow | null> {
    return this.data.sources.find((source) => source.id === sourceId) ?? null;
  }

  public async listProviders(): Promise<ProviderRow[]> {
    return [...this.data.providers];
  }

  public async getProvider(providerId: string): Promise<ProviderRow | null> {
    return this.data.providers.find((provider) => provider.id === providerId) ?? null;
  }

  public async listSentinelHealth(): Promise<SentinelSourceHealthRow[]> {
    return [...this.data.sentinelHealth];
  }

  public async listRuns(
    sourceId: string,
    limit = 20,
  ): Promise<PublicCollectionRunRow[]> {
    return byStartedAtDesc(
      this.data.runs.filter((run) => run.source_id === sourceId),
    ).slice(0, limit);
  }

  public async listRecentRuns(limit = 200): Promise<PublicCollectionRunRow[]> {
    return byStartedAtDesc(this.data.runs).slice(0, limit);
  }

  public async getRun(runId: string): Promise<PublicCollectionRunRow | null> {
    return this.data.runs.find((run) => run.id === runId) ?? null;
  }

  public async listIncidents(
    sourceId: string,
    limit = 20,
  ): Promise<SentinelIncidentRow[]> {
    return [...this.data.incidents]
      .filter((incident) => incident.source_id === sourceId)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, limit);
  }

  public async listHealingAttempts(
    sourceId: string,
    limit = 20,
  ): Promise<PublicHealingAttemptRow[]> {
    return byStartedAtDesc(
      this.data.healingAttempts.filter((attempt) => attempt.source_id === sourceId),
    ).slice(0, limit);
  }

  public async listPricingSnapshots(
    sourceId: string,
    limit = 50,
  ): Promise<PricingSnapshotRow[]> {
    return byObservedAtDesc(
      this.data.pricingSnapshots.filter((snapshot) => snapshot.source_id === sourceId),
    ).slice(0, limit);
  }

  public async listLifecycleSnapshots(
    sourceId: string,
    limit = 50,
  ): Promise<LifecycleSnapshotRow[]> {
    return byObservedAtDesc(
      this.data.lifecycleSnapshots.filter((snapshot) => snapshot.source_id === sourceId),
    ).slice(0, limit);
  }

  public async getPricingSnapshot(
    snapshotId: string,
  ): Promise<PricingSnapshotRow | null> {
    return (
      this.data.pricingSnapshots.find((snapshot) => snapshot.id === snapshotId) ?? null
    );
  }

  public async getLifecycleSnapshot(
    snapshotId: string,
  ): Promise<LifecycleSnapshotRow | null> {
    return (
      this.data.lifecycleSnapshots.find((snapshot) => snapshot.id === snapshotId) ?? null
    );
  }

  public async getChangeEvent(eventId: string): Promise<ChangeEventRow | null> {
    return this.data.changeEvents.find((event) => event.id === eventId) ?? null;
  }

  public async listModelsByIds(modelIds: readonly string[]): Promise<ModelRow[]> {
    const wanted = new Set(modelIds);
    return this.data.models.filter((model) => wanted.has(model.id));
  }
}
