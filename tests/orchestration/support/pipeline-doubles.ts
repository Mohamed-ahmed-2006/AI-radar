/**
 * In-memory doubles for the canonical persistence layer.
 *
 * They stand in for Supabase only. The pipelines under test are the real ones,
 * so anything these doubles record is something a real collection would have
 * written to the database.
 */

import type {
  LifecyclePipelineRepository,
  OpenAiCollectorResult,
  OpenAiPricingPipelineRepository,
} from "../../../lib/pipeline";
import type {
  ChangeEventInput,
  CollectionRunRow,
  Json,
  LatestLifecycleSnapshotRow,
  LatestPricingSnapshotRow,
  LifecycleSnapshotInput,
  LifecycleSnapshotRow,
  ModelAliasInput,
  ModelAliasRow,
  ModelLifecycleProjectionInput,
  ModelRow,
  PricingSnapshotInput,
  ProviderRow,
  RunStatus,
  SourceRow,
} from "../../../lib/supabase";
import { modelLifecycleProjectionPatch } from "../../../lib/supabase";

export const TIMESTAMP = "2026-08-18T09:00:00.000Z";

function model(id: string, providerId: string, modelName: string): ModelRow {
  return {
    id,
    provider_id: providerId,
    model_name: modelName,
    display_name: null,
    metadata: {},
    is_active: true,
    lifecycle_state: null,
    deprecated_on: null,
    retirement_date: null,
    retirement_not_before_date: null,
    lifecycle_source_id: null,
    lifecycle_observed_at: null,
    first_seen_at: TIMESTAMP,
    last_seen_at: TIMESTAMP,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  };
}

/** Everything a quarantined run must never produce. */
export interface CanonicalWriteLog {
  models: ModelRow[];
  pricingSnapshots: PricingSnapshotInput[];
  lifecycleSnapshots: LifecycleSnapshotInput[];
  lifecycleProjections: ModelLifecycleProjectionInput[];
  changeEvents: ChangeEventInput[];
  runs: CollectionRunRow[];
}

export function canonicalWriteCount(log: CanonicalWriteLog): number {
  return (
    log.models.length +
    log.pricingSnapshots.length +
    log.lifecycleSnapshots.length +
    log.lifecycleProjections.length +
    log.changeEvents.length
  );
}

export class RecordingPricingRepository implements OpenAiPricingPipelineRepository {
  readonly models: ModelRow[] = [];
  readonly pricingSnapshots: PricingSnapshotInput[] = [];
  readonly lifecycleSnapshots: LifecycleSnapshotInput[] = [];
  readonly lifecycleProjections: ModelLifecycleProjectionInput[] = [];
  readonly changeEvents: ChangeEventInput[] = [];
  readonly runs: CollectionRunRow[] = [];
  private nextRun = 1;
  private nextModel = 1;
  private nextSnapshot = 1;

  constructor(private readonly providerId = "provider-1") {}

  async upsertProvider(input: { slug: string; name: string; homepageUrl?: string | null }) {
    return {
      id: this.providerId,
      slug: input.slug,
      name: input.name,
      homepage_url: input.homepageUrl ?? null,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
    } satisfies ProviderRow;
  }

  async upsertSource(input: {
    providerId: string;
    sourceUrl: string;
    collectorId?: string | null;
    label?: string | null;
  }) {
    return {
      id: "source-1",
      provider_id: input.providerId,
      kind: "pricing",
      collector_id: input.collectorId ?? null,
      source_url: input.sourceUrl,
      label: input.label ?? null,
      is_active: true,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
    } satisfies SourceRow;
  }

  async startCollectionRun(input: {
    sourceId: string;
    externalRunId?: string | null;
    triggeredBy?: string;
  }) {
    const existing = this.runs.find(
      (run) => input.externalRunId != null && run.external_run_id === input.externalRunId,
    );
    if (existing) return existing;
    const run: CollectionRunRow = {
      id: `run-${this.nextRun++}`,
      source_id: input.sourceId,
      status: "running",
      external_run_id: input.externalRunId ?? null,
      triggered_by: input.triggeredBy ?? "manual",
      started_at: TIMESTAMP,
      completed_at: null,
      records_seen: 0,
      records_accepted: 0,
      records_rejected: 0,
      error_message: null,
      error_details: null,
      validation_errors: [],
      created_at: TIMESTAMP,
    };
    this.runs.push(run);
    return run;
  }

