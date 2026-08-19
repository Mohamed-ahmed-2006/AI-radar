/**
 * Explorer adapter backed by the canonical model read model.
 *
 * This is the real implementation of `ModelExplorerAdapter`. It projects
 * `lib/explorer` — the canonical Explorer / Detail / Compare read model — into
 * the product seam the screens are written against, replacing the catalog
 * stopgap that shipped with the UI.
 *
 * The division of labour is strict:
 *
 *   * The UI owns control state and the query string.
 *   * This adapter translates that control state into `ModelExplorerFilters`
 *     and projects rows for display.
 *   * `lib/explorer` decides what matches. Every filter — provider, price
 *     ceilings, context floor, vision, tool calling, active-only, lifecycle
 *     state, family and stage — is evaluated there, once, deterministically.
 *
 * No filter rule is re-implemented here, and none may be added here. That is
 * what keeps "unknown never satisfies a requirement" true on every screen
 * rather than true in one place and re-derived in another.
 *
 * Two invariants survive the projection intact. A capability nobody observed
 * arrives as `null` and renders as Unknown, never as "not supported". And a
 * model whose capability evidence is conflicted has that section marked
 * explicitly unavailable rather than filled with a guess.
 */

import {
  compareModels as compareCanonicalModels,
  getModelDetail as getCanonicalModelDetail,
  getModelExplorer as getCanonicalModelExplorer,
  type EvidenceDomain,
  type ModelComparison,
  type ModelDetail as CanonicalModelDetail,
  type ModelExplorerEntry,
  type ModelExplorerFilters as CanonicalExplorerFilters,
  type ModelExplorerResult,
} from "../explorer";
import { getSourceHealth } from "../supabase/repository";
import type { SourceHealthRow } from "../supabase/types";
import { createSupabaseServerClient } from "../supabase/server";
import { isSupabaseReadConfigured } from "../supabase/env";
import type { ProvenanceView } from "./provenance";
import {
  available,
  DEFAULT_EXPLORER_FILTERS,
  evidenceQualityLabel,
  explorerCanonicalId,
  formatChangeType,
  lifecycleLabel,
  observedBoolean,
  registerDefaultModelExplorerAdapter,
  unavailable,
  type CapabilityHistoryItem,
  type DomainProvenanceView,
  type EvidenceQuality,
  type ExplorerFilterOption,
  type ExplorerFilters,
  type FreshnessView,
  type LifecycleHistoryItem,
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
  type PricingHistoryItem,
} from "./explorer";

export const CANONICAL_EXPLORER_ADAPTER_ID = "canonical-explorer-v1";

export const CANONICAL_EXPLORER_CAPABILITIES: ModelExplorerCapabilities = {
  catalog: true,
  detail: true,
  compare: true,
  history: true,
  replacement: true,
  recentChanges: true,
};

/** Presentation heuristic only: the read model publishes no expected interval. */
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

export interface CanonicalExplorerDeps {
  listExplorer: (filters?: CanonicalExplorerFilters) => Promise<ModelExplorerResult>;
  getDetail: (canonicalModelId: string) => Promise<CanonicalModelDetail | null>;
  compare: (canonicalModelIds: readonly string[]) => Promise<ModelComparison>;
  listSourceHealth?: () => Promise<SourceHealthRow[]>;
  now?: () => Date;
  configured?: boolean;
}

function defaultDeps(): CanonicalExplorerDeps {
  return {
    listExplorer: (filters) => getCanonicalModelExplorer({ filters }),
    getDetail: (canonicalModelId) => getCanonicalModelDetail(canonicalModelId),
    compare: (canonicalModelIds) => compareCanonicalModels(canonicalModelIds),
    listSourceHealth: () => getSourceHealth(createSupabaseServerClient()),
    now: () => new Date(),
    configured: isSupabaseReadConfigured(),
  };
}

/**
 * Translates the screen's control state into canonical filters.
 *
 * This is a rename, not a rule. Every control maps one-to-one onto a filter the
 * read model already evaluates, and a control that is off contributes nothing —
 * `visionRequired: false` means vision is not required, so no constraint is
 * sent at all.
 */
