/**
 * Server-side read models for Model Explorer, Model Detail and Model Compare.
 *
 * These are the functions the UI calls — directly from a server component, or
 * through the thin routes in `app/api/models`. They never talk to Supabase
 * themselves; they talk to `ModelExplorerReadPort`, which is what makes every
 * behaviour below testable against rows instead of a database.
 *
 * The explorer is built from canonical models, not from catalog rows. That is
 * the difference that keeps two invariants true at once: a model with pricing
 * but no catalog entry is still listed (with unknown capabilities), and a model
 * missing from a catalog page keeps whatever lifecycle its lifecycle source
 * published.
 */

import { provenanceTrustFromAuthority, type ProvenanceView } from "../product/provenance";
import type {
  CapabilitySnapshotRow,
  ChangeEventRow,
  LatestCapabilitySnapshotRow,
  LatestLifecycleSnapshotRow,
  LatestPricingSnapshotRow,
  LifecycleSnapshotRow,
  ModelRow,
  PricingSnapshotRow,
} from "../supabase/types";
import {
  buildEvidenceContext,
  buildEvidenceProvenance,
  buildExplorerEntry,
  type EvidenceContext,
} from "./evidence";
import {
  applyExplorerFilters,
  buildExplorerFacets,
  sortExplorerEntries,
} from "./filters";
import { createModelExplorerReadPort, type ModelExplorerReadPort } from "./port";
import type {
  ComparisonCell,
  ComparisonRow,
  EvidenceDomain,
  ModelCapabilityHistoryEntry,
  ModelChangeEntry,
  ModelComparison,
  ModelDetail,
  ModelExplorerEntry,
  ModelExplorerFilters,
  ModelExplorerResult,
  ModelExplorerSort,
  ModelLifecycleHistoryEntry,
  ModelPricingHistoryEntry,
} from "./types";

export interface ModelReadModelOptions {
  port?: ModelExplorerReadPort;
  now?: () => Date;
}

export interface ModelExplorerOptions extends ModelReadModelOptions {
  filters?: ModelExplorerFilters;
  sort?: ModelExplorerSort;
  limit?: number;
}

function groupByModelId<T extends { model_id: string }>(
  rows: readonly T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const existing = grouped.get(row.model_id);
    if (existing) existing.push(row);
    else grouped.set(row.model_id, [row]);
  }
  return grouped;
}

function runIdsOf(
  ...rowSets: ReadonlyArray<ReadonlyArray<{ run_id: string | null }>>
): string[] {
  const ids = new Set<string>();
  for (const rows of rowSets) {
    for (const row of rows) {
      if (row.run_id) ids.add(row.run_id);
    }
  }
  return [...ids];
}

interface CurrentEvidence {
  models: ModelRow[];
  pricingByModel: Map<string, LatestPricingSnapshotRow[]>;
  capabilityByModel: Map<string, LatestCapabilitySnapshotRow[]>;
  lifecycleByModel: Map<string, LatestLifecycleSnapshotRow[]>;
  context: EvidenceContext;
}

async function loadCurrentEvidence(
  port: ModelExplorerReadPort,
  modelIds?: readonly string[],
): Promise<CurrentEvidence> {
  const scope = modelIds ? { modelIds } : {};
  const [models, providers, sources, pricing, capabilities, lifecycle] =
    await Promise.all([
      port.listModels(scope),
      port.listProviders(),
      port.listSources(),
      port.listCurrentPricing(scope),
      port.listCurrentCapabilities(scope),
      port.listCurrentLifecycle(scope),
    ]);

  const externalRunIds = await port.listExternalRunIds(
    runIdsOf(pricing, capabilities, lifecycle),
  );

  return {
    models,
    pricingByModel: groupByModelId(pricing),
    capabilityByModel: groupByModelId(capabilities),
    lifecycleByModel: groupByModelId(lifecycle),
    context: buildEvidenceContext(sources, providers, externalRunIds),
  };
}

function entriesFrom(evidence: CurrentEvidence, now: Date): ModelExplorerEntry[] {
  return evidence.models.map((model) =>
    buildExplorerEntry(
      {
        model,
        provider: evidence.context.providersById.get(model.provider_id),
        pricingRows: evidence.pricingByModel.get(model.id) ?? [],
        capabilityRows: evidence.capabilityByModel.get(model.id) ?? [],
        lifecycleRows: evidence.lifecycleByModel.get(model.id) ?? [],
      },
      evidence.context,
      now,
    ),
  );
}

