/**
 * Catalog-backed Model Explorer adapter.
 *
 * This is the stopgap implementation of `ModelExplorerAdapter`. It projects
 * the current capability/pricing/lifecycle read model
 * (`lib/radar/catalog-read-model`) into the explorer seam. When the richer
 * Explorer/Compare read model lands, replace this adapter — do not redesign
 * the screens.
 *
 * Filter matching that the current catalog read model already understands
 * (provider, vision, tools, min context) is passed through. Price, lifecycle
 * and active-only matching stay here because that backend does not accept
 * those controls yet. The UI never duplicates either set of rules.
 */

import {
  getCanonicalModelsWithCapabilities,
  getModelDetailWithCapabilities,
  type ModelCapabilityFilters,
  type ModelCapabilityView,
  type ModelDetailView as CatalogModelDetailView,
} from "../radar/catalog-read-model";
import {
  createSupabaseServerClient,
  getLatestPricingSnapshots,
  getSourceHealth,
  type ChangeEventRow,
  type Json,
  type LatestLifecycleSnapshotRow,
  type LatestPricingSnapshotRow,
  type SourceHealthRow,
  type SupabaseServerClient,
} from "../supabase";
import { isSupabaseReadConfigured } from "../supabase/env";
import { provenanceFromSource, type ProvenanceView } from "./provenance";
import {
  available,
  formatChangeType,
  DEFAULT_EXPLORER_FILTERS,
  evidenceQualityLabel,
  explorerCanonicalId,
  lifecycleLabel,
  observedBoolean,
  registerDefaultModelExplorerAdapter,
  unavailable,
  type CapabilityHistoryItem,
  type EvidenceQuality,
  type ExplorerFilterOption,
  type ExplorerFilters,
  type FreshnessView,
  type ModelChangeItem,
  type ModelCompareColumn,
  type ModelCompareReadModel,
  type ModelDetailReadModel,
  type ModelExplorerAdapter,
  type ModelExplorerCapabilities,
  type ModelExplorerCatalog,
  type ModelExplorerRow,
  type ModelIdentityView,
  type ModelLifecycleView,
  type ModelPriceView,
  type ObservedBoolean,
} from "./explorer";

export const CATALOG_EXPLORER_ADAPTER_ID = "catalog-explorer-v1";

export const CATALOG_EXPLORER_CAPABILITIES: ModelExplorerCapabilities = {
  catalog: true,
  detail: true,
  compare: true,
  history: true,
  replacement: true,
  recentChanges: true,
};

/** Presentation heuristic only: the catalog does not publish an expected interval. */
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

const PREFERRED_TIERS = ["standard", "short", "default"] as const;

export interface CatalogExplorerDeps {
  listCapabilities: (filters?: ModelCapabilityFilters) => Promise<ModelCapabilityView[]>;
  listPricing: (modelIds?: readonly string[]) => Promise<LatestPricingSnapshotRow[]>;
  getDetail: (modelId: string) => Promise<CatalogModelDetailView | null>;
  listSourceHealth?: () => Promise<SourceHealthRow[]>;
  now?: () => Date;
  configured?: boolean;
}

function defaultDeps(client?: SupabaseServerClient): CatalogExplorerDeps {
  const db = () => client ?? createSupabaseServerClient();
  return {
    listCapabilities: (filters) =>
      getCanonicalModelsWithCapabilities({ client: db(), filters }),
    listPricing: (modelIds) =>
      getLatestPricingSnapshots(db(), modelIds?.length ? { modelIds } : {}),
    getDetail: (modelId) => getModelDetailWithCapabilities(modelId, db()),
    listSourceHealth: () => getSourceHealth(db()),
    now: () => new Date(),
    configured: isSupabaseReadConfigured(),
  };
}