export function canonicalFiltersFromExplorer(
  filters: ExplorerFilters,
): CanonicalExplorerFilters {
  const canonical: CanonicalExplorerFilters = {};
  if (filters.provider) canonical.providers = [filters.provider];
  if (filters.maxInputPrice !== null) canonical.maxInputPrice = filters.maxInputPrice;
  if (filters.maxOutputPrice !== null) canonical.maxOutputPrice = filters.maxOutputPrice;
  if (filters.minContext !== null) canonical.minContextWindow = filters.minContext;
  if (filters.visionRequired) canonical.visionRequired = true;
  if (filters.toolCallingRequired) canonical.toolCallingRequired = true;
  if (filters.activeOnly) canonical.activeOnly = true;
  if (filters.lifecycleState) canonical.lifecycleStates = [filters.lifecycleState];
  return canonical;
}

export function projectIdentity(entry: ModelExplorerEntry): ModelIdentityView {
  return {
    canonicalId: explorerCanonicalId({
      providerSlug: entry.provider.slug,
      apiModelId: entry.apiModelId,
      modelId: entry.canonicalModelId,
    }),
    modelId: entry.canonicalModelId,
    providerSlug: entry.provider.slug,
    providerName: entry.provider.name,
    modelName: entry.modelName,
    displayName: entry.displayName ?? entry.modelName,
    apiModelId: entry.apiModelId,
    modelFamily: entry.family,
    modelStage: entry.stage,
  };
}

/**
 * `isActive` is tri-state on purpose: an unobserved lifecycle is Unknown, not
 * "inactive". Only an observed deprecated or retired state makes it false.
 */