/** Every canonical model with its current trusted evidence, filtered. */
export async function getModelExplorer(
  options: ModelExplorerOptions = {},
): Promise<ModelExplorerResult> {
  const port = options.port ?? createModelExplorerReadPort();
  const now = options.now?.() ?? new Date();

  const evidence = await loadCurrentEvidence(port);
  const all = entriesFrom(evidence, now);
  const filtered = sortExplorerEntries(
    applyExplorerFilters(all, options.filters ?? {}),
    options.sort,
  );
  const limited =
    options.limit !== undefined && options.limit > 0
      ? filtered.slice(0, options.limit)
      : filtered;

  return {
    entries: limited,
    totalCount: all.length,
    filteredCount: filtered.length,
    facets: buildExplorerFacets(all),
    generatedAt: now.toISOString(),
  };
}

export interface ModelDetailOptions extends ModelReadModelOptions {
  pricingHistoryLimit?: number;
  capabilityHistoryLimit?: number;
  lifecycleHistoryLimit?: number;
  changeLimit?: number;
}

const CHANGE_DOMAINS: Record<string, EvidenceDomain | "other"> = {
  price_increased: "pricing",
  price_decreased: "pricing",
  lifecycle_changed: "lifecycle",
  capability_changed: "capability",
  model_added: "other",
  model_removed: "other",
  metadata_changed: "other",
};

function historyProvenance(
  row: {
    id: string;
    source_id: string;
    provider_id: string;
    source_url: string | null;
    observed_at: string;
    run_id: string;
  },
  context: EvidenceContext,
): ProvenanceView {
  return buildEvidenceProvenance(
    {
      sourceId: row.source_id,
      providerId: row.provider_id,
      sourceUrl: row.source_url,
      observedAt: row.observed_at,
      runId: row.run_id,
      snapshotId: row.id,
    },
    context,
  );
}

function pricingHistoryEntry(
  row: PricingSnapshotRow,
  context: EvidenceContext,
): ModelPricingHistoryEntry {
  return {
    snapshotId: row.id,
    pricingMode: row.pricing_mode,
    contextTier: row.context_tier,
    inputPricePer1MTokens: row.input_price_per_1m_tokens,
    cachedInputPricePer1MTokens: row.cached_input_price_per_1m_tokens,
    cacheWritePricePer1MTokens: row.cache_write_price_per_1m_tokens,
    outputPricePer1MTokens: row.output_price_per_1m_tokens,
    currency: row.currency,
    unit: row.pricing_unit,
    observedAt: row.observed_at,
    provenance: historyProvenance(row, context),
  };
}

function capabilityHistoryEntry(
  row: CapabilitySnapshotRow,
  context: EvidenceContext,
): ModelCapabilityHistoryEntry {
  return {
    snapshotId: row.id,
    apiModelId: row.api_model_id,
    displayName: row.display_name,
    family: row.model_family,
    stage: row.model_stage,
    contextWindow: row.context_window,
    maxOutputTokens: row.max_output_tokens,
    supportsVision: row.supports_vision,
    supportsToolCalling: row.supports_tool_calling,
    inputModalities: [...(row.input_modalities ?? [])],
    outputModalities: [...(row.output_modalities ?? [])],
    supportedFeatures: [...(row.supported_features ?? [])],
    observedAt: row.observed_at,
    provenance: historyProvenance(row, context),
  };
}

function lifecycleHistoryEntry(
  row: LifecycleSnapshotRow,
  context: EvidenceContext,
): ModelLifecycleHistoryEntry {
  return {
    snapshotId: row.id,
    apiModelId: row.api_model_id,
    state: row.lifecycle_state,
    deprecationDate: row.deprecated_on,
    retirementDate: row.retirement_date,
    retirementNotBeforeDate: row.retirement_not_before_date,
    retirementNotBeforeObservation: row.retirement_not_before_observation,
    recommendedReplacement: row.recommended_replacement,
    recommendedReplacementModelId: row.recommended_replacement_model_id,
    observedAt: row.observed_at,
    provenance: historyProvenance(row, context),
  };
}

