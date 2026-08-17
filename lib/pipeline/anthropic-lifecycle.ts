import {
  DEFAULT_ANTHROPIC_LIFECYCLE_COLLECTOR_ID,
  DEFAULT_ANTHROPIC_LIFECYCLE_SOURCE_URL,
  fetchAnthropicLifecycle,
} from "../brightdata";
import { detectLifecycleChanges } from "../change-detection";
import {
  NormalizedLifecycleRecordSchema,
  RawAnthropicLifecycleRecordSchema,
  normalizeAnthropicLifecycleRecord,
  type NormalizedLifecycleRecord,
} from "../contracts";
import { planAnthropicModelMatches } from "../models/identity";
import {
  applyModelLifecycleProjections,
  completeCollectionRun,
  createSupabaseAdminClient,
  failCollectionRun,
  getComparableLifecycleSnapshots,
  listModelAliases,
  listModels,
  saveChangeEvents,
  saveLifecycleSnapshots,
  startCollectionRun,
  upsertModelAliases,
  upsertModels,
  upsertProvider,
  upsertSource,
  type ChangeEventInput,
  type CollectionRunRow,
  type Json,
  type LatestLifecycleSnapshotRow,
  type LifecycleSnapshotInput,
  type LifecycleSnapshotRow,
  type ModelAliasInput,
  type ModelAliasRow,
  type ModelLifecycleProjectionInput,
  type ModelRow,
  type ProviderRow,
  type RunStatus,
  type SourceRow,
} from "../supabase";
import {
  PricingIngestionError,
  type OpenAiCollectorResult,
  type OpenAiPricingIngestionResult,
} from "./openai-pricing";

export interface AnthropicLifecyclePipelineRepository {
  upsertProvider(input: { slug: string; name: string; homepageUrl?: string | null }): Promise<ProviderRow>;
  upsertSource(input: {
    providerId: string;
    sourceUrl: string;
    collectorId?: string | null;
    label?: string | null;
  }): Promise<SourceRow>;
  startCollectionRun(input: {
    sourceId: string;
    externalRunId?: string | null;
    triggeredBy?: string;
  }): Promise<CollectionRunRow>;
  failCollectionRun(
    runId: string,
    error: { message: string; details?: Json },
    counts?: Partial<{ recordsSeen: number; recordsAccepted: number; recordsRejected: number }>,
  ): Promise<CollectionRunRow>;
  completeCollectionRun(
    runId: string,
    counts: { recordsSeen: number; recordsAccepted: number; recordsRejected: number },
    status?: Extract<RunStatus, "succeeded" | "partial">,
    validationErrors?: Json,
  ): Promise<CollectionRunRow>;
  listModels(options: { providerId: string }): Promise<ModelRow[]>;
  upsertModels(input: readonly {
    providerId: string;
    modelName: string;
    seenAt: string;
  }[]): Promise<ModelRow[]>;
  listModelAliases(providerId: string): Promise<ModelAliasRow[]>;
  upsertModelAliases(input: readonly ModelAliasInput[]): Promise<ModelAliasRow[]>;
  getComparableLifecycleSnapshots(options: {
    providerSlug: string;
    sourceId: string;
  }): Promise<LatestLifecycleSnapshotRow[]>;
  saveLifecycleSnapshots(input: readonly LifecycleSnapshotInput[]): Promise<LifecycleSnapshotRow[]>;
  applyModelLifecycleProjections(input: readonly ModelLifecycleProjectionInput[]): Promise<ModelRow[]>;
  saveChangeEvents(input: readonly ChangeEventInput[]): Promise<unknown[]>;
}

function createRepository(): AnthropicLifecyclePipelineRepository {
  const db = createSupabaseAdminClient();
  return {
    upsertProvider: (input) => upsertProvider(db, input),
    upsertSource: (input) => upsertSource(db, { ...input, kind: "models" }),
    startCollectionRun: (input) => startCollectionRun(db, input),
    failCollectionRun: (runId, error, counts) => failCollectionRun(db, runId, error, counts),
    completeCollectionRun: (runId, counts, status, validationErrors) =>
      completeCollectionRun(db, runId, counts, status, validationErrors),
    listModels: (options) => listModels(db, options),
    upsertModels: (input) => upsertModels(db, input),
    listModelAliases: (providerId) => listModelAliases(db, providerId),
    upsertModelAliases: (input) => upsertModelAliases(db, input),
    getComparableLifecycleSnapshots: (options) => getComparableLifecycleSnapshots(db, options),
    saveLifecycleSnapshots: (input) => saveLifecycleSnapshots(db, input),
    applyModelLifecycleProjections: (input) => applyModelLifecycleProjections(db, input),
    saveChangeEvents: (input) => saveChangeEvents(db, input),
  };
}

