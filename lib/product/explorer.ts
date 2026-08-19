/**
 * The typed seam between Model Explorer, Model Detail, Model Compare, and
 * whatever backend supplies them.
 *
 * Every explorer screen is written against the types in this module only.
 * Today's catalog adapter projects the current capability/pricing/lifecycle
 * read model. A richer Explorer/Compare read model can be dropped in by
 * implementing `ModelExplorerAdapter` and calling `setModelExplorerAdapter`
 * — no component redesign, and no other module needs to know which adapter
 * is installed.
 *
 * Filter *controls* live in the UI as presentation state. Matching those
 * controls to rows is the adapter's job (today, the catalog adapter; later,
 * the richer read model). Components must not re-implement filter rules.
 *
 * Two rules make the swap safe:
 *
 * 1. Optional sections are `SectionState<T>`, so an adapter must either supply
 *    data or state why it cannot. There is no third empty-looking outcome.
 * 2. `boolean | null` capabilities stay tri-state all the way to the pixel:
 *    `null` is Unknown / Not observed, never "unsupported".
 */

import { canonicalModelKey } from "./watchlist";
import type { ProvenanceView } from "./provenance";
import { available, unavailable, type SectionState } from "./source-detail";

export { available, unavailable, type SectionState };

/** How recently — and how confidently — this evidence was observed. */
export type EvidenceQuality = "current" | "stale" | "degraded" | "unknown";

export const LIFECYCLE_STATES = ["active", "legacy", "deprecated", "retired"] as const;

export type ExplorerLifecycleState = (typeof LIFECYCLE_STATES)[number];

/** Presentation-state filter controls. Adapters interpret these. */
export interface ExplorerFilters {
  provider: string | null;
  /** Inclusive ceiling in USD per 1M input tokens. */
  maxInputPrice: number | null;
  /** Inclusive ceiling in USD per 1M output tokens. */
  maxOutputPrice: number | null;
  minContext: number | null;
  visionRequired: boolean;
  toolCallingRequired: boolean;
  activeOnly: boolean;
  lifecycleState: ExplorerLifecycleState | null;
}

export const DEFAULT_EXPLORER_FILTERS: ExplorerFilters = {
  provider: null,
  maxInputPrice: null,
  maxOutputPrice: null,
  minContext: null,
  visionRequired: false,
  toolCallingRequired: false,
  activeOnly: false,
  lifecycleState: null,
};

export const MAX_COMPARE_MODELS = 5;

export interface ExplorerFilterOption {
  value: string;
  label: string;
  count: number;
}

/**
 * A capability that may not have been observed.
 *
 * `observed === null` MUST render as Unknown / Not observed. It is not the
 * same as `false` (the provider was observed not to support it).
 */
export interface ObservedBoolean {
  observed: boolean | null;
  /** Short label for tables: "Supported", "Not supported", or "Unknown". */
  label: string;
  /** Longer phrase for detail and screen readers. */
  description: string;
}

export interface FreshnessView {
  quality: EvidenceQuality;
  label: string;
  observedAt: string | null;
  description: string;
}

export interface ModelPriceView {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cachedInputPerMillion: number | null;
  currency: string | null;
  unit: string | null;
  pricingMode: string | null;
  contextTier: string | null;
  observedAt: string | null;
  sourceUrl: string | null;
}

export interface ModelLimitsView {
  contextWindow: number | null;
  maxOutputTokens: number | null;
}

export interface ModelCapabilitiesView {
  vision: ObservedBoolean;
  toolCalling: ObservedBoolean;
  inputModalities: string[];
  outputModalities: string[];
  supportedFeatures: string[];
}

export interface ModelIdentityView {
  /** Shareable selection key: `provider:apiModelId`, or `id:<uuid>` as fallback. */
  canonicalId: string;
  /** Internal model UUID. */
  modelId: string;
  providerSlug: string;
  providerName: string;
  modelName: string;
  displayName: string;
  apiModelId: string | null;
  modelFamily: string | null;
  modelStage: string | null;
}

export interface ModelLifecycleView {
  state: string | null;
  label: string;
  isActive: boolean | null;
  deprecatedOn: string | null;
  retirementDate: string | null;
  retirementNotBefore: string | null;
}

export interface ModelReplacementView {
  replacement: string | null;
  replacementModelId: string | null;
  observed: boolean;
}

