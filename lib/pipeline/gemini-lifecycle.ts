import {
  DEFAULT_GEMINI_LIFECYCLE_COLLECTOR_ID,
  DEFAULT_GEMINI_LIFECYCLE_SOURCE_URL,
  fetchGeminiLifecycle,
} from "../brightdata";
import { detectLifecycleChanges } from "../change-detection";
import {
  RawGeminiLifecycleRecordSchema,
  normalizeGeminiLifecycleRecord,
  type NormalizedLifecycleRecord,
} from "../contracts";
import { planGeminiModelMatches } from "../models/identity";
import type {
  ChangeEventInput,
  Json,
  LifecycleSnapshotInput,
  ModelAliasInput,
  ModelRow,
  ModelLifecycleProjectionInput,
} from "../supabase";
import type { SentinelRepository } from "../sentinel/repository";
import {
  PricingIngestionError,
  type OpenAiCollectorResult,
  type OpenAiPricingIngestionResult,
} from "./openai-pricing";
import { assertSentinelSafe, toSentinelSummary } from "./sentinel-gate";
import {
  createLifecycleRepository,
  lifecycleChangeSummary,
  lifecycleJsonCopy,
  lifecycleSnapshotToRecord,
  type LifecyclePipelineRepository,
} from "./anthropic-lifecycle";

export type GeminiLifecyclePipelineRepository = LifecyclePipelineRepository;

export interface IngestGeminiLifecycleOptions {
  repository?: GeminiLifecyclePipelineRepository;
  collect?: () => Promise<OpenAiCollectorResult>;
  now?: () => Date;
  triggeredBy?: string;
  collectorId?: string;
  sourceUrl?: string;
  /** Sentinel persistence for the inline health gate; the gate is not optional. */
  sentinelRepository?: SentinelRepository;
}

/**
 * Ingests Google's explicit row evidence. Missing rows and elapsed dates are
 * never interpreted. Only `is_shutdown` retires a model; an earliest-possible
 * shutdown date is a lower bound and never an exact retirement date.
 */
export async function ingestGeminiLifecycle(
  options: IngestGeminiLifecycleOptions = {},
): Promise<OpenAiPricingIngestionResult> {
  if (typeof window !== "undefined") {
    throw new Error("ingestGeminiLifecycle must only run on the server");
  }
  const repository = options.repository ?? createLifecycleRepository();
  const collectorId = (
    options.collectorId ??
    process.env.BRIGHTDATA_GEMINI_LIFECYCLE_COLLECTOR_ID ??
    DEFAULT_GEMINI_LIFECYCLE_COLLECTOR_ID
  ).trim();
  const sourceUrl = (
    options.sourceUrl ??
    process.env.GEMINI_LIFECYCLE_SOURCE_URL ??
    DEFAULT_GEMINI_LIFECYCLE_SOURCE_URL
  ).trim();
  const collect = options.collect ?? (() => fetchGeminiLifecycle({ collectorId, sourceUrl }));
  const startedAt = Date.now();
  const provider = await repository.upsertProvider({
    slug: "gemini",
    name: "Google",
    homepageUrl: "https://ai.google.dev",
  });
  const source = await repository.upsertSource({
    providerId: provider.id,
    sourceUrl,
    collectorId,
    label: "Google Gemini model lifecycle and deprecations",
  });

  const observedAt = (options.now ?? (() => new Date()))().toISOString();
  let collection: OpenAiCollectorResult;
  let collectorError: string | null = null;
  try {
    collection = await collect();
  } catch (error) {
    collectorError = error instanceof Error ? error.message : "Bright Data collection failed";
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

  const externalRunId = collection.metadata.runId;
  const run = await repository.startCollectionRun({
    sourceId: source.id,
    externalRunId,
    triggeredBy: options.triggeredBy ?? "manual-api",
  });
  if (!collection.success) {
    collectorError ??= collection.metadata.error ?? collection.error?.message ??
      "Bright Data collection failed";
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

  // Sentinel gate. A refused payload fails the run and throws here, so no
  // lifecycle snapshot, alias, change event or model lifecycle projection can
  // be written from a quarantined collection.
  const gate = await assertSentinelSafe({
    target: { domain: "lifecycle", providerSlug: "gemini" },
    source: {
      id: source.id,
      providerId: provider.id,
      collectorId,
      sourceUrl,
      label: "Google Gemini model lifecycle and deprecations",
    },
    rawRecords: collection.data,
    collectorError,
    observedAt,
    runId: run.id,
    externalRunId,
    repository: options.sentinelRepository,
    failRun: (message, details) =>
      repository.failCollectionRun(run.id, { message, details }, {
        recordsSeen: collection.data.length,
        recordsAccepted: 0,
        recordsRejected: collection.data.length,
      }),
  });

  const accepted: { normalized: NormalizedLifecycleRecord; raw: unknown }[] = [];
  const validationErrors: Json[] = [];
  const identities = new Set<string>();
  collection.data.forEach((raw, index) => {
    const parsed = RawGeminiLifecycleRecordSchema.safeParse(raw);
    if (!parsed.success || parsed.data.input.url !== sourceUrl) {
      validationErrors.push({
        index,
        issues: parsed.success
          ? [{ path: "input.url", message: "Unexpected lifecycle source URL" }]
          : parsed.error.issues.map((issue) => ({
              path: issue.path.map(String).join("."),
              message: issue.message,
            })),
      });
      return;
    }
    const normalized = normalizeGeminiLifecycleRecord(parsed.data, {
      observedAt,
      collectorId: collection.metadata.collectorId,
      externalRunId: externalRunId ?? null,
      collectionRunId: run.id,
    });
    if (identities.has(normalized.apiModelId)) {
      validationErrors.push({
        index,
        issues: [{ path: "model_id", message: "Duplicate API model ID" }],
      });
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
    const plans = planGeminiModelMatches(
      accepted.map(({ normalized }) => normalized.apiModelId),
      existingModels,
      aliases,
    );
    const createdModels = await repository.upsertModels(
      plans.filter((plan) => plan.createModelName !== null).map((plan) => ({
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
    }) satisfies ModelAliasInput));

    const previousRows = await repository.getComparableLifecycleSnapshots({
      providerSlug: "gemini",
      sourceId: source.id,
    });
    const previous = previousRows.map((row) => lifecycleSnapshotToRecord(row, "Google"));
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
        retirementNotBeforeObservation: normalized.retirementNotBeforeObservation,
        recommendedReplacement: normalized.recommendedReplacement,
        recommendedReplacementObserved: normalized.recommendedReplacementObserved,
        sourceMetadata: lifecycleJsonCopy(normalized.sourceMetadata),
        sourceUrl: normalized.provenance.sourceUrl,
        raw: lifecycleJsonCopy(raw),
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
      retirementNotBeforeObservation: record.retirementNotBeforeObservation,
      observedAt,
    }) satisfies ModelLifecycleProjectionInput));
    await repository.completeCollectionRun(run.id, counts, undefined, validationErrors);
    return {
      success: true,
      collectionRunId: run.id,
      externalRunId,
      acceptedCount: accepted.length,
      rejectedCount: validationErrors.length,
      changesDetected: changes.length,
      durationMs: Date.now() - startedAt,
      idempotent: false,
      sentinel: toSentinelSummary(gate),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lifecycle persistence failed";
    await repository.failCollectionRun(run.id, { message, details: validationErrors }, counts);
    throw new PricingIngestionError(message, { collectionRunId: run.id, externalRunId });
  }
}
