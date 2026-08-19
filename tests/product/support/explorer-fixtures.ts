import { DEFAULT_EXPLORER_FILTERS, observedBoolean } from "../../../lib/product/explorer";
import { provenanceFromSource } from "../../../lib/product/provenance";
import type {
  ModelCompareColumn,
  ModelCompareReadModel,
  ModelDetailReadModel,
  ModelExplorerCatalog,
  ModelExplorerRow,
} from "../../../lib/product/explorer";
import { available, unavailable } from "../../../lib/product/explorer";

export const NOW = new Date("2026-08-19T12:00:00.000Z");

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
    pricingHistory: unavailable("No pricing history has been recorded for this model."),
    lifecycleHistory: unavailable("No lifecycle history has been recorded for this model."),
    apiModelIds: available(["claude-sonnet-4-5"]),
    provenance: row.provenance,
    provenanceByDomain: {
      pricing: row.provenance,
      capability: row.provenance,
      lifecycle: null,
    },
    isDemo: false,
    generatedAt: NOW.toISOString(),
    ...overrides,
  };
}

export function compareColumn(
  overrides: Partial<ModelCompareColumn> = {},
): ModelCompareColumn {
  const row = explorerRow();
  return {
    identity: row.identity,
    inputPrice: row.inputPrice,
    outputPrice: row.outputPrice,
    currency: row.currency,
    contextWindow: row.contextWindow,
    maxOutputTokens: row.maxOutputTokens,
    vision: row.vision,
    toolCalling: row.toolCalling,
    inputModalities: row.inputModalities,
    outputModalities: row.outputModalities,
    lifecycle: row.lifecycle,
    freshness: row.freshness,
    provenance: row.provenance,
    provenanceByDomain: {
      pricing: row.provenance,
      capability: row.provenance,
      lifecycle: null,
    },
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