function changeEntry(
  event: ChangeEventRow,
  context: EvidenceContext,
): ModelChangeEntry {
  const source = event.source_id ? context.sourcesById.get(event.source_id) : undefined;
  const provenance: ProvenanceView = event.source_id
    ? buildEvidenceProvenance(
        {
          sourceId: event.source_id,
          providerId: event.provider_id,
          sourceUrl: source?.source_url ?? null,
          observedAt: event.detected_at,
          runId: event.run_id,
          snapshotId:
            event.current_snapshot_id ??
            event.current_lifecycle_snapshot_id ??
            event.current_capability_snapshot_id ??
            null,
        },
        context,
      )
    : {
        sourceLabel: null,
        sourceUrl: null,
        sourceKind: null,
        collectorId: null,
        observedAt: event.detected_at,
        authority: null,
        confidence: null,
        trust: provenanceTrustFromAuthority(null),
        validation: null,
        runId: event.run_id,
        externalRunId: null,
        snapshotId: null,
        previousSnapshotId: null,
        isDemo: false,
      };

  return {
    eventId: event.id,
    changeType: event.change_type,
    domain: CHANGE_DOMAINS[event.change_type] ?? "other",
    fieldName: event.field_name,
    pricingMode: event.pricing_mode,
    contextTier: event.context_tier,
    oldValue: event.old_value,
    newValue: event.new_value,
    summary: event.summary,
    detectedAt: event.detected_at,
    provenance: {
      ...provenance,
      previousSnapshotId:
        event.previous_snapshot_id ??
        event.previous_lifecycle_snapshot_id ??
        event.previous_capability_snapshot_id ??
        null,
    },
  };
}

/**
 * One canonical model in full: its current trusted evidence, then the history
 * behind each evidence domain and the changes detected between them.
 *
 * This is not Source Detail. Nothing here describes a collector's health, its
 * contract, its incidents or its healing attempts — those belong to the source
 * that produced the evidence, and each value below links to it by source id and
 * run id rather than restating it.
 */
export async function getModelDetail(
  canonicalModelId: string,
  options: ModelDetailOptions = {},
): Promise<ModelDetail | null> {
  const port = options.port ?? createModelExplorerReadPort();
  const now = options.now?.() ?? new Date();

  const evidence = await loadCurrentEvidence(port, [canonicalModelId]);
  const model = evidence.models.find((row) => row.id === canonicalModelId);
  if (!model) return null;

  const [pricingHistory, capabilityHistory, lifecycleHistory, changes, aliases] =
    await Promise.all([
      port.listPricingHistory(canonicalModelId, options.pricingHistoryLimit ?? 100),
      port.listCapabilityHistory(canonicalModelId, options.capabilityHistoryLimit ?? 100),
      port.listLifecycleHistory(canonicalModelId, options.lifecycleHistoryLimit ?? 100),
      port.listModelChangeEvents(canonicalModelId, options.changeLimit ?? 50),
      port.listModelAliases([canonicalModelId]),
    ]);

  // History and change events reference runs the current-evidence load may not
  // have seen, so provenance resolves their collector run ids too.
  const historyContext: EvidenceContext = {
    ...evidence.context,
    externalRunIdsByRunId: new Map([
      ...evidence.context.externalRunIdsByRunId,
      ...(
        await port.listExternalRunIds(
          runIdsOf(pricingHistory, capabilityHistory, lifecycleHistory, changes),
        )
      ).map((run) => [run.id, run.external_run_id] as const),
    ]),
  };

  const [current] = entriesFrom({ ...evidence, models: [model] }, now);

  return {
    current,
    pricingHistory: pricingHistory.map((row) => pricingHistoryEntry(row, historyContext)),
    capabilityHistory: capabilityHistory.map((row) =>
      capabilityHistoryEntry(row, historyContext),
    ),
    lifecycleHistory: lifecycleHistory.map((row) =>
      lifecycleHistoryEntry(row, historyContext),
    ),
    recentChanges: changes.map((event) => changeEntry(event, historyContext)),
    apiModelIds: [
      ...new Set(
        aliases
          .filter((alias) => alias.alias_type === "api_model_id")
          .map((alias) => alias.alias),
      ),
    ].sort(),
    generatedAt: now.toISOString(),
  };
}

interface ComparisonField {
  field: string;
  label: string;
  kind: ComparisonRow["kind"];
  domain: EvidenceDomain;
  read(entry: ModelExplorerEntry): ComparisonCell["value"];
}

/**
 * The aligned rows a comparison renders, in reading order: cost, then size,
 * then capability, then modality, then lifecycle. No row scores or ranks
 * anything — deciding which model wins is the Stack Optimizer's job, and a
 * comparison that pre-judged would make that decision unauditable.
 */