  async failCollectionRun(
    runId: string,
    error: { message: string; details?: Json },
    counts: Partial<{ recordsSeen: number; recordsAccepted: number; recordsRejected: number }> = {},
  ) {
    const run = this.requireRun(runId);
    run.status = "failed";
    run.completed_at = TIMESTAMP;
    run.error_message = error.message;
    run.error_details = error.details ?? null;
    run.records_seen = counts.recordsSeen ?? run.records_seen;
    run.records_accepted = counts.recordsAccepted ?? run.records_accepted;
    run.records_rejected = counts.recordsRejected ?? run.records_rejected;
    return run;
  }

  async completeCollectionRun(
    runId: string,
    counts: { recordsSeen: number; recordsAccepted: number; recordsRejected: number },
  ) {
    const run = this.requireRun(runId);
    run.status = counts.recordsRejected > 0 ? "partial" : "succeeded";
    run.completed_at = TIMESTAMP;
    run.records_seen = counts.recordsSeen;
    run.records_accepted = counts.recordsAccepted;
    run.records_rejected = counts.recordsRejected;
    return run;
  }

  async upsertModels(inputs: readonly { providerId: string; modelName: string; seenAt: string }[]) {
    return inputs.map((input) => {
      const existing = this.models.find((row) => row.model_name === input.modelName);
      if (existing) return existing;
      const row = model(`model-${this.nextModel++}`, input.providerId, input.modelName);
      this.models.push(row);
      return row;
    });
  }

  async listModels() {
    return [...this.models];
  }

  async getComparablePricingSnapshots(): Promise<LatestPricingSnapshotRow[]> {
    return [];
  }

  async savePricingSnapshots(inputs: readonly PricingSnapshotInput[]) {
    this.pricingSnapshots.push(...inputs);
    return inputs.map((input) => ({
      id: `snapshot-${this.nextSnapshot++}`,
      model_id: input.modelId,
      pricing_mode: input.pricingMode ?? "standard",
      context_tier: input.contextTier ?? "standard",
    }));
  }

  async saveChangeEvents(inputs: readonly ChangeEventInput[]) {
    this.changeEvents.push(...inputs);
    return [...inputs];
  }

  private requireRun(id: string): CollectionRunRow {
    const run = this.runs.find((candidate) => candidate.id === id);
    if (!run) throw new Error(`missing run ${id}`);
    return run;
  }
}

export class RecordingLifecycleRepository implements LifecyclePipelineRepository {
  readonly models: ModelRow[] = [];
  readonly aliases: ModelAliasRow[] = [];
  readonly pricingSnapshots: PricingSnapshotInput[] = [];
  readonly lifecycleSnapshots: LifecycleSnapshotInput[] = [];
  readonly lifecycleProjections: ModelLifecycleProjectionInput[] = [];
  readonly changeEvents: ChangeEventInput[] = [];
  readonly runs: CollectionRunRow[] = [];
  private nextRun = 1;
  private nextModel = 1;
  private nextSnapshot = 1;

  constructor(private readonly providerId = "provider-1") {}

  async upsertProvider(input: { slug: string; name: string; homepageUrl?: string | null }) {
    return {
      id: this.providerId,
      slug: input.slug,
      name: input.name,
      homepage_url: input.homepageUrl ?? null,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
    } satisfies ProviderRow;
  }

  async upsertSource(input: {
    providerId: string;
    sourceUrl: string;
    collectorId?: string | null;
    label?: string | null;
  }) {
    return {
      id: "source-lifecycle",
      provider_id: input.providerId,
      kind: "models",
      collector_id: input.collectorId ?? null,
      source_url: input.sourceUrl,
      label: input.label ?? null,
      is_active: true,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
    } satisfies SourceRow;
  }

  async startCollectionRun(input: {
    sourceId: string;
    externalRunId?: string | null;
    triggeredBy?: string;
  }) {
    const existing = this.runs.find(
      (run) => input.externalRunId != null && run.external_run_id === input.externalRunId,
    );
    if (existing) return existing;
    const run: CollectionRunRow = {
      id: `run-${this.nextRun++}`,
      source_id: input.sourceId,
      status: "running",
      external_run_id: input.externalRunId ?? null,
      triggered_by: input.triggeredBy ?? "manual",
      started_at: TIMESTAMP,
      completed_at: null,
      records_seen: 0,
      records_accepted: 0,
      records_rejected: 0,
      error_message: null,
      error_details: null,
      validation_errors: [],
      created_at: TIMESTAMP,
    };
    this.runs.push(run);
    return run;
  }

