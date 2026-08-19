import type {
  ModelCapabilityView,
  ModelDetailView as CatalogModelDetailView,
} from "../../../lib/radar/catalog-read-model";
import type {
  ChangeEventRow,
  LatestPricingSnapshotRow,
} from "../../../lib/supabase";
import { DEFAULT_EXPLORER_FILTERS, observedBoolean } from "../../../lib/product/explorer";
import { provenanceFromSource } from "../../../lib/product/provenance";
import type {
  ModelCompareReadModel,
  ModelDetailReadModel,
  ModelExplorerCatalog,
  ModelExplorerRow,
} from "../../../lib/product/explorer";
import { available, unavailable } from "../../../lib/product/explorer";

export const NOW = new Date("2026-08-19T12:00:00.000Z");

export function capabilityView(
  overrides: Partial<ModelCapabilityView> = {},
): ModelCapabilityView {
  return {
    modelId: "m-sonnet",
    modelName: "claude-sonnet-4-5",
    displayName: "Claude Sonnet 4.5",
    provider: "Anthropic",
    providerSlug: "anthropic",
    isActive: true,
    lifecycleState: "active",
    apiModelId: "claude-sonnet-4-5",
    modelFamily: "Claude",
    modelStage: "ga",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsVision: true,
    supportsToolCalling: true,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    supportedFeatures: ["function_calling"],
    sourceUrl: "https://docs.anthropic.com/en/docs/models-overview",
    observedAt: "2026-08-19T09:00:00.000Z",
    ...overrides,
  };
}

export function pricingRow(
  overrides: Partial<LatestPricingSnapshotRow> = {},
): LatestPricingSnapshotRow {
  return {
    id: "price-1",
    run_id: "run-1",
    source_id: "src-pricing",
    provider_id: "p-anthropic",
    model_id: "m-sonnet",
    pricing_mode: "standard",
    context_tier: "standard",
    input_price_per_1m_tokens: 3,
    cached_input_price_per_1m_tokens: 0.3,
    cache_write_price_per_1m_tokens: null,
    output_price_per_1m_tokens: 15,
    currency: "USD",
    pricing_unit: "USD per 1M tokens",
    source_url: "https://www.anthropic.com/pricing",
    extra: {},
    raw: {},
    observed_at: "2026-08-19T09:00:00.000Z",
    created_at: "2026-08-19T09:00:00.000Z",
    content_hash: "hash",
    model_name: "claude-sonnet-4-5",
    provider_slug: "anthropic",
    provider_name: "Anthropic",
    ...overrides,
  };
}

export function changeEvent(overrides: Partial<ChangeEventRow> = {}): ChangeEventRow {
  return {
    id: "evt-1",
    provider_id: "p-anthropic",
    source_id: "src-pricing",
    run_id: "run-1",
    model_id: "m-sonnet",
    change_type: "price_decreased",
    field_name: "input_price_per_1m_tokens",
    pricing_mode: "standard",
    context_tier: "standard",
    old_value: 3.5,
    new_value: 3,
    previous_snapshot_id: "snap-old",
    current_snapshot_id: "snap-new",
    previous_lifecycle_snapshot_id: null,
    current_lifecycle_snapshot_id: null,
    summary: "Input price fell from $3.50 to $3.00.",
    detected_at: "2026-08-18T12:00:00.000Z",
    created_at: "2026-08-18T12:00:00.000Z",
    ...overrides,
  };
}

export function catalogDetail(
  model: ModelCapabilityView = capabilityView(),
  overrides: Partial<CatalogModelDetailView> = {},
): CatalogModelDetailView {
  return {
    model,
    pricing: [pricingRow({ model_id: model.modelId })],
    lifecycle: null,
    capabilityHistory: [],
    recentChangeEvents: [],
    ...overrides,
  };
}

export function explorerRow(
  overrides: Partial<ModelExplorerRow> = {},
): ModelExplorerRow {
  const identity = {
    canonicalId: "anthropic:claude-sonnet-4-5",
    modelId: "m-sonnet",
    providerSlug: "anthropic",
    providerName: "Anthropic",
    modelName: "claude-sonnet-4-5",
    displayName: "Claude Sonnet 4.5",
    apiModelId: "claude-sonnet-4-5",
    modelFamily: "Claude",
    modelStage: "ga",
    ...overrides.identity,
  };

  return {
    inputPrice: 3,
    outputPrice: 15,
    currency: "USD",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    vision: observedBoolean(true),
    toolCalling: observedBoolean(true),
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    lifecycle: {
      state: "active",
      label: "Active",
      isActive: true,
      deprecatedOn: null,
      retirementDate: null,
      retirementNotBefore: null,
    },
    freshness: {
      quality: "current",
      label: "Current",
      observedAt: "2026-08-19T09:00:00.000Z",
      description: "Observed within the last 48 hours.",
    },
    provenance: provenanceFromSource({
      sourceLabel: "Anthropic model catalog",
      sourceUrl: "https://docs.anthropic.com/en/docs/models-overview",
      sourceKind: "models",
      observedAt: "2026-08-19T09:00:00.000Z",
    }),
    ...overrides,
    identity: {
      ...identity,
      ...overrides.identity,
    },
  };
}

export function explorerCatalog(
  models: ModelExplorerRow[] = [explorerRow()],
  overrides: Partial<ModelExplorerCatalog> = {},
): ModelExplorerCatalog {
  return {
    models,
    providerOptions: [{ value: "anthropic", label: "Anthropic", count: models.length }],
    lifecycleOptions: [{ value: "active", label: "Active", count: models.length }],
    totalMatching: models.length,
    totalUnfiltered: models.length,
    generatedAt: NOW.toISOString(),
    isDemo: false,
    evidenceQuality: "current",
    evidenceNote: null,
    ...overrides,
  };
}

export function detailReadModel(
  overrides: Partial<ModelDetailReadModel> = {},
): ModelDetailReadModel {
  const row = explorerRow();
  return {
    identity: row.identity,
    pricing: available([
      {
        inputPerMillion: 3,
        outputPerMillion: 15,
        cachedInputPerMillion: 0.3,
        currency: "USD",
        unit: "USD per 1M tokens",
        pricingMode: "standard",
        contextTier: "standard",
        observedAt: "2026-08-19T09:00:00.000Z",
        sourceUrl: "https://www.anthropic.com/pricing",
      },
    ]),
    capabilities: available({
      vision: observedBoolean(true),
      toolCalling: observedBoolean(null),
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      supportedFeatures: ["function_calling"],
    }),
    limits: available({ contextWindow: 200000, maxOutputTokens: 8192 }),
    lifecycle: available(row.lifecycle),
    replacement: unavailable("No replacement has been observed for this model."),
    freshness: row.freshness,
    recentChanges: unavailable("No recent changes have been recorded for this model."),
    history: unavailable("No capability history has been recorded for this model."),
    provenance: row.provenance,
    isDemo: false,
    generatedAt: NOW.toISOString(),
    ...overrides,
  };
}

export function compareReadModel(
  columns: ModelCompareReadModel["columns"] = [],
  missingIds: string[] = [],
): ModelCompareReadModel {
  return {
    columns,
    missingIds,
    generatedAt: NOW.toISOString(),
    isDemo: false,
  };
}

export { DEFAULT_EXPLORER_FILTERS };