export function projectLifecycle(entry: ModelExplorerEntry): ModelLifecycleView {
  return {
    state: entry.lifecycle.state,
    label: lifecycleLabel(entry.lifecycle.state),
    isActive: entry.lifecycle.state === null ? null : !entry.lifecycle.endOfLife,
    deprecatedOn: entry.lifecycle.deprecationDate,
    retirementDate: entry.lifecycle.retirementDate,
    retirementNotBefore: entry.lifecycle.retirementNotBeforeDate,
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
  const quality: EvidenceQuality =
    now.getTime() - observedMs > STALE_AFTER_MS ? "stale" : "current";
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

const DOMAIN_ORDER: readonly EvidenceDomain[] = ["pricing", "capability", "lifecycle"];

/** The provenance of the newest evidence this model carries, or null. */
export function newestProvenance(entry: ModelExplorerEntry): ProvenanceView | null {
  let newest: ProvenanceView | null = null;
  let newestMs = Number.NEGATIVE_INFINITY;
  for (const domain of DOMAIN_ORDER) {
    const provenance = entry.provenance[domain];
    if (!provenance) continue;
    const observedMs = provenance.observedAt ? Date.parse(provenance.observedAt) : NaN;
    const rank = Number.isFinite(observedMs) ? observedMs : Number.NEGATIVE_INFINITY;
    if (newest === null || rank > newestMs) {
      newest = provenance;
      newestMs = rank;
    }
  }
  return newest;
}

/**
 * A model can carry evidence from three different pages, and the seam requires
 * one `ProvenanceView` per row. Rather than invent a merged record, this
 * returns the newest real one — and an explicitly empty, unverified record when
 * a model has no evidence at all, so a row never claims a source it lacks.
 */
function rowProvenance(entry: ModelExplorerEntry): ProvenanceView {
  return (
    newestProvenance(entry) ?? {
      sourceLabel: null,
      sourceUrl: null,
      sourceKind: null,
      collectorId: null,
      observedAt: null,
      authority: null,
      confidence: null,
      trust: "unverified",
      validation: null,
      runId: null,
      externalRunId: null,
      snapshotId: null,
      previousSnapshotId: null,
      isDemo: false,
    }
  );
}

function domainProvenance(entry: ModelExplorerEntry): DomainProvenanceView {
  return {
    pricing: entry.provenance.pricing,
    capability: entry.provenance.capability,
    lifecycle: entry.provenance.lifecycle,
  };
}

export function projectExplorerRow(
  entry: ModelExplorerEntry,
  now: Date,
  sourceDegraded: boolean,
): ModelExplorerRow {
  const price = entry.pricing.primary;
  return {
    identity: projectIdentity(entry),
    inputPrice: price?.inputPricePer1MTokens ?? null,
    outputPrice: price?.outputPricePer1MTokens ?? null,
    currency: price?.currency ?? null,
    contextWindow: entry.capabilities.contextWindow,
    maxOutputTokens: entry.capabilities.maxOutputTokens,
    vision: observedBoolean(entry.capabilities.supportsVision),
    toolCalling: observedBoolean(entry.capabilities.supportsToolCalling),
    inputModalities: entry.capabilities.inputModalities,
    outputModalities: entry.capabilities.outputModalities,
    lifecycle: projectLifecycle(entry),
    freshness: freshnessFromObservation(
      entry.freshness.lastVerifiedAt,
      now,
      sourceDegraded,
    ),
    provenance: rowProvenance(entry),
  };
}

function toCompareColumn(row: ModelExplorerRow, entry: ModelExplorerEntry): ModelCompareColumn {
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
    provenanceByDomain: domainProvenance(entry),
  };
}

function providerOptions(facets: ModelExplorerResult["facets"]): ExplorerFilterOption[] {
  return facets.providers
    .map((facet) => ({ value: facet.slug, label: facet.name || facet.slug, count: facet.count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function lifecycleOptions(facets: ModelExplorerResult["facets"]): ExplorerFilterOption[] {
  return facets.lifecycleStates
    .map((facet) => ({
      value: facet.state,
      label: lifecycleLabel(facet.state),
      count: facet.count,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
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

/**
 * Maps the screen's shareable selection key back to a canonical model id.
 *
 * The key is a display convenience; the canonical id is the identity. Where two
 * models would produce the same key the resolution fails closed — neither is
 * returned — because guessing which one a URL meant is exactly the ambiguity
 * this system refuses everywhere else.
 */
export function resolveCanonicalModelIds(
  entries: readonly ModelExplorerEntry[],
): Map<string, string> {
  const byKey = new Map<string, string | null>();
  for (const entry of entries) {
    const key = explorerCanonicalId({
      providerSlug: entry.provider.slug,
      apiModelId: entry.apiModelId,
      modelId: entry.canonicalModelId,
    }).toLowerCase();
    byKey.set(key, byKey.has(key) ? null : entry.canonicalModelId);
  }
  const resolved = new Map<string, string>();
  for (const [key, modelId] of byKey) {
    if (modelId !== null) resolved.set(key, modelId);
  }
  return resolved;
}

function priceView(tier: {
  pricingMode: string;
  contextTier: string;
  inputPricePer1MTokens: number | null;
  cachedInputPricePer1MTokens: number | null;
  outputPricePer1MTokens: number | null;
  currency: string | null;
  unit: string | null;
  observedAt: string | null;
}, sourceUrl: string | null): ModelPriceView {
  return {
    inputPerMillion: tier.inputPricePer1MTokens,
    outputPerMillion: tier.outputPricePer1MTokens,
    cachedInputPerMillion: tier.cachedInputPricePer1MTokens,
    currency: tier.currency,
    unit: tier.unit,
    pricingMode: tier.pricingMode,
    contextTier: tier.contextTier,
    observedAt: tier.observedAt,
    sourceUrl,
  };
}

function changeItem(change: CanonicalModelDetail["recentChanges"][number]): ModelChangeItem {
  const display = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  };

  return {
    id: change.eventId,
    changeType: change.changeType,
    changeTypeLabel: formatChangeType(change.changeType),
    summary: change.summary,
    field: change.fieldName,
    observedAt: change.detectedAt,
    before: display(change.oldValue),
    after: display(change.newValue),
  };
}

export function createCanonicalExplorerAdapter(
  deps: CanonicalExplorerDeps = defaultDeps(),
): ModelExplorerAdapter {
  const clock = () => deps.now?.() ?? new Date();

  async function degraded(): Promise<boolean> {
    if (!deps.listSourceHealth) return false;
    return catalogDegraded(await deps.listSourceHealth());
  }

  return {
    id: CANONICAL_EXPLORER_ADAPTER_ID,
    label: "Canonical explorer read model",
    capabilities: CANONICAL_EXPLORER_CAPABILITIES,

    async listModels(
      filters: ExplorerFilters = DEFAULT_EXPLORER_FILTERS,
    ): Promise<ModelExplorerCatalog> {
      const generatedAt = clock().toISOString();
      if (deps.configured === false) {
        return emptyCatalog(
          generatedAt,
          "Live catalog is not configured in this environment.",
        );
      }

      // One read: the read model filters, counts and facets in a single pass,
      // so the screen never issues a second query to learn what it filtered out.
      const [result, sourceDegraded] = await Promise.all([
        deps.listExplorer(canonicalFiltersFromExplorer(filters)),
        degraded(),
      ]);
      const now = clock();
      const models = result.entries.map((entry) =>
        projectExplorerRow(entry, now, sourceDegraded),
      );
      const evidence = catalogEvidence(models, sourceDegraded);

      return {
        models,
        providerOptions: providerOptions(result.facets),
        lifecycleOptions: lifecycleOptions(result.facets),
        totalMatching: result.filteredCount,
        totalUnfiltered: result.totalCount,
        generatedAt: result.generatedAt,
        isDemo: false,
        evidenceQuality: evidence.quality,
        evidenceNote: evidence.note,
      };
    },

    async getModelDetail(canonicalId: string): Promise<ModelDetailReadModel | null> {
      if (deps.configured === false) return null;

      const [index, sourceDegraded] = await Promise.all([
        deps.listExplorer(),
        degraded(),
      ]);
      const modelId = resolveCanonicalModelIds(index.entries).get(
        canonicalId.trim().toLowerCase(),
      );
      if (!modelId) return null;

      const detail = await deps.getDetail(modelId);
      if (!detail) return null;

      const entry = detail.current;
      const now = clock();
      const capabilities = entry.capabilities;
      const lifecycle = projectLifecycle(entry);

      const prices = entry.pricing.tiers.map((tier) =>
        priceView(tier, entry.provenance.pricing?.sourceUrl ?? null),
      );

      const history: CapabilityHistoryItem[] = detail.capabilityHistory.map((item) => ({
        observedAt: item.observedAt,
        contextWindow: item.contextWindow,
        maxOutputTokens: item.maxOutputTokens,
        vision: observedBoolean(item.supportsVision),
        toolCalling: observedBoolean(item.supportsToolCalling),
        sourceUrl: item.provenance.sourceUrl,
      }));

      const pricingHistory: PricingHistoryItem[] = detail.pricingHistory.map((item) => ({
        observedAt: item.observedAt,
        pricingMode: item.pricingMode,
        contextTier: item.contextTier,
        inputPerMillion: item.inputPricePer1MTokens,
        cachedInputPerMillion: item.cachedInputPricePer1MTokens,
        outputPerMillion: item.outputPricePer1MTokens,
        currency: item.currency,
        sourceUrl: item.provenance.sourceUrl,
      }));

      const lifecycleHistory: LifecycleHistoryItem[] = detail.lifecycleHistory.map(
        (item) => ({
          observedAt: item.observedAt,
          apiModelId: item.apiModelId,
          state: item.state,
          label: lifecycleLabel(item.state),
          deprecatedOn: item.deprecationDate,
          retirementDate: item.retirementDate,
          retirementNotBefore: item.retirementNotBeforeDate,
          recommendedReplacement: item.recommendedReplacement,
          sourceUrl: item.provenance.sourceUrl,
        }),
      );

      const changes = detail.recentChanges.map(changeItem);

      const hasLimits =
        capabilities.contextWindow !== null || capabilities.maxOutputTokens !== null;
      const hasLifecycleEvidence =
        lifecycle.state !== null ||
        lifecycle.deprecatedOn !== null ||
        lifecycle.retirementDate !== null ||
        lifecycle.retirementNotBefore !== null ||
        entry.provenance.lifecycle !== null;

      return {
        identity: projectIdentity(entry),
        pricing:
          prices.length > 0
            ? available(prices)
            : unavailable("No pricing observation has been recorded for this model."),
        capabilities: capabilities.conflicted
          ? unavailable(
              "Several API model ids currently publish different capability evidence for this model, so none of it can be attributed.",
            )
          : capabilities.observedAt === null
            ? unavailable("No capability observation has been recorded for this model.")
            : available({
                vision: observedBoolean(capabilities.supportsVision),
                toolCalling: observedBoolean(capabilities.supportsToolCalling),
                inputModalities: capabilities.inputModalities,
                outputModalities: capabilities.outputModalities,
                supportedFeatures: capabilities.supportedFeatures,
              }),
        limits: hasLimits
          ? available({
              contextWindow: capabilities.contextWindow,
              maxOutputTokens: capabilities.maxOutputTokens,
            })
          : unavailable("Context and output limits have not been observed for this model."),
        lifecycle: hasLifecycleEvidence
          ? available(lifecycle)
          : unavailable("Lifecycle state has not been observed for this model."),
        replacement:
          entry.lifecycle.recommendedReplacement !== null
            ? available({
                replacement: entry.lifecycle.recommendedReplacement,
                replacementModelId: entry.lifecycle.recommendedReplacementModelId,
                observed: true,
              })
            : unavailable("No replacement has been observed for this model."),
        freshness: freshnessFromObservation(
          entry.freshness.lastVerifiedAt,
          now,
          sourceDegraded,
        ),
        recentChanges:
          changes.length > 0
            ? available(changes)
            : unavailable("No recent changes have been recorded for this model."),
        history:
          history.length > 0
            ? available(history)
            : unavailable("No capability history has been recorded for this model."),
        pricingHistory:
          pricingHistory.length > 0
            ? available(pricingHistory)
            : unavailable("No pricing history has been recorded for this model."),
        lifecycleHistory:
          lifecycleHistory.length > 0
            ? available(lifecycleHistory)
            : unavailable("No lifecycle history has been recorded for this model."),
        apiModelIds:
          detail.apiModelIds.length > 0
            ? available(detail.apiModelIds)
            : unavailable("No API model id has been observed for this model."),
        provenance: rowProvenance(entry),
        provenanceByDomain: domainProvenance(entry),
        isDemo: false,
        generatedAt: detail.generatedAt,
      };
    },

    async compareModels(
      canonicalIds: readonly string[],
    ): Promise<ModelCompareReadModel> {
      const generatedAt = clock().toISOString();
      if (deps.configured === false) {
        return { columns: [], missingIds: [...canonicalIds], generatedAt, isDemo: false };
      }
      if (canonicalIds.length === 0) {
        return { columns: [], missingIds: [], generatedAt, isDemo: false };
      }

      const [index, sourceDegraded] = await Promise.all([
        deps.listExplorer(),
        degraded(),
      ]);
      const resolution = resolveCanonicalModelIds(index.entries);

      // A key that resolves to nothing is reported, never quietly dropped and
      // never matched to a near-miss.
      const requested: Array<{ key: string; modelId: string }> = [];
      const missingIds: string[] = [];
      for (const canonicalId of canonicalIds) {
        const modelId = resolution.get(canonicalId.trim().toLowerCase());
        if (!modelId) {
          missingIds.push(canonicalId);
          continue;
        }
        requested.push({ key: canonicalId, modelId });
      }

      const comparison = await deps.compare(requested.map((item) => item.modelId));
      const now = clock();
      const byModelId = new Map(
        comparison.models.map((entry) => [entry.canonicalModelId, entry]),
      );

      const columns: ModelCompareColumn[] = [];
      for (const item of requested) {
        const entry = byModelId.get(item.modelId);
        if (!entry) {
          missingIds.push(item.key);
          continue;
        }
        columns.push(
          toCompareColumn(projectExplorerRow(entry, now, sourceDegraded), entry),
        );
      }

      return { columns, missingIds, generatedAt: comparison.generatedAt, isDemo: false };
    },
  };
}

export function installCanonicalExplorerAdapter(): void {
  registerDefaultModelExplorerAdapter(() => createCanonicalExplorerAdapter());
}
