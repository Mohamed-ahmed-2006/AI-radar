import { fetchOpenAIPricing } from "../brightdata";
import { detectPricingChanges } from "../change-detection";
import {
  NormalizedPricingRecordSchema,
  RawBrightDataPricingRecordSchema,
  normalizeBrightDataPricingRecord,
  pricingRecordIdentity,
  type ChangeEvent,
  type NormalizedPricingRecord,
} from "../contracts";
import {
  completeCollectionRun,
  createSupabaseAdminClient,
  failCollectionRun,
  getLatestPricingSnapshots,
  listModels,
  saveChangeEvents,
  savePricingSnapshots,
  startCollectionRun,
  upsertModels,
  upsertProvider,
  upsertSource,
  type ChangeEventInput,
  type CollectionRunRow,
  type Json,
  type LatestPricingSnapshotRow,
  type ModelRow,
  type PricingSnapshotInput,
  type ProviderRow,
  type SourceRow,
} from "../supabase";

const OPENAI_PROVIDER = {
  slug: "openai",
  name: "OpenAI",
  homepageUrl: "https://openai.com",
} as const;

export interface OpenAiCollectorResult {
  success: boolean;
  data: unknown[];
  metadata: {
    collectorId: string;
    runId?: string;
    startedAt: string;
    completedAt: string;
    durationMs: number;
    resultCount: number;
    status: "success" | "failed" | "timeout";
    error?: string;
  };
  error?: Error;
}

export interface OpenAiPricingPipelineRepository {
  upsertProvider(input: {
    slug: string;
    name: string;
    homepageUrl?: string | null;
  }): Promise<ProviderRow>;
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
  ): Promise<CollectionRunRow>;
  upsertModels(input: readonly {
    providerId: string;
    modelName: string;
    seenAt: string;
  }[]): Promise<ModelRow[]>;
  listModels(options: { providerId: string }): Promise<ModelRow[]>;
  getLatestPricingSnapshots(options: {
    providerSlug: string;
    sourceId: string;
  }): Promise<LatestPricingSnapshotRow[]>;
  savePricingSnapshots(input: readonly PricingSnapshotInput[]): Promise<{
    id: string;
    model_id: string;
    pricing_mode: string;
    context_tier: string;
  }[]>;
  saveChangeEvents(input: readonly ChangeEventInput[]): Promise<unknown[]>;
}

function createRepository(): OpenAiPricingPipelineRepository {
  const db = createSupabaseAdminClient();
  return {
    upsertProvider: (input) => upsertProvider(db, input),
    upsertSource: (input) => upsertSource(db, { ...input, kind: "pricing" }),
    startCollectionRun: (input) => startCollectionRun(db, input),
    failCollectionRun: (runId, error, counts) =>
      failCollectionRun(db, runId, error, counts),
    completeCollectionRun: (runId, counts) => completeCollectionRun(db, runId, counts),
    upsertModels: (input) => upsertModels(db, input),
    listModels: (options) => listModels(db, options),
    getLatestPricingSnapshots: (options) => getLatestPricingSnapshots(db, options),
    savePricingSnapshots: (input) => savePricingSnapshots(db, input),
    saveChangeEvents: (input) => saveChangeEvents(db, input),
  };
}

function snapshotToRecord(row: LatestPricingSnapshotRow): NormalizedPricingRecord {
  return NormalizedPricingRecordSchema.parse({
    provider: row.provider_name,
    modelName: row.model_name,
    pricingMode: row.pricing_mode,
    contextTier: row.context_tier,
    inputPricePer1MTokens: row.input_price_per_1m_tokens,
    cachedInputPricePer1MTokens: row.cached_input_price_per_1m_tokens,
    cacheWritePricePer1MTokens: row.cache_write_price_per_1m_tokens,
    outputPricePer1MTokens: row.output_price_per_1m_tokens,
    pricingUnit: row.pricing_unit,
    provenance: {
      sourceUrl: row.source_url ?? "https://developers.openai.com/api/docs/pricing",
      collectorId: null,
      collectedAt: row.observed_at,
    },
  });
}

