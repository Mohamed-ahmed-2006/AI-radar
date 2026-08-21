import {
  fetchCatalogCollector,
  type CollectorRunResult,
} from "../brightdata";
import { detectCapabilityChanges, type CapabilityChangeEvent } from "../change-detection";
import {
  type CatalogProviderSlug,
  type Modality,
  type NormalizedCatalogRecord,
} from "../contracts";

import { planCatalogModelMatches } from "../models/identity";
import {
  expandEnumeratedCatalogIdentities,
  resolveCatalogIdentities,
} from "../models/catalog-identity";
import {
  createSupabaseAdminClient,
  type CapabilitySnapshotInput,
  type CapabilitySnapshotRow,
  type ChangeEventInput,
  type CollectionRunRow,
  type Json,
  type LatestCapabilitySnapshotRow,
  type ModelAliasInput,
  type ModelAliasRow,
  type ModelRow,
  type ProviderInput,
  type ProviderRow,
  type RunCounts,
  type RunStatus,
  type SourceInput,
  type SourceRow,
  completeCollectionRun,
  failCollectionRun,
  getComparableCapabilitySnapshots,
  listModelAliases,
  listModels,
  saveCapabilitySnapshots,
  saveChangeEvents,
  startCollectionRun,
  upsertModel,
  upsertModelAliases,
  upsertProvider,
  upsertSource,
} from "../supabase";
import type { SentinelRepository } from "../sentinel/repository";
import {
  assertSentinelSafe,
  toSentinelSummary,
  type SentinelIngestionSummary,
} from "./sentinel-gate";
import { guardCollectionRun } from "./run-guard";
import {
  CATALOG_PROVIDERS,
  resolveCatalogProviderConfiguration,
  type CatalogProviderDefinition,
} from "./providers";

export interface CatalogPipelineRepository {
  upsertProvider(input: ProviderInput): Promise<ProviderRow>;
  upsertSource(input: SourceInput): Promise<SourceRow>;
  startCollectionRun(input: {
    sourceId: string;
    externalRunId?: string | null;
    triggeredBy?: string;
  }): Promise<CollectionRunRow>;
  completeCollectionRun(
    runId: string,
    counts: RunCounts,
    status?: Extract<RunStatus, "succeeded" | "partial">,
    validationErrors?: Json,
  ): Promise<CollectionRunRow>;
  failCollectionRun(
    runId: string,
    error: { message: string; details?: Json },
    counts?: Partial<RunCounts>,
  ): Promise<CollectionRunRow>;
  listModels(providerId: string): Promise<ModelRow[]>;
  listModelAliases(providerId: string): Promise<ModelAliasRow[]>;
  upsertModel(input: {
    providerId: string;
    modelName: string;
    displayName?: string | null;
    metadata?: Json;
    isActive?: boolean;
  }): Promise<ModelRow>;
  upsertModelAlias(input: ModelAliasInput): Promise<ModelAliasRow>;
  saveCapabilitySnapshots(
    inputs: readonly CapabilitySnapshotInput[],
  ): Promise<CapabilitySnapshotRow[]>;
  getComparableCapabilitySnapshots(options: {
    providerSlug?: string;
    sourceId?: string;
  }): Promise<LatestCapabilitySnapshotRow[]>;
  saveChangeEvents(inputs: readonly ChangeEventInput[]): Promise<unknown[]>;
}


export function createCatalogRepository(): CatalogPipelineRepository {
  const db = createSupabaseAdminClient();
  return {
    upsertProvider: (input) => upsertProvider(db, input),
    upsertSource: (input) => upsertSource(db, input),
    startCollectionRun: (input) =>
      startCollectionRun(db, {
        sourceId: input.sourceId,
        externalRunId: input.externalRunId ?? null,
        triggeredBy: input.triggeredBy ?? "manual-api",
      }),
    completeCollectionRun: (runId, counts, status, validationErrors) =>
      completeCollectionRun(db, runId, counts, status, validationErrors),
    failCollectionRun: (runId, error, counts) =>
      failCollectionRun(db, runId, error, counts),
    listModels: (providerId) => listModels(db, { providerId }),
    listModelAliases: (providerId) => listModelAliases(db, providerId),
    upsertModel: (input) => upsertModel(db, input),
    upsertModelAlias: async (input) => {
      const [alias] = await upsertModelAliases(db, [input]);
      return alias;
    },
    saveCapabilitySnapshots: (inputs) => saveCapabilitySnapshots(db, inputs),
    getComparableCapabilitySnapshots: (options) =>
      getComparableCapabilitySnapshots(db, options),
    saveChangeEvents: (inputs) => saveChangeEvents(db, inputs),
  };
}