const COMPARISON_FIELDS: readonly ComparisonField[] = [
  {
    field: "inputPricePer1MTokens",
    label: "Input price",
    kind: "price",
    domain: "pricing",
    read: (entry) => entry.pricing.primary?.inputPricePer1MTokens ?? null,
  },
  {
    field: "outputPricePer1MTokens",
    label: "Output price",
    kind: "price",
    domain: "pricing",
    read: (entry) => entry.pricing.primary?.outputPricePer1MTokens ?? null,
  },
  {
    field: "cachedInputPricePer1MTokens",
    label: "Cached input price",
    kind: "price",
    domain: "pricing",
    read: (entry) => entry.pricing.primary?.cachedInputPricePer1MTokens ?? null,
  },
  {
    field: "currency",
    label: "Currency",
    kind: "text",
    domain: "pricing",
    read: (entry) => entry.pricing.primary?.currency ?? null,
  },
  {
    field: "pricingUnit",
    label: "Pricing unit",
    kind: "text",
    domain: "pricing",
    read: (entry) => entry.pricing.primary?.unit ?? null,
  },
  {
    field: "contextWindow",
    label: "Context window",
    kind: "tokens",
    domain: "capability",
    read: (entry) => entry.capabilities.contextWindow,
  },
  {
    field: "maxOutputTokens",
    label: "Max output tokens",
    kind: "tokens",
    domain: "capability",
    read: (entry) => entry.capabilities.maxOutputTokens,
  },
  {
    field: "supportsVision",
    label: "Vision",
    kind: "boolean",
    domain: "capability",
    read: (entry) => entry.capabilities.supportsVision,
  },
  {
    field: "supportsToolCalling",
    label: "Tool calling",
    kind: "boolean",
    domain: "capability",
    read: (entry) => entry.capabilities.supportsToolCalling,
  },
  {
    field: "inputModalities",
    label: "Input modalities",
    kind: "list",
    domain: "capability",
    read: (entry) =>
      entry.capabilities.inputModalities.length > 0
        ? entry.capabilities.inputModalities
        : null,
  },
  {
    field: "outputModalities",
    label: "Output modalities",
    kind: "list",
    domain: "capability",
    read: (entry) =>
      entry.capabilities.outputModalities.length > 0
        ? entry.capabilities.outputModalities
        : null,
  },
  {
    field: "lifecycleState",
    label: "Lifecycle state",
    kind: "text",
    domain: "lifecycle",
    read: (entry) => entry.lifecycle.state,
  },
  {
    field: "deprecationDate",
    label: "Deprecated on",
    kind: "date",
    domain: "lifecycle",
    read: (entry) => entry.lifecycle.deprecationDate,
  },
  {
    field: "retirementDate",
    label: "Retirement date",
    kind: "date",
    domain: "lifecycle",
    read: (entry) => entry.lifecycle.retirementDate,
  },
  {
    field: "retirementNotBeforeDate",
    label: "Retirement not before",
    kind: "date",
    domain: "lifecycle",
    read: (entry) => entry.lifecycle.retirementNotBeforeDate,
  },
  {
    field: "recommendedReplacement",
    label: "Recommended replacement",
    kind: "text",
    domain: "lifecycle",
    read: (entry) => entry.lifecycle.recommendedReplacement,
  },
  {
    field: "lastVerifiedAt",
    label: "Last verified",
    kind: "date",
    domain: "lifecycle",
    read: (entry) => entry.freshness.lastVerifiedAt,
  },
];

/**
 * Aligned comparison of several canonical models.
 *
 * Models are addressed by canonical id only — never by display name, which is
 * not identity and which two providers may reuse. An id that resolves to no
 * model is reported in `unresolvedIds` rather than dropped silently, and rows
 * stay aligned with `models` index for index, so a caller can render a column
 * per model without re-keying anything.
 */
export async function compareModels(
  canonicalModelIds: readonly string[],
  options: ModelReadModelOptions = {},
): Promise<ModelComparison> {
  const port = options.port ?? createModelExplorerReadPort();
  const now = options.now?.() ?? new Date();

  const requested = [...new Set(canonicalModelIds.map((id) => id.trim()).filter(Boolean))];
  if (requested.length === 0) {
    return { models: [], rows: [], unresolvedIds: [], generatedAt: now.toISOString() };
  }

  const evidence = await loadCurrentEvidence(port, requested);
  const entries = entriesFrom(evidence, now);
  const byId = new Map(entries.map((entry) => [entry.canonicalModelId, entry]));

  const models = requested
    .map((id) => byId.get(id))
    .filter((entry): entry is ModelExplorerEntry => entry !== undefined);
  const unresolvedIds = requested.filter((id) => !byId.has(id));

  const rows: ComparisonRow[] = COMPARISON_FIELDS.map((field) => ({
    field: field.field,
    label: field.label,
    kind: field.kind,
    domain: field.domain,
    cells: models.map((entry) => {
      const value = field.read(entry);
      return {
        canonicalModelId: entry.canonicalModelId,
        value,
        known: value !== null,
        provenance: entry.provenance[field.domain],
      };
    }),
  }));

  return { models, rows, unresolvedIds, generatedAt: now.toISOString() };
}