function changeSummary(change: ChangeEvent): string {
  const identity = `${change.modelName} (${change.contextTier})`;
  if (change.type === "model_added") return `Pricing identity added: ${identity}`;
  if (change.type === "model_removed") return `Pricing identity removed: ${identity}`;
  if (change.type === "metadata_changed") return `${identity} metadata changed: ${change.field}`;
  return `${identity} ${change.field} ${change.type === "price_increased" ? "increased" : "decreased"}`;
}

function eventValue(change: ChangeEvent): Json {
  if (change.type === "model_added" || change.type === "model_removed") {
    return {
      pricingMode: change.record.pricingMode,
      contextTier: change.record.contextTier,
      inputPricePer1MTokens: change.record.inputPricePer1MTokens,
      outputPricePer1MTokens: change.record.outputPricePer1MTokens,
    };
  }
  return "newValue" in change ? change.newValue : null;
}

export class OpenAiPricingIngestionError extends Error {
  readonly collectionRunId?: string;
  readonly externalRunId?: string;

  constructor(message: string, ids: { collectionRunId?: string; externalRunId?: string } = {}) {
    super(message);
    this.name = "OpenAiPricingIngestionError";
    this.collectionRunId = ids.collectionRunId;
    this.externalRunId = ids.externalRunId;
  }
}

export interface IngestOpenAiPricingOptions {
  repository?: OpenAiPricingPipelineRepository;
  collect?: () => Promise<OpenAiCollectorResult>;
  now?: () => Date;
  triggeredBy?: string;
}

export interface OpenAiPricingIngestionResult {
  success: true;
  collectionRunId: string;
  externalRunId?: string;
  acceptedCount: number;
  rejectedCount: number;
  changesDetected: number;
  durationMs: number;
  idempotent: boolean;
}

/**
 * End-to-end, server-only OpenAI pricing ingestion.
 *
 * A missing record is a pricing-domain removal only. This source is not an
 * authoritative model inventory, so this workflow must never deactivate a
 * row in `models` for collector absence.
 */