export interface IngestCatalogOptions {
  repository?: CatalogPipelineRepository;
  collect?: () => Promise<CollectorRunResult<unknown>>;
  now?: () => Date;
  triggeredBy?: string;
  collectorId?: string;
  sourceUrl?: string;
  sentinelRepository?: SentinelRepository;
}

export interface CatalogIngestionResult {
  success: boolean;
  collectionRunId: string;
  externalRunId?: string | null;
  recordsSeen: number;
  recordsAccepted: number;
  recordsRejected: number;
  acceptedCount: number;
  rejectedCount: number;
  changesDetected: number;
  changeEvents: CapabilityChangeEvent[];
  sentinel: SentinelIngestionSummary;
  records?: NormalizedCatalogRecord[];
  durationMs?: number;
  idempotent?: boolean;
}



export function capabilitySnapshotToRecord(
  snapshot: LatestCapabilitySnapshotRow,
  providerSlug: CatalogProviderSlug,
): NormalizedCatalogRecord {
  return {
    provider: snapshot.provider_name as NormalizedCatalogRecord["provider"],
    providerSlug,
    apiModelId: snapshot.api_model_id,
    displayName: snapshot.display_name,
    modelFamily: snapshot.model_family,
    modelStage: snapshot.model_stage,
    contextWindow: snapshot.context_window,
    maxOutputTokens: snapshot.max_output_tokens,
    supportsVision: snapshot.supports_vision,
    supportsToolCalling: snapshot.supports_tool_calling,
    inputModalities: (snapshot.input_modalities ?? []) as Modality[],
    outputModalities: (snapshot.output_modalities ?? []) as Modality[],
    supportedFeatures: snapshot.supported_features ?? [],
    rawEvidence: (snapshot.raw ?? {}) as Record<string, unknown>,
    provenance: {
      collectorId: null,
      collectedAt: snapshot.observed_at,
      sourceUrl: snapshot.source_url,
    },
  };
}

function capabilityChangeSummary(event: CapabilityChangeEvent): string {
  const oldVal = event.oldValue === null ? "unobserved" : JSON.stringify(event.oldValue);
  const newVal = event.newValue === null ? "unobserved" : JSON.stringify(event.newValue);
  return `${event.provider} model ${event.apiModelId}: ${event.field} changed from ${oldVal} to ${newVal}`;
}