  async failCollectionRun(
    runId: string,
    error: { message: string; details?: Json },
    counts: Partial<{ recordsSeen: number; recordsAccepted: number; recordsRejected: number }> = {},
  ) {
    const run = this.requireRun(runId);
    run.status = "failed";
    run.completed_at = TIMESTAMP;
    run.error_message = error.message;
    run.error_details = error.details ?? null;
    run.records_seen = counts.recordsSeen ?? run.records_seen;
    run.records_accepted = counts.recordsAccepted ?? run.records_accepted;
    run.records_rejected = counts.recordsRejected ?? run.records_rejected;
    return run;
  }

  async completeCollectionRun(
    runId: string,
    counts: { recordsSeen: number; recordsAccepted: number; recordsRejected: number },
    status?: Extract<RunStatus, "succeeded" | "partial">,
    validationErrors: Json = [],
  ) {
    const run = this.requireRun(runId);
    run.status = status ?? (counts.recordsRejected > 0 ? "partial" : "succeeded");
    run.completed_at = TIMESTAMP;
    run.records_seen = counts.recordsSeen;
    run.records_accepted = counts.recordsAccepted;
    run.records_rejected = counts.recordsRejected;
    run.validation_errors = validationErrors;
    return run;
  }

  async listModels() {
    return [...this.models];
  }

  async upsertModels(inputs: readonly { providerId: string; modelName: string; seenAt: string }[]) {
    return inputs.map((input) => {
      const existing = this.models.find((row) => row.model_name === input.modelName);
      if (existing) return existing;
      const row = model(`model-${this.nextModel++}`, input.providerId, input.modelName);
      this.models.push(row);
      return row;
    });
  }

  async listModelAliases() {
    return [...this.aliases];
  }

  async upsertModelAliases(inputs: readonly ModelAliasInput[]) {
    const rows = inputs.map((input) => ({
      id: `alias-${input.alias}`,
      provider_id: input.providerId,
      model_id: input.modelId,
      source_id: input.sourceId ?? null,
      alias: input.alias,
      alias_type: input.aliasType,
      first_seen_at: TIMESTAMP,
      last_seen_at: input.seenAt ?? TIMESTAMP,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
    })) satisfies ModelAliasRow[];
    this.aliases.push(...rows);
    return rows;
  }

  async getComparableLifecycleSnapshots(): Promise<LatestLifecycleSnapshotRow[]> {
    return [];
  }

  async saveLifecycleSnapshots(inputs: readonly LifecycleSnapshotInput[]) {
    this.lifecycleSnapshots.push(...inputs);
    return inputs.map((input) => ({
      id: `lifecycle-${this.nextSnapshot++}`,
      run_id: input.runId,
      source_id: input.sourceId,
      provider_id: input.providerId,
      model_id: input.modelId,
      api_model_id: input.apiModelId,
      lifecycle_state: input.lifecycleState,
      deprecated_on: input.deprecatedOn ?? null,
      retirement_date: input.retirementDate ?? null,
      retirement_not_before_date: input.retirementNotBeforeDate ?? null,
      retirement_not_before_observation: input.retirementNotBeforeObservation ?? "unobserved",
      recommended_replacement: input.recommendedReplacement ?? null,
      recommended_replacement_model_id: input.recommendedReplacementModelId ?? null,
      recommended_replacement_observed: input.recommendedReplacementObserved ?? false,
      source_metadata: input.sourceMetadata ?? {},
      source_url: input.sourceUrl,
      raw: input.raw ?? null,
      observed_at: input.observedAt,
      created_at: TIMESTAMP,
      content_hash: "hash",
    })) satisfies LifecycleSnapshotRow[];
  }

  async applyModelLifecycleProjections(inputs: readonly ModelLifecycleProjectionInput[]) {
    this.lifecycleProjections.push(...inputs);
    return inputs.map((input) => {
      const row = this.models.find((candidate) => candidate.id === input.modelId);
      if (!row) throw new Error("missing model");
      Object.assign(row, modelLifecycleProjectionPatch(input));
      return row;
    });
  }

  async saveChangeEvents(inputs: readonly ChangeEventInput[]) {
    this.changeEvents.push(...inputs);
    return [...inputs];
  }

  private requireRun(id: string): CollectionRunRow {
    const run = this.runs.find((candidate) => candidate.id === id);
    if (!run) throw new Error(`missing run ${id}`);
    return run;
  }
}

export function collectorPayload(
  data: unknown[],
  options: { collectorId: string; runId: string; success?: boolean; error?: string },
): OpenAiCollectorResult {
  return {
    success: options.success ?? true,
    data,
    metadata: {
      collectorId: options.collectorId,
      runId: options.runId,
      startedAt: TIMESTAMP,
      completedAt: TIMESTAMP,
      durationMs: 12,
      resultCount: data.length,
      status: options.success === false ? "failed" : "success",
      ...(options.error ? { error: options.error } : {}),
    },
  };
}