export async function ingestOpenAiPricing(
  options: IngestOpenAiPricingOptions = {},
): Promise<OpenAiPricingIngestionResult> {
  if (typeof window !== "undefined") {
    throw new Error("ingestOpenAiPricing must only run on the server");
  }
  const repository = options.repository ?? createRepository();
  const collect = options.collect ?? (() => fetchOpenAIPricing());
  const startedAt = Date.now();
  const provider = await repository.upsertProvider(OPENAI_PROVIDER);
  const sourceUrl = process.env.OPENAI_PRICING_SOURCE_URL ??
    "https://developers.openai.com/api/docs/pricing";
  const collectorId = process.env.BRIGHTDATA_OPENAI_COLLECTOR_ID ??
    "c_msx3bqlyjtv2qustx";
  const source = await repository.upsertSource({
    providerId: provider.id,
    sourceUrl,
    collectorId,
    label: "OpenAI pricing page",
  });

  let collection: OpenAiCollectorResult;
  try {
    collection = await collect();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bright Data collection failed";
    const failedRun = await repository.startCollectionRun({
      sourceId: source.id,
      triggeredBy: options.triggeredBy ?? "manual-api",
    });
    await repository.failCollectionRun(failedRun.id, { message }, {
      recordsSeen: 0,
      recordsAccepted: 0,
      recordsRejected: 0,
    });
    throw new OpenAiPricingIngestionError(message, { collectionRunId: failedRun.id });
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
    throw new OpenAiPricingIngestionError(message, {
      collectionRunId: run.id,
      externalRunId,
    });
  }

  if (run.status !== "running") {
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
  const accepted: NormalizedPricingRecord[] = [];
  const identities = new Set<string>();
  let rejectedCount = 0;

  for (const raw of collection.data) {
    const parsed = RawBrightDataPricingRecordSchema.safeParse(raw);
    if (!parsed.success || parsed.data.provider !== OPENAI_PROVIDER.name) {
      rejectedCount += 1;
      continue;
    }
    const normalized = normalizeBrightDataPricingRecord(parsed.data, {
      collectorId: collection.metadata.collectorId,
      collectedAt: observedAt,
    });
    const identity = pricingRecordIdentity(normalized);
    if (identities.has(identity)) {
      rejectedCount += 1;
      continue;
    }
    identities.add(identity);
    accepted.push(normalized);
  }

  const counts = {
    recordsSeen: collection.data.length,
    recordsAccepted: accepted.length,
    recordsRejected: rejectedCount,
  };

  try {
    const models = await repository.upsertModels(
      [...new Set(accepted.map((record) => record.modelName))].map((modelName) => ({
        providerId: provider.id,
        modelName,
        seenAt: observedAt,
      })),
    );
    const knownModels = await repository.listModels({ providerId: provider.id });
    const modelsByName = new Map([...knownModels, ...models].map((model) => [model.model_name, model]));
    const previousRows = await repository.getLatestPricingSnapshots({
      providerSlug: OPENAI_PROVIDER.slug,
      sourceId: source.id,
    });
    const previous = previousRows.map(snapshotToRecord);
    const changes = detectPricingChanges(previous, accepted);

    const snapshots = await repository.savePricingSnapshots(accepted.map((record) => {
      const model = modelsByName.get(record.modelName);
      if (!model) throw new Error(`Model ${record.modelName} was not returned by persistence`);
      return {
        runId: run.id,
        sourceId: source.id,
        providerId: provider.id,
        modelId: model.id,
        pricingMode: record.pricingMode,
        contextTier: record.contextTier,
        inputPricePer1mTokens: record.inputPricePer1MTokens,
        cachedInputPricePer1mTokens: record.cachedInputPricePer1MTokens,
        cacheWritePricePer1mTokens: record.cacheWritePricePer1MTokens,
        outputPricePer1mTokens: record.outputPricePer1MTokens,
        pricingUnit: record.pricingUnit,
        sourceUrl: record.provenance.sourceUrl,
        observedAt,
      } satisfies PricingSnapshotInput;
    }));
    const snapshotByIdentity = new Map(snapshots.map((snapshot) => [
      JSON.stringify([snapshot.model_id, snapshot.pricing_mode, snapshot.context_tier]),
      snapshot.id,
    ]));
    const previousSnapshotByIdentity = new Map(previousRows.map((row) => [
      pricingRecordIdentity(snapshotToRecord(row)),
      row.id,
    ]));

    await repository.saveChangeEvents(changes.map((change) => {
      const model = modelsByName.get(change.modelName);
      if (!model) throw new Error(`Model ${change.modelName} was not found for change event`);
      const snapshotKey = JSON.stringify([model.id, change.pricingMode, change.contextTier]);
      const currentSnapshotId = snapshotByIdentity.get(snapshotKey) ?? null;
      return {
        providerId: provider.id,
        sourceId: source.id,
        runId: run.id,
        modelId: model.id,
        changeType: change.type,
        fieldName: "field" in change ? change.field : null,
        oldValue: change.type === "model_removed" ? eventValue(change) :
          ("oldValue" in change ? change.oldValue : null),
        newValue: change.type === "model_added" ? eventValue(change) :
          ("newValue" in change ? eventValue(change) : null),
        previousSnapshotId: previousSnapshotByIdentity.get(pricingRecordIdentity(change)) ?? null,
        currentSnapshotId,
        summary: changeSummary(change),
        detectedAt: observedAt,
      } satisfies ChangeEventInput;
    }));

    await repository.completeCollectionRun(run.id, counts);
    return {
      success: true,
      collectionRunId: run.id,
      externalRunId,
      acceptedCount: accepted.length,
      rejectedCount,
      changesDetected: changes.length,
      durationMs: Date.now() - startedAt,
      idempotent: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pricing persistence failed";
    await repository.failCollectionRun(run.id, { message }, counts);
    throw new OpenAiPricingIngestionError(message, {
      collectionRunId: run.id,
      externalRunId,
    });
  }
}