export interface ModelChangeItem {
  id: string;
  changeType: string;
  changeTypeLabel: string;
  summary: string | null;
  field: string | null;
  observedAt: string;
  before: string | null;
  after: string | null;
}

export interface CapabilityHistoryItem {
  observedAt: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  vision: ObservedBoolean;
  toolCalling: ObservedBoolean;
  sourceUrl: string | null;
}

/** One scan-friendly row in the explorer catalog. */
export interface ModelExplorerRow {
  identity: ModelIdentityView;
  inputPrice: number | null;
  outputPrice: number | null;
  currency: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  vision: ObservedBoolean;
  toolCalling: ObservedBoolean;
  inputModalities: string[];
  outputModalities: string[];
  lifecycle: ModelLifecycleView;
  freshness: FreshnessView;
  provenance: ProvenanceView;
}

export interface ModelExplorerCatalog {
  models: ModelExplorerRow[];
  providerOptions: ExplorerFilterOption[];
  lifecycleOptions: ExplorerFilterOption[];
  totalMatching: number;
  totalUnfiltered: number;
  generatedAt: string;
  isDemo: boolean;
  evidenceQuality: EvidenceQuality;
  evidenceNote: string | null;
}

export interface ModelDetailReadModel {
  identity: ModelIdentityView;
  pricing: SectionState<ModelPriceView[]>;
  capabilities: SectionState<ModelCapabilitiesView>;
  limits: SectionState<ModelLimitsView>;
  lifecycle: SectionState<ModelLifecycleView>;
  replacement: SectionState<ModelReplacementView>;
  freshness: FreshnessView;
  recentChanges: SectionState<ModelChangeItem[]>;
  history: SectionState<CapabilityHistoryItem[]>;
  provenance: ProvenanceView;
  isDemo: boolean;
  generatedAt: string;
}

export interface ModelCompareColumn {
  identity: ModelIdentityView;
  inputPrice: number | null;
  outputPrice: number | null;
  currency: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  vision: ObservedBoolean;
  toolCalling: ObservedBoolean;
  inputModalities: string[];
  outputModalities: string[];
  lifecycle: ModelLifecycleView;
  freshness: FreshnessView;
  provenance: ProvenanceView;
}

export interface ModelCompareReadModel {
  columns: ModelCompareColumn[];
  /** Canonical ids requested but not found. Never invented. */
  missingIds: string[];
  generatedAt: string;
  isDemo: boolean;
}

export interface ModelExplorerCapabilities {
  catalog: boolean;
  detail: boolean;
  compare: boolean;
  /** Capability observation history on the detail page. */
  history: boolean;
  replacement: boolean;
  recentChanges: boolean;
}

export interface ModelExplorerAdapter {
  readonly id: string;
  readonly label: string;
  readonly capabilities: ModelExplorerCapabilities;
  listModels(filters?: ExplorerFilters): Promise<ModelExplorerCatalog>;
  getModelDetail(canonicalId: string): Promise<ModelDetailReadModel | null>;
  compareModels(canonicalIds: readonly string[]): Promise<ModelCompareReadModel>;
}

let installedAdapter: ModelExplorerAdapter | null = null;
let defaultAdapterFactory: (() => ModelExplorerAdapter) | null = null;

export function registerDefaultModelExplorerAdapter(factory: () => ModelExplorerAdapter): void {
  defaultAdapterFactory = factory;
}

export function setModelExplorerAdapter(adapter: ModelExplorerAdapter | null): void {
  installedAdapter = adapter;
}

export function getModelExplorerAdapter(): ModelExplorerAdapter {
  if (installedAdapter) return installedAdapter;
  if (!defaultAdapterFactory) {
    throw new Error(
      "No model-explorer adapter is installed. Import the catalog adapter or call setModelExplorerAdapter().",
    );
  }
  installedAdapter = defaultAdapterFactory();
  return installedAdapter;
}

export function explorerCanonicalId(input: {
  providerSlug: string;
  apiModelId: string | null;
  modelId: string;
}): string {
  if (input.apiModelId && input.apiModelId.trim().length > 0) {
    return canonicalModelKey(input.providerSlug, input.apiModelId);
  }
  return `id:${input.modelId.trim().toLowerCase()}`;
}

