/**
 * Read model for the "What Changed?" feed.
 *
 * Every fact here comes from an `EvidenceBundle` produced by the temporal
 * intelligence layer (`lib/intelligence`). This module only projects that
 * bundle into a shape a list can render: it derives no events, scores nothing
 * itself, and reproduces none of the backend's detection logic.
 */

import type {
  EvidenceBundle,
  EvidenceCategory,
  RelativeDateRange,
  TemporalChangeType,
  TemporalEvidence,
} from "../intelligence/contracts";
import { type ProvenanceView, provenanceFromEvidence } from "./provenance";
import { canonicalModelKey } from "./watchlist";

export type ChangeTone = "positive" | "negative" | "warning" | "info" | "neutral";

export type ChangeSignificanceTier = "high" | "medium" | "low";

export type ChangeDirection = "increase" | "decrease" | "none";

export interface ChangeFeedItem {
  id: string;
  providerSlug: string;
  providerName: string;
  /** Stable canonical model identifier, e.g. `anthropic:claude-3-5-sonnet-20241022`. */
  modelKey: string;
  /** The provider's own API model id, as observed. */
  modelId: string;
  /** Display name when the provider publishes one, else the API model id. */
  modelLabel: string;
  category: EvidenceCategory;
  categoryLabel: string;
  changeType: TemporalChangeType;
  changeTypeLabel: string;
  tone: ChangeTone;
  /** Field the change applies to, when the change is field-scoped. */
  field: string | null;
  before: string | null;
  after: string | null;
  /** Signed magnitude for price moves, e.g. `-90.0%`. Null when not numeric. */
  delta: string | null;
  direction: ChangeDirection;
  observedAt: string;
  significanceScore: number;
  significanceTier: ChangeSignificanceTier;
  summary: string;
  provenance: ProvenanceView;
  isDemo: boolean;
}

export interface ChangeFeedFilterOption {
  value: string;
  label: string;
  count: number;
}

export interface ChangeFeedFilters {
  /** Provider slug, or null for every provider. */
  provider: string | null;
  category: EvidenceCategory | null;
  range: RelativeDateRange;
  demo: boolean;
}

/** Headline counts, taken verbatim from the bundle's own metrics. */
export interface ChangeFeedStats {
  totalEvents: number;
  priceIncreases: number;
  priceDecreases: number;
  modelsAdded: number;
  lifecycleTransitions: number;
  deprecationsScheduled: number;
  retirementsScheduled: number;
}

export interface ChangeFeedReadModel {
  items: ChangeFeedItem[];
  stats: ChangeFeedStats;
  totalEvents: number;
  generatedAt: string;
  /** True only when the bundle is built from the labelled demo dataset. */
  isDemoData: boolean;
  narrativeSummary: string | null;
  providerOptions: ChangeFeedFilterOption[];
  categoryOptions: ChangeFeedFilterOption[];
}

export const DEFAULT_CHANGE_FEED_FILTERS: ChangeFeedFilters = {
  provider: null,
  category: null,
  range: "30d",
  demo: false,
};

export const CHANGE_FEED_RANGE_OPTIONS: readonly {
  value: RelativeDateRange;
  label: string;
}[] = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

const CATEGORY_LABELS: Record<EvidenceCategory, string> = {
  pricing: "Pricing",
  lifecycle: "Lifecycle",
  catalog: "Catalog",
  deprecations: "Deprecation",
  retirements: "Retirement",
  replacements: "Replacement",
  metadata: "Metadata",
};

export const CHANGE_FEED_CATEGORY_ORDER: readonly EvidenceCategory[] = [
  "pricing",
  "lifecycle",
  "deprecations",
  "retirements",
  "replacements",
  "catalog",
  "metadata",
];

const CHANGE_TYPE_LABELS: Record<TemporalChangeType, string> = {
  price_increased: "Price increase",
  price_decreased: "Price decrease",
  model_added: "Model added",
  model_removed: "Model removed",
  lifecycle_transition: "Lifecycle transition",
  deprecation_scheduled: "Deprecation scheduled",
  retirement_scheduled: "Retirement scheduled",
  retirement_not_before_scheduled: "Retirement window announced",
  replacement_recommended: "Replacement recommended",
  metadata_changed: "Metadata changed",
};