function snapshotToRecord(row: LatestLifecycleSnapshotRow): NormalizedLifecycleRecord {
  return NormalizedLifecycleRecordSchema.parse({
    provider: "Anthropic",
    apiModelId: row.api_model_id,
    lifecycleState: row.lifecycle_state,
    deprecatedDate: row.deprecated_on,
    retirementDate: row.retirement_date,
    retirementNotBeforeDate: row.retirement_not_before_date,
    provenance: {
      sourceUrl: row.source_url,
      collectorId: null,
      externalRunId: null,
      collectionRunId: row.run_id,
    },
    observedAt: row.observed_at,
  });
}

function jsonCopy(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function lifecycleChangeSummary(
  apiModelId: string,
  field: string,
  oldValue: Json,
  newValue: Json,
): string {
  if (field === "lifecycleState") {
    return `${apiModelId} lifecycle changed: ${String(oldValue)} → ${String(newValue)}`;
  }
  return `${apiModelId} ${field} changed`;
}

export interface IngestAnthropicLifecycleOptions {
  repository?: AnthropicLifecyclePipelineRepository;
  collect?: () => Promise<OpenAiCollectorResult>;
  now?: () => Date;
  triggeredBy?: string;
  collectorId?: string;
  sourceUrl?: string;
}

/**
 * Ingests explicit lifecycle rows only. Collector absence never changes a
 * model; retirement is applied only from a validated `Retired` row.
 */
export async function ingestAnthropicLifecycle(
  options: IngestAnthropicLifecycleOptions = {},
): Promise<OpenAiPricingIngestionResult> {
  if (typeof window !== "undefined") {
    throw new Error("ingestAnthropicLifecycle must only run on the server");
  }
  const repository = options.repository ?? createRepository();
  const collectorId = (
    options.collectorId ??
    process.env.BRIGHTDATA_ANTHROPIC_LIFECYCLE_COLLECTOR_ID ??
    DEFAULT_ANTHROPIC_LIFECYCLE_COLLECTOR_ID
  ).trim();
  const sourceUrl = (
    options.sourceUrl ??
    process.env.ANTHROPIC_LIFECYCLE_SOURCE_URL ??
    DEFAULT_ANTHROPIC_LIFECYCLE_SOURCE_URL
  ).trim();
  const collect = options.collect ?? (() => fetchAnthropicLifecycle({ collectorId, sourceUrl }));
  const startedAt = Date.now();
  const provider = await repository.upsertProvider({
    slug: "anthropic",
    name: "Anthropic",
    homepageUrl: "https://www.anthropic.com",
  });
  const source = await repository.upsertSource({
    providerId: provider.id,
    sourceUrl,
    collectorId,
    label: "Anthropic model lifecycle and deprecations",
  });

  let collection: OpenAiCollectorResult;
  try {
    collection = await collect();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bright Data collection failed";
    const run = await repository.startCollectionRun({
      sourceId: source.id,
      triggeredBy: options.triggeredBy ?? "manual-api",
    });
    await repository.failCollectionRun(run.id, { message }, {
      recordsSeen: 0,
      recordsAccepted: 0,
      recordsRejected: 0,
    });
    throw new PricingIngestionError(message, { collectionRunId: run.id });
  }

  const externalRunId = collection.metadata.runId;
  const run = await repository.startCollectionRun({
    sourceId: source.id,
    externalRunId,
    triggeredBy: options.triggeredBy ?? "manual-api",
  });
  if (!collection.success) {
    const message = collection.metadata.error ?? collection.error?.message ?? "Bright Data collection failed";
    await repository.failCollectionRun(run.id, { message }, {
      recordsSeen: 0,
      recordsAccepted: 0,
      recordsRejected: 0,
    });
    throw new PricingIngestionError(message, { collectionRunId: run.id, externalRunId });
  }
  if (run.status === "succeeded" || run.status === "partial") {
    return {
      success: true,
      collectionRunId: run.id,
      externalRunId,
      acceptedCount: run.records_accepted,
      rejectedCount: run.records_rejected,
      changesDetected: 0,
      durationMs: Date.now() - startedAt,
      idempotent: true,
    };
  }

  const observedAt = (options.now ?? (() => new Date()))().toISOString();
  const accepted: { normalized: NormalizedLifecycleRecord; raw: unknown }[] = [];
  const validationErrors: Json[] = [];
  const identities = new Set<string>();
  collection.data.forEach((raw, index) => {
    const parsed = RawAnthropicLifecycleRecordSchema.safeParse(raw);
    if (!parsed.success || parsed.data.product_page_url !== sourceUrl) {
      validationErrors.push({
        index,
        issues: parsed.success
          ? [{ path: "product_page_url", message: "Unexpected lifecycle source URL" }]
          : parsed.error.issues.map((issue) => ({
              path: issue.path.map(String).join("."),
              message: issue.message,
            })),
      });
      return;
    }
    const normalized = normalizeAnthropicLifecycleRecord(parsed.data, {
      observedAt,
      collectorId: collection.metadata.collectorId,
      externalRunId: externalRunId ?? null,
      collectionRunId: run.id,
    });
    if (identities.has(normalized.apiModelId)) {
      validationErrors.push({ index, issues: [{ path: "api_model_name", message: "Duplicate API model ID" }] });
      return;
    }
    identities.add(normalized.apiModelId);
    accepted.push({ normalized, raw });
  });

  const counts = {
    recordsSeen: collection.data.length,
    recordsAccepted: accepted.length,
    recordsRejected: validationErrors.length,
  };

  try {
    const existingModels = await repository.listModels({ providerId: provider.id });
    const aliases = await repository.listModelAliases(provider.id);
    const plans = planAnthropicModelMatches(
      accepted.map(({ normalized }) => normalized.apiModelId),
      existingModels,
      aliases,
    );
    const createdModels = await repository.upsertModels(
      plans
        .filter((plan) => plan.createModelName !== null)
        .map((plan) => ({
          providerId: provider.id,
          modelName: plan.createModelName as string,
          seenAt: observedAt,
        })),
    );
    const modelsByName = new Map(
      [...existingModels, ...createdModels].map((model) => [model.model_name, model]),
    );
    const modelByApiId = new Map<string, ModelRow>();
    for (const plan of plans) {
      const model = plan.model ?? modelsByName.get(plan.createModelName as string);
      if (!model) throw new Error(`No canonical model resolved for ${plan.apiModelId}`);
      modelByApiId.set(plan.apiModelId, model);
    }
    await repository.upsertModelAliases(plans.map((plan) => ({
      providerId: provider.id,
      modelId: modelByApiId.get(plan.apiModelId)?.id as string,
      sourceId: source.id,
      alias: plan.apiModelId,
      aliasType: "api_model_id",
      seenAt: observedAt,
    })));

    const previousRows = await repository.getComparableLifecycleSnapshots({
      providerSlug: "anthropic",
      sourceId: source.id,
    });
    const previous = previousRows.map(snapshotToRecord);
    const current = accepted.map(({ normalized }) => normalized);
    const changes = detectLifecycleChanges(previous, current);
    const snapshots = await repository.saveLifecycleSnapshots(accepted.map(({ normalized, raw }) => {
      const model = modelByApiId.get(normalized.apiModelId);
      if (!model) throw new Error(`No model for lifecycle row ${normalized.apiModelId}`);
      return {
        runId: run.id,
        sourceId: source.id,
        providerId: provider.id,
        modelId: model.id,
        apiModelId: normalized.apiModelId,
        lifecycleState: normalized.lifecycleState,
        deprecatedOn: normalized.deprecatedDate,
        retirementDate: normalized.retirementDate,
        retirementNotBeforeDate: normalized.retirementNotBeforeDate,
        sourceUrl: normalized.provenance.sourceUrl,
        raw: jsonCopy(raw),
        observedAt,
      } satisfies LifecycleSnapshotInput;
    }));
    const previousByApiId = new Map(previousRows.map((row) => [row.api_model_id, row]));
    const currentByApiId = new Map(snapshots.map((row) => [row.api_model_id, row]));

    await repository.saveChangeEvents(changes.map((change) => {
      const model = modelByApiId.get(change.apiModelId);
      if (!model) throw new Error(`No model for lifecycle change ${change.apiModelId}`);
      return {
        providerId: provider.id,
        sourceId: source.id,
        runId: run.id,
        modelId: model.id,
        changeType: "lifecycle_changed",
        fieldName: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        previousLifecycleSnapshotId: previousByApiId.get(change.apiModelId)?.id ?? null,
        currentLifecycleSnapshotId: currentByApiId.get(change.apiModelId)?.id ?? null,
        summary: lifecycleChangeSummary(
          change.apiModelId,
          change.field,
          change.oldValue,
          change.newValue,
        ),
        detectedAt: observedAt,
      } satisfies ChangeEventInput;
    }));

    await repository.applyModelLifecycleProjections(current.map((record) => ({
      modelId: modelByApiId.get(record.apiModelId)?.id as string,
      sourceId: source.id,
      lifecycleState: record.lifecycleState,
      deprecatedOn: record.deprecatedDate,
      retirementDate: record.retirementDate,
      retirementNotBeforeDate: record.retirementNotBeforeDate,
      observedAt,
    })));
    await repository.completeCollectionRun(
      run.id,
      counts,
      undefined,
      validationErrors,
    );
    return {
      success: true,
      collectionRunId: run.id,
      externalRunId,
      acceptedCount: accepted.length,
      rejectedCount: validationErrors.length,
      changesDetected: changes.length,
      durationMs: Date.now() - startedAt,
      idempotent: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lifecycle persistence failed";
    await repository.failCollectionRun(run.id, { message, details: validationErrors }, counts);
    throw new PricingIngestionError(message, { collectionRunId: run.id, externalRunId });
  }
}