export function observedBoolean(value: boolean | null | undefined): ObservedBoolean {
  if (value === true) {
    return {
      observed: true,
      label: "Supported",
      description: "Supported",
    };
  }
  if (value === false) {
    return {
      observed: false,
      label: "Not supported",
      description: "Not supported",
    };
  }
  return {
    observed: null,
    label: "Unknown",
    description: "Unknown — not observed",
  };
}

export function lifecycleLabel(state: string | null | undefined): string {
  if (!state) return "Unknown";
  switch (state) {
    case "active":
      return "Active";
    case "legacy":
      return "Legacy";
    case "deprecated":
      return "Deprecated";
    case "retired":
      return "Retired";
    default:
      return state.replaceAll("_", " ");
  }
}

export function evidenceQualityLabel(quality: EvidenceQuality): string {
  switch (quality) {
    case "current":
      return "Current";
    case "stale":
      return "Stale";
    case "degraded":
      return "Degraded";
    case "unknown":
      return "Unknown";
  }
}

export function formatChangeType(changeType: string): string {
  return changeType.replaceAll("_", " ");
}

function paramGet(
  params: URLSearchParams | Record<string, string | undefined>,
  key: string,
): string | null {
  if (params instanceof URLSearchParams) return params.get(key);
  return params[key] ?? null;
}

function parsePositiveNumber(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

function isLifecycleState(value: string): value is ExplorerLifecycleState {
  return (LIFECYCLE_STATES as readonly string[]).includes(value);
}

/** Reads explorer filter controls out of the URL. Unknown keys are ignored. */
export function explorerFiltersFromParams(
  params: URLSearchParams | Record<string, string | undefined>,
): ExplorerFilters {
  const lifecycle = paramGet(params, "lifecycle");
  return {
    provider: paramGet(params, "provider") || null,
    maxInputPrice: parsePositiveNumber(paramGet(params, "maxInput")),
    maxOutputPrice: parsePositiveNumber(paramGet(params, "maxOutput")),
    minContext: parsePositiveNumber(paramGet(params, "minContext")),
    visionRequired: paramGet(params, "vision") === "1",
    toolCallingRequired: paramGet(params, "tools") === "1",
    activeOnly: paramGet(params, "active") === "1",
    lifecycleState: lifecycle && isLifecycleState(lifecycle) ? lifecycle : null,
  };
}

export function compareIdsFromParams(
  params: URLSearchParams | Record<string, string | undefined>,
): string[] {
  const raw = paramGet(params, "ids") ?? paramGet(params, "compare");
  return parseCompareIds(raw);
}

export function parseCompareIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim().toLowerCase();
    if (!id || !id.includes(":") || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_COMPARE_MODELS) break;
  }
  return ids;
}

export function explorerSearchParams(
  filters: ExplorerFilters,
  compareIds: readonly string[] = [],
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.maxInputPrice !== null) params.set("maxInput", String(filters.maxInputPrice));
  if (filters.maxOutputPrice !== null) params.set("maxOutput", String(filters.maxOutputPrice));
  if (filters.minContext !== null) params.set("minContext", String(filters.minContext));
  if (filters.visionRequired) params.set("vision", "1");
  if (filters.toolCallingRequired) params.set("tools", "1");
  if (filters.activeOnly) params.set("active", "1");
  if (filters.lifecycleState) params.set("lifecycle", filters.lifecycleState);
  if (compareIds.length > 0) params.set("ids", compareIds.join(","));
  return params;
}

export function explorerHref(
  filters: ExplorerFilters,
  compareIds: readonly string[] = [],
): string {
  const query = explorerSearchParams(filters, compareIds).toString();
  return query ? `/models?${query}` : "/models";
}

export function compareHref(compareIds: readonly string[]): string {
  const ids = parseCompareIds(compareIds.join(","));
  if (ids.length === 0) return "/models/compare";
  return `/models/compare?ids=${encodeURIComponent(ids.join(","))}`;
}

export function modelDetailHref(canonicalId: string): string {
  return `/models/${encodeURIComponent(canonicalId)}`;
}

export function toggleCompareId(
  selected: readonly string[],
  canonicalId: string,
): string[] {
  const id = canonicalId.trim().toLowerCase();
  if (!id) return [...selected];
  if (selected.includes(id)) return selected.filter((item) => item !== id);
  if (selected.length >= MAX_COMPARE_MODELS) return [...selected];
  return [...selected, id];
}

export function flattenSearchParams(
  params: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(params)) {
    flat[key] = Array.isArray(value) ? value[0] : value;
  }
  return flat;
}