export async function ingestCatalogProvider(
  providerDef: CatalogProviderDefinition,
  options: IngestCatalogOptions = {},
): Promise<CatalogIngestionResult> {
  if (typeof window !== "undefined") {
    throw new Error("ingestCatalogProvider must only run on the server");
  }

  const repository = options.repository ?? createCatalogRepository();
  const config = resolveCatalogProviderConfiguration(providerDef);
  const collectorId = (options.collectorId ?? config.collectorId).trim();
  const sourceUrl = (options.sourceUrl ?? config.sourceUrl).trim();
  const collect =
    options.collect ??
    (() => fetchCatalogCollector({ collectorId, sourceUrl }));

  const provider = await repository.upsertProvider({
    slug: providerDef.slug,
    name: providerDef.name,
    homepageUrl: providerDef.homepageUrl,
  });

  const source = await repository.upsertSource({
    providerId: provider.id,
    sourceUrl,
    collectorId,
    kind: "models",
    label: providerDef.label,
  });

  const observedAt = (options.now ?? (() => new Date()))().toISOString();
  let collection: CollectorRunResult<unknown>;
  let collectorError: string | null = null;

  try {
    collection = await collect();
  } catch (error) {
    collectorError =
      error instanceof Error ? error.message : "Bright Data collection failed";
    collection = {
      success: false,
      data: [],
      metadata: {
        collectorId,
        startedAt: observedAt,
        completedAt: observedAt,
        durationMs: 0,
        resultCount: 0,
        status: "failed",
        error: collectorError,
      },
    };
  }

  const externalRunId = collection.metadata?.runId ?? null;
  const run = await repository.startCollectionRun({
    sourceId: source.id,
    externalRunId,
    triggeredBy: options.triggeredBy ?? "manual-api",
  });

  if (!collection.success) {
    collectorError ??=
      collection.metadata?.error ?? "Bright Data collection failed";
  }

  // If this external run was already processed and succeeded, return idempotently
  if (run.status === "succeeded" || run.status === "partial") {
    return {
      success: true,
      collectionRunId: run.id,
      externalRunId,
      recordsSeen: run.records_seen,
      recordsAccepted: run.records_accepted,
      recordsRejected: run.records_rejected,
      acceptedCount: run.records_accepted,
      rejectedCount: run.records_rejected,
      changesDetected: 0,
      changeEvents: [],

      sentinel: {
        status: "healthy",
        reasonCodes: [],
        recordsSeen: run.records_seen,
        recordsValid: run.records_accepted,
        recordsInvalid: run.records_rejected,
        summary: "External run replay: already persisted",
      },
    };
  }

  // Every write below happens against a run row that is already claiming to
  // be in flight. The guard is what makes that claim honest: if anything from
  // here on throws, the run is finalized as failed before the error escapes.
  return guardCollectionRun(
    run.id,
    (runId, error, counts) => repository.failCollectionRun(runId, error, counts),
    async () => {
    const rawRecords = Array.isArray(collection.data) ? collection.data : [];

    // Inline Sentinel gate: quarantines before any canonical persistence
    const decision = await assertSentinelSafe({
      target: { domain: "catalog", providerSlug: providerDef.slug },
      source: {
        id: source.id,
        providerId: provider.id,
        collectorId,
        sourceUrl,
        label: providerDef.label,
      },
      rawRecords,
      collectorError,
      observedAt,
      runId: run.id,
      externalRunId,
      repository: options.sentinelRepository,
      failRun: async (message, details) => {
        await repository.failCollectionRun(
          run.id,
          { message, details },
          {
            recordsSeen: rawRecords.length,
            recordsAccepted: 0,
            recordsRejected: rawRecords.length,
          },
        );
      },
    });

    const adaptedRecords: NormalizedCatalogRecord[] = [];
    const rejectedRecords: unknown[] = [];

    for (const raw of rawRecords) {
      try {
        const adapted = providerDef.adapt(
          raw,
          sourceUrl,
          collectorId,
          observedAt,
        );
        adaptedRecords.push(adapted);
      } catch {
        rejectedRecords.push(raw);
      }
    }

    // Records rejected before identity expansion; counted separately because
    // expansion changes how many records the run actually evaluated.
    const adaptRejectedCount = rejectedRecords.length;

    // Normalize identity before anything canonical is written: expand family
    // pages that enumerate several API model ids, then resolve collisions by
    // provenance instead of arrival order.
    const expandedRecords = expandEnumeratedCatalogIdentities(adaptedRecords);
    const { accepted: uniqueRecords, conflicts } = resolveCatalogIdentities(expandedRecords);
    for (const conflict of conflicts) {
      rejectedRecords.push({
        reason: conflict.reason,
        apiModelId: conflict.apiModelId,
        detail: conflict.detail,
        sourceUrl: conflict.record.provenance.sourceUrl,
        raw: conflict.record.rawEvidence,
      });
    }

    // Plan model identity matches against existing models & aliases
    const existingModels = await repository.listModels(provider.id);
    const existingAliases = await repository.listModelAliases(provider.id);

    const apiModelIds = uniqueRecords.map((r) => r.apiModelId);
    const matchPlan = planCatalogModelMatches(
      providerDef.slug,
      apiModelIds,
      existingModels,
      existingAliases,
      { onAmbiguity: "throw" },
    );

    const modelMap = new Map<string, ModelRow>();
    for (const plan of matchPlan) {
      if (plan.model) {
        modelMap.set(plan.apiModelId, plan.model);
      } else if (plan.createModelName) {
        // Create new model row (never modifies existing models)
        const created = await repository.upsertModel({
          providerId: provider.id,
          modelName: plan.createModelName,
          displayName: plan.createModelName,
          isActive: true,
        });
        modelMap.set(plan.apiModelId, created);
      }
    }

    // Ensure api_model_id alias exists for each model
    for (const record of uniqueRecords) {
      const model = modelMap.get(record.apiModelId);
      if (model) {
        await repository.upsertModelAlias({
          providerId: provider.id,
          modelId: model.id,
          sourceId: source.id,
          alias: record.apiModelId,
          aliasType: "api_model_id",
        });
      }
    }

    // Fetch prior comparable snapshots for change detection
    const previousSnapshots = await repository.getComparableCapabilitySnapshots({
      providerSlug: providerDef.slug,
      sourceId: source.id,
    });

    const previousRecords = previousSnapshots.map((s) =>
      capabilitySnapshotToRecord(s, providerDef.slug),
    );

    const changeEvents = detectCapabilityChanges(previousRecords, uniqueRecords);

    // Persist snapshots to capability_snapshots
    const snapshotInputs: CapabilitySnapshotInput[] = uniqueRecords.map((record) => {
      const model = modelMap.get(record.apiModelId)!;
      return {
        runId: run.id,
        sourceId: source.id,
        providerId: provider.id,
        modelId: model.id,
        apiModelId: record.apiModelId,
        displayName: record.displayName,
        modelFamily: record.modelFamily,
        modelStage: record.modelStage,
        contextWindow: record.contextWindow,
        maxOutputTokens: record.maxOutputTokens,
        supportsVision: record.supportsVision,
        supportsToolCalling: record.supportsToolCalling,
        inputModalities: record.inputModalities,
        outputModalities: record.outputModalities,
        supportedFeatures: record.supportedFeatures,
        sourceUrl,
        raw: record.rawEvidence as unknown as Json,
        observedAt,
      };
    });

    const savedSnapshots = await repository.saveCapabilitySnapshots(snapshotInputs);
    const snapshotByModelId = new Map(savedSnapshots.map((s) => [s.model_id, s]));

    // Save detected change events
    if (changeEvents.length > 0) {
      const changeEventInputs: ChangeEventInput[] = changeEvents.map((evt) => {
        const model = modelMap.get(evt.apiModelId);
        const snapshot = model ? snapshotByModelId.get(model.id) : null;
        return {
          providerId: provider.id,
          sourceId: source.id,
          runId: run.id,
          modelId: model ? model.id : null,
          changeType: "capability_changed",
          fieldName: evt.field,
          oldValue: evt.oldValue as unknown as Json,
          newValue: evt.newValue as unknown as Json,
          currentSnapshotId: snapshot ? snapshot.id : null,
          summary: capabilityChangeSummary(evt),
          detectedAt: observedAt,
        };
      });

      await repository.saveChangeEvents(changeEventInputs);
    }

    // Complete collection run
    // A family page can enumerate several API model ids, so identity expansion
    // yields more records than the collector returned rows. Counting the raw rows
    // here would report fewer records seen than were accepted and rejected, which
    // violates `collection_runs_counts_balance` and loses the whole run. What the
    // run actually evaluated is the expanded set plus whatever failed to adapt.
    const recordsSeen = expandedRecords.length + adaptRejectedCount;
    const recordsAccepted = uniqueRecords.length;
    const recordsRejected = rejectedRecords.length;
    const status: Extract<RunStatus, "succeeded" | "partial"> =
      recordsRejected > 0 ? "partial" : "succeeded";

    await repository.completeCollectionRun(
      run.id,
      { recordsSeen, recordsAccepted, recordsRejected },
      status,
      rejectedRecords as unknown as Json,
    );

    return {
      success: true,
      collectionRunId: run.id,
      externalRunId,
      recordsSeen,
      recordsAccepted,
      recordsRejected,
      acceptedCount: recordsAccepted,
      rejectedCount: recordsRejected,
      changesDetected: changeEvents.length,
      changeEvents,
      sentinel: toSentinelSummary(decision),
      records: uniqueRecords,
    };
    },
  );
}

/**
 * Ingests all four catalog providers sequentially.
 */
export async function ingestAllCatalog(
  options: IngestCatalogOptions = {},
): Promise<Record<CatalogProviderSlug, CatalogIngestionResult>> {
  const results = {} as Record<CatalogProviderSlug, CatalogIngestionResult>;
  for (const slug of ["openai", "anthropic", "gemini", "xai"] as const) {
    const providerDef = CATALOG_PROVIDERS[slug];
    results[slug] = await ingestCatalogProvider(providerDef, options);
  }
  return results;
}