const CHANGE_TONES: Record<TemporalChangeType, ChangeTone> = {
  price_increased: "negative",
  price_decreased: "positive",
  model_added: "positive",
  model_removed: "negative",
  lifecycle_transition: "warning",
  deprecation_scheduled: "warning",
  retirement_scheduled: "negative",
  retirement_not_before_scheduled: "warning",
  replacement_recommended: "info",
  metadata_changed: "neutral",
};

export function changeCategoryLabel(category: EvidenceCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function changeTypeLabel(changeType: TemporalChangeType): string {
  return CHANGE_TYPE_LABELS[changeType] ?? changeType.replaceAll("_", " ");
}

export function changeTone(changeType: TemporalChangeType): ChangeTone {
  return CHANGE_TONES[changeType] ?? "neutral";
}

export function significanceTier(score: number): ChangeSignificanceTier {
  if (score >= 75) return "high";
  if (score >= 40) return "medium";
  return "low";
}

export function significanceTierLabel(tier: ChangeSignificanceTier): string {
  if (tier === "high") return "High impact";
  if (tier === "medium") return "Notable";
  return "Routine";
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function humanise(value: string): string {
  const spaced = value.replaceAll("_", " ").trim();
  if (spaced.length === 0) return value;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const LIFECYCLE_WORDS = new Set(["active", "legacy", "deprecated", "retired", "preview"]);

/**
 * Renders one side of a before → after pair. Objects are the one shape a list
 * row cannot usefully show, so they are reported as unavailable rather than
 * stringified into noise.
 */
export function formatChangeValue(value: TemporalEvidence["currentValue"]): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    return LIFECYCLE_WORDS.has(trimmed.toLowerCase()) ? humanise(trimmed) : trimmed;
  }
  return null;
}

function priceSide(price: number | null | undefined): string | null {
  return typeof price === "number" ? formatMoney(price) : null;
}

function projectEvidence(evidence: TemporalEvidence): ChangeFeedItem {
  const delta = evidence.priceDelta ?? null;
  const before = priceSide(delta?.previousPrice) ?? formatChangeValue(evidence.previousValue);
  const after = priceSide(delta?.currentPrice) ?? formatChangeValue(evidence.currentValue);

  const percent = delta?.percentChange ?? null;
  const deltaLabel =
    typeof percent === "number" && Number.isFinite(percent)
      ? `${percent > 0 ? "+" : percent < 0 ? "−" : ""}${Math.abs(percent).toFixed(1)}%`
      : null;

  const direction: ChangeDirection =
    evidence.changeType === "price_increased"
      ? "increase"
      : evidence.changeType === "price_decreased"
        ? "decrease"
        : "none";

  return {
    id: evidence.id,
    providerSlug: evidence.provider,
    providerName: evidence.providerName,
    modelKey: canonicalModelKey(evidence.provider, evidence.model),
    modelId: evidence.model,
    modelLabel: evidence.displayName ?? evidence.model,
    category: evidence.category,
    categoryLabel: changeCategoryLabel(evidence.category),
    changeType: evidence.changeType,
    changeTypeLabel: changeTypeLabel(evidence.changeType),
    tone: changeTone(evidence.changeType),
    field: evidence.field ?? null,
    before,
    after,
    delta: deltaLabel,
    direction,
    observedAt: evidence.observedAt,
    significanceScore: evidence.significanceScore,
    significanceTier: significanceTier(evidence.significanceScore),
    summary: evidence.summary,
    provenance: provenanceFromEvidence(evidence),
    isDemo: evidence.isDemo === true,
  };
}

function buildProviderOptions(bundle: EvidenceBundle): ChangeFeedFilterOption[] {
  return Object.entries(bundle.metrics.byProvider)
    .map(([slug, stats]) => ({
      value: slug,
      label: stats.providerName,
      count: stats.total,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function buildCategoryOptions(bundle: EvidenceBundle): ChangeFeedFilterOption[] {
  const counts = bundle.metrics.byCategory ?? {};
  return CHANGE_FEED_CATEGORY_ORDER.filter((category) => (counts[category] ?? 0) > 0).map(
    (category) => ({
      value: category,
      label: changeCategoryLabel(category),
      count: counts[category] ?? 0,
    }),
  );
}

/** Projects a bundle from `queryTemporalIntelligence` into the feed read model. */
export function buildChangeFeed(bundle: EvidenceBundle): ChangeFeedReadModel {
  const metrics = bundle.metrics;
  return {
    items: bundle.events.map(projectEvidence),
    stats: {
      totalEvents: metrics.totalEvents,
      priceIncreases: metrics.priceIncreases,
      priceDecreases: metrics.priceDecreases,
      modelsAdded: metrics.modelsAdded,
      lifecycleTransitions: metrics.lifecycleTransitions,
      deprecationsScheduled: metrics.deprecationsScheduled,
      retirementsScheduled: metrics.retirementsScheduled,
    },
    totalEvents: bundle.totalEvents,
    generatedAt: bundle.generatedAt,
    isDemoData: bundle.isDemoData,
    narrativeSummary: bundle.narrativeSummary ?? null,
    providerOptions: buildProviderOptions(bundle),
    categoryOptions: buildCategoryOptions(bundle),
  };
}

const RANGE_DAYS: Partial<Record<RelativeDateRange, number>> = {
  "24h": 1,
  "7d": 7,
  "14d": 14,
  "30d": 30,
  "60d": 60,
  "90d": 90,
  "180d": 180,
};

/**
 * Client-side narrowing of an already-fetched page of items.
 *
 * The authoritative filter is the query the backend runs; this keeps the list
 * consistent with the controls between fetches and gives the filter behaviour
 * a pure, testable definition.
 */
export function filterChangeFeedItems(
  items: readonly ChangeFeedItem[],
  filters: ChangeFeedFilters,
  now: Date = new Date(),
): ChangeFeedItem[] {
  const days = RANGE_DAYS[filters.range] ?? null;
  const since =
    days === null ? null : new Date(now.getTime() - days * 24 * 60 * 60 * 1000).getTime();

  return items.filter((item) => {
    if (filters.provider && item.providerSlug !== filters.provider) return false;
    if (filters.category && item.category !== filters.category) return false;
    if (since !== null) {
      const observed = Date.parse(item.observedAt);
      if (Number.isFinite(observed) && observed < since) return false;
    }
    return true;
  });
}

/** Serialises filters for `GET /api/intelligence/changes`. */
export function changeFeedSearchParams(
  filters: ChangeFeedFilters,
  options: { limit?: number } = {},
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.category) params.set("categories", filters.category);
  params.set("range", filters.range);
  if (filters.demo) params.set("demo", "true");
  if (options.limit) params.set("limit", String(options.limit));
  return params;
}

/** Reads filters back out of a URL, falling back to the defaults per field. */
export function changeFeedFiltersFromParams(
  params: URLSearchParams | Record<string, string | undefined>,
): ChangeFeedFilters {
  const get = (key: string): string | null => {
    if (params instanceof URLSearchParams) return params.get(key);
    return params[key] ?? null;
  };

  const range = get("range");
  const category = get("category") ?? get("categories");

  return {
    provider: get("provider") ?? null,
    category:
      category && (CHANGE_FEED_CATEGORY_ORDER as readonly string[]).includes(category)
        ? (category as EvidenceCategory)
        : null,
    range: CHANGE_FEED_RANGE_OPTIONS.some((option) => option.value === range)
      ? (range as RelativeDateRange)
      : DEFAULT_CHANGE_FEED_FILTERS.range,
    demo: get("demo") === "true",
  };
}

/**
 * Splits the feed so changes touching a watched model can be surfaced first
 * without reordering — and so distorting — the chronological record below.
 */
export function partitionWatchedChanges(
  items: readonly ChangeFeedItem[],
  watchedModelKeys: readonly string[],
): { watched: ChangeFeedItem[]; rest: ChangeFeedItem[] } {
  if (watchedModelKeys.length === 0) return { watched: [], rest: [...items] };
  const keys = new Set(watchedModelKeys);
  const watched: ChangeFeedItem[] = [];
  const rest: ChangeFeedItem[] = [];
  for (const item of items) {
    if (keys.has(item.modelKey)) watched.push(item);
    else rest.push(item);
  }
  return { watched, rest };
}

/**
 * Watched changes first, then everything else, each half still newest-first.
 * Used where a single list must carry the priority, such as My Stack.
 */
export function prioritizeWatchedChanges(
  items: readonly ChangeFeedItem[],
  watchedModelKeys: readonly string[],
): ChangeFeedItem[] {
  const { watched, rest } = partitionWatchedChanges(items, watchedModelKeys);
  const byNewest = (left: ChangeFeedItem, right: ChangeFeedItem) =>
    Date.parse(right.observedAt) - Date.parse(left.observedAt);
  return [...watched.sort(byNewest), ...rest.sort(byNewest)];
}