export function jsonToDisplay(value: Json | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function pickComparablePricing(
  rows: readonly LatestPricingSnapshotRow[],
): LatestPricingSnapshotRow | null {
  if (rows.length === 0) return null;
  for (const tier of PREFERRED_TIERS) {
    const match = rows.find((row) => row.context_tier === tier);
    if (match) return match;
  }
  return rows[0] ?? null;
}

export function projectPrice(row: LatestPricingSnapshotRow): ModelPriceView {
  return {
    inputPerMillion: row.input_price_per_1m_tokens,
    outputPerMillion: row.output_price_per_1m_tokens,
    cachedInputPerMillion: row.cached_input_price_per_1m_tokens,
    currency: row.currency ?? "USD",
    unit: row.pricing_unit ?? null,
    pricingMode: row.pricing_mode ?? null,
    contextTier: row.context_tier ?? null,
    observedAt: row.observed_at,
    sourceUrl: row.source_url,
  };
}

export function projectIdentity(model: ModelCapabilityView): ModelIdentityView {
  return {
    canonicalId: explorerCanonicalId({
      providerSlug: model.providerSlug,
      apiModelId: model.apiModelId,
      modelId: model.modelId,
    }),
    modelId: model.modelId,
    providerSlug: model.providerSlug,
    providerName: model.provider,
    modelName: model.modelName,
    displayName: model.displayName ?? model.modelName,
    apiModelId: model.apiModelId,
    modelFamily: model.modelFamily,
    modelStage: model.modelStage,
  };
}

export function projectLifecycle(
  model: ModelCapabilityView,
  snapshot: LatestLifecycleSnapshotRow | null,
): ModelLifecycleView {
  const state = snapshot?.projected_lifecycle_state ?? model.lifecycleState ?? null;
  return {
    state,
    label: lifecycleLabel(state),
    isActive: model.isActive,
    deprecatedOn: snapshot?.deprecated_on ?? null,
    retirementDate: snapshot?.retirement_date ?? null,
    retirementNotBefore: snapshot?.retirement_not_before_date ?? null,
  };
}

export function freshnessFromObservation(
  observedAt: string | null,
  now: Date,
  sourceDegraded: boolean,
): FreshnessView {
  if (sourceDegraded) {
    return {
      quality: "degraded",
      label: evidenceQualityLabel("degraded"),
      observedAt,
      description: observedAt
        ? "Collection is degraded; this observation may not be current."
        : "Collection is degraded and no observation time is available.",
    };
  }
  if (!observedAt) {
    return {
      quality: "unknown",
      label: evidenceQualityLabel("unknown"),
      observedAt: null,
      description: "No observation time has been recorded for this model.",
    };
  }
  const observedMs = Date.parse(observedAt);
  if (!Number.isFinite(observedMs)) {
    return {
      quality: "unknown",
      label: evidenceQualityLabel("unknown"),
      observedAt,
      description: "The observation timestamp could not be read.",
    };
  }
  const ageMs = now.getTime() - observedMs;
  const quality: EvidenceQuality = ageMs > STALE_AFTER_MS ? "stale" : "current";
  return {
    quality,
    label: evidenceQualityLabel(quality),
    observedAt,
    description:
      quality === "stale"
        ? "This observation is more than 48 hours old."
        : "Observed within the last 48 hours.",
  };
}

export function projectModelProvenance(
  model: ModelCapabilityView,
  price: LatestPricingSnapshotRow | null,
): ProvenanceView {
  return provenanceFromSource({
    sourceLabel: `${model.provider} model catalog`,
    sourceUrl: model.sourceUrl ?? price?.source_url ?? null,
    sourceKind: "models",
    observedAt: model.observedAt ?? price?.observed_at ?? null,
  });
}

export function catalogFiltersFromExplorer(
  filters: ExplorerFilters,
): ModelCapabilityFilters {
  const catalog: ModelCapabilityFilters = {};
  if (filters.provider) catalog.providerSlug = filters.provider;
  if (filters.visionRequired) catalog.supportsVision = true;
  if (filters.toolCallingRequired) catalog.supportsToolCalling = true;
  if (filters.minContext !== null) catalog.minContextWindow = filters.minContext;
  return catalog;
}

/**
 * Remaining presentation filters the current catalog read model does not
 * accept. Price ceilings skip rows whose price was not observed — we cannot
 * prove an unknown price is under a maximum.
 */
export function matchesRemainingExplorerFilters(
  row: Pick<ModelExplorerRow, "inputPrice" | "outputPrice" | "lifecycle">,
  filters: ExplorerFilters,
): boolean {
  if (filters.maxInputPrice !== null) {
    if (row.inputPrice === null || row.inputPrice > filters.maxInputPrice) return false;
  }
  if (filters.maxOutputPrice !== null) {
    if (row.outputPrice === null || row.outputPrice > filters.maxOutputPrice) return false;
  }
  if (filters.activeOnly && row.lifecycle.isActive !== true) return false;
  if (filters.lifecycleState && row.lifecycle.state !== filters.lifecycleState) {
    return false;
  }
  return true;
}

function countBy(
  rows: readonly ModelExplorerRow[],
  keyOf: (row: ModelExplorerRow) => string | null,
  labelOf: (key: string, row: ModelExplorerRow) => string,
): ExplorerFilterOption[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { label: labelOf(key, row), count: 1 });
  }
  return [...counts.entries()]
    .map(([value, entry]) => ({ value, label: entry.label, count: entry.count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function latestObservedAt(
  model: ModelCapabilityView,
  price: LatestPricingSnapshotRow | null,
  lifecycle: LatestLifecycleSnapshotRow | null,
): string | null {
  const stamps = [model.observedAt, price?.observed_at, lifecycle?.observed_at].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (stamps.length === 0) return null;
  return stamps.sort().at(-1) ?? null;
}

function catalogDegraded(health: readonly SourceHealthRow[]): boolean {
  return health.some(
    (row) =>
      (row.kind === "models" || row.kind === "pricing") &&
      (row.last_run_status === "failed" || row.last_run_status === "partial"),
  );
}

function catalogEvidence(
  rows: readonly ModelExplorerRow[],
  degraded: boolean,
): { quality: EvidenceQuality; note: string | null } {
  if (degraded) {
    return {
      quality: "degraded",
      note: "One or more catalog or pricing sources last completed in a degraded or failed state. Values below are last-known observations.",
    };
  }
  if (rows.length === 0) {
    return { quality: "unknown", note: null };
  }
  const qualities = rows.map((row) => row.freshness.quality);
  if (qualities.every((quality) => quality === "unknown")) {
    return {
      quality: "unknown",
      note: "Observation times have not been recorded for the models in this catalog.",
    };
  }
  if (
    qualities.some((quality) => quality === "stale") &&
    !qualities.some((quality) => quality === "current")
  ) {
    return {
      quality: "stale",
      note: "Every model below was last observed more than 48 hours ago.",
    };
  }
  if (qualities.some((quality) => quality === "stale")) {
    return {
      quality: "stale",
      note: "Some models below were last observed more than 48 hours ago.",
    };
  }
  return { quality: "current", note: null };
}

export function projectExplorerRow(input: {
  model: ModelCapabilityView;
  pricing: readonly LatestPricingSnapshotRow[];
  lifecycle: LatestLifecycleSnapshotRow | null;
  now: Date;
  sourceDegraded: boolean;
}): ModelExplorerRow {
  const comparable = pickComparablePricing(input.pricing);
  const observedAt = latestObservedAt(input.model, comparable, input.lifecycle);
  return {
    identity: projectIdentity(input.model),
    inputPrice: comparable?.input_price_per_1m_tokens ?? null,
    outputPrice: comparable?.output_price_per_1m_tokens ?? null,
    currency: comparable?.currency ?? null,
    contextWindow: input.model.contextWindow,
    maxOutputTokens: input.model.maxOutputTokens,
    vision: observedBoolean(input.model.supportsVision),
    toolCalling: observedBoolean(input.model.supportsToolCalling),
    inputModalities: input.model.inputModalities,
    outputModalities: input.model.outputModalities,
    lifecycle: projectLifecycle(input.model, input.lifecycle),
    freshness: freshnessFromObservation(observedAt, input.now, input.sourceDegraded),
    provenance: projectModelProvenance(input.model, comparable),
  };
}

function projectChangeEvent(event: ChangeEventRow): ModelChangeItem {
  return {
    id: event.id,
    changeType: event.change_type,
    changeTypeLabel: formatChangeType(event.change_type),
    summary: event.summary,
    field: event.field_name,
    observedAt: event.detected_at,
    before: jsonToDisplay(event.old_value),
    after: jsonToDisplay(event.new_value),
  };
}

function lookupCanonical(
  rows: readonly ModelExplorerRow[],
  canonicalId: string,
): ModelExplorerRow | undefined {
  const target = canonicalId.trim().toLowerCase();
  return rows.find((row) => row.identity.canonicalId.toLowerCase() === target);
}

function emptyCatalog(generatedAt: string, note: string | null): ModelExplorerCatalog {
  return {
    models: [],
    providerOptions: [],
    lifecycleOptions: [],
    totalMatching: 0,
    totalUnfiltered: 0,
    generatedAt,
    isDemo: false,
    evidenceQuality: "unknown",
    evidenceNote: note,
  };
}

function toCompareColumn(row: ModelExplorerRow): ModelCompareColumn {
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
  };
}

export function createCatalogExplorerAdapter(
  deps: CatalogExplorerDeps = defaultDeps(),
): ModelExplorerAdapter {
  const clock = () => deps.now?.() ?? new Date();

  async function loadRows(explorerFilters: ExplorerFilters): Promise<{
    filtered: ModelExplorerRow[];
    unfiltered: ModelExplorerRow[];
    generatedAt: string;
    sourceDegraded: boolean;
  }> {
    const generatedAt = clock().toISOString();
    const catalogFilters = catalogFiltersFromExplorer(explorerFilters);

    const [unfilteredModels, pricing, health] = await Promise.all([
      deps.listCapabilities(),
      deps.listPricing(),
      deps.listSourceHealth ? deps.listSourceHealth() : Promise.resolve([]),
    ]);

    const sourceDegraded = catalogDegraded(health);
    const pricingByModel = new Map<string, LatestPricingSnapshotRow[]>();
    for (const row of pricing) {
      const list = pricingByModel.get(row.model_id) ?? [];
      list.push(row);
      pricingByModel.set(row.model_id, list);
    }

    const project = (model: ModelCapabilityView) =>
      projectExplorerRow({
        model,
        pricing: pricingByModel.get(model.modelId) ?? [],
        lifecycle: null,
        now: clock(),
        sourceDegraded,
      });

    const unfiltered = unfilteredModels.map(project);
    const matchingCatalog =
      Object.keys(catalogFilters).length === 0
        ? unfilteredModels
        : await deps.listCapabilities(catalogFilters);

    const filtered = matchingCatalog
      .map(project)
      .filter((row) => matchesRemainingExplorerFilters(row, explorerFilters));

    return { filtered, unfiltered, generatedAt, sourceDegraded };
  }

  return {
    id: CATALOG_EXPLORER_ADAPTER_ID,
    label: "Catalog capability read model",
    capabilities: CATALOG_EXPLORER_CAPABILITIES,

    async listModels(
      filters: ExplorerFilters = DEFAULT_EXPLORER_FILTERS,
    ): Promise<ModelExplorerCatalog> {
      if (deps.configured === false) {
        return emptyCatalog(
          clock().toISOString(),
          "Live catalog is not configured in this environment.",
        );
      }

      const { filtered, unfiltered, generatedAt, sourceDegraded } =
        await loadRows(filters);
      const evidence = catalogEvidence(filtered, sourceDegraded);

      return {
        models: filtered,
        providerOptions: countBy(
          unfiltered,
          (row) => row.identity.providerSlug,
          (_key, row) => row.identity.providerName,
        ),
        lifecycleOptions: countBy(
          unfiltered,
          (row) => row.lifecycle.state,
          (key) => lifecycleLabel(key),
        ),
        totalMatching: filtered.length,
        totalUnfiltered: unfiltered.length,
        generatedAt,
        isDemo: false,
        evidenceQuality: evidence.quality,
        evidenceNote: evidence.note,
      };
    },

    async getModelDetail(canonicalId: string): Promise<ModelDetailReadModel | null> {
      if (deps.configured === false) return null;

      const { unfiltered, generatedAt, sourceDegraded } = await loadRows(
        DEFAULT_EXPLORER_FILTERS,
      );
      const row = lookupCanonical(unfiltered, canonicalId);
      if (!row) return null;

      const detail = await deps.getDetail(row.identity.modelId);
      if (!detail) return null;

      const identity = projectIdentity(detail.model);
      const lifecycle = projectLifecycle(detail.model, detail.lifecycle);
      const comparable = pickComparablePricing(detail.pricing);
      const observedAt = latestObservedAt(detail.model, comparable, detail.lifecycle);
      const prices = detail.pricing.map(projectPrice);
      const vision: ObservedBoolean = observedBoolean(detail.model.supportsVision);
      const toolCalling: ObservedBoolean = observedBoolean(
        detail.model.supportsToolCalling,
      );

      const hasLimits =
        detail.model.contextWindow !== null || detail.model.maxOutputTokens !== null;
      const hasLifecycle = lifecycle.state !== null || detail.lifecycle !== null;
      const replacementObserved =
        detail.lifecycle?.recommended_replacement_observed === true &&
        Boolean(
          detail.lifecycle.recommended_replacement ||
            detail.lifecycle.recommended_replacement_model_id,
        );

      const history: CapabilityHistoryItem[] = detail.capabilityHistory.map(
        (snapshot) => ({
          observedAt: snapshot.observed_at,
          contextWindow: snapshot.context_window,
          maxOutputTokens: snapshot.max_output_tokens,
          vision: observedBoolean(snapshot.supports_vision),
          toolCalling: observedBoolean(snapshot.supports_tool_calling),
          sourceUrl: snapshot.source_url,
        }),
      );

      const changes = detail.recentChangeEvents.map(projectChangeEvent);

      return {
        identity,
        pricing:
          prices.length > 0
            ? available(prices)
            : unavailable("No pricing observation has been recorded for this model."),
        capabilities: available({
          vision,
          toolCalling,
          inputModalities: detail.model.inputModalities,
          outputModalities: detail.model.outputModalities,
          supportedFeatures: detail.model.supportedFeatures,
        }),
        limits: hasLimits
          ? available({
              contextWindow: detail.model.contextWindow,
              maxOutputTokens: detail.model.maxOutputTokens,
            })
          : unavailable("Context and output limits have not been observed for this model."),
        lifecycle: hasLifecycle
          ? available(lifecycle)
          : unavailable("Lifecycle state has not been observed for this model."),
        replacement: replacementObserved
          ? available({
              replacement: detail.lifecycle?.recommended_replacement ?? null,
              replacementModelId:
                detail.lifecycle?.recommended_replacement_model_id ?? null,
              observed: true,
            })
          : unavailable("No replacement has been observed for this model."),
        freshness: freshnessFromObservation(observedAt, clock(), sourceDegraded),
        recentChanges:
          changes.length > 0
            ? available(changes)
            : unavailable("No recent changes have been recorded for this model."),
        history:
          history.length > 0
            ? available(history)
            : unavailable("No capability history has been recorded for this model."),
        provenance: projectModelProvenance(detail.model, comparable),
        isDemo: false,
        generatedAt,
      };
    },

    async compareModels(
      canonicalIds: readonly string[],
    ): Promise<ModelCompareReadModel> {
      const generatedAt = clock().toISOString();
      if (deps.configured === false) {
        return {
          columns: [],
          missingIds: [...canonicalIds],
          generatedAt,
          isDemo: false,
        };
      }

      const { unfiltered } = await loadRows(DEFAULT_EXPLORER_FILTERS);
      const columns: ModelCompareColumn[] = [];
      const missingIds: string[] = [];

      for (const id of canonicalIds) {
        const row = lookupCanonical(unfiltered, id);
        if (!row) {
          missingIds.push(id);
          continue;
        }
        columns.push(toCompareColumn(row));
      }

      return { columns, missingIds, generatedAt, isDemo: false };
    },
  };
}

export function installCatalogExplorerAdapter(): void {
  registerDefaultModelExplorerAdapter(() => createCatalogExplorerAdapter());
}
