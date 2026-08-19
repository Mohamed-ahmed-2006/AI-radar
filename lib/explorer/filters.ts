/**
 * Deterministic filtering for the Model Explorer.
 *
 * One rule governs every predicate here: an unknown value never satisfies a
 * constraint. `visionRequired=true` keeps `supportsVision === true` and drops
 * both `false` and `null`; `minContextWindow` drops a model whose context
 * window was never observed rather than guessing that it is large enough. The
 * alternative — treating unknown as passing — would quietly recommend models
 * on evidence nobody ever collected.
 *
 * The mirror rule is that a `false` requirement is not a constraint at all.
 * `visionRequired=false` means "vision is not required", so it matches every
 * model, including those whose vision support is unknown. A caller who wants
 * "models that explicitly lack vision" is asking a different question, and the
 * explorer deliberately does not answer it through a required-flag.
 */

import type { LifecycleState } from "../supabase/types";
import type {
  ModelExplorerEntry,
  ModelExplorerFacets,
  ModelExplorerFilters,
  ModelExplorerSort,
} from "./types";

function normalizedSet(values: readonly string[] | undefined): Set<string> | null {
  if (!values || values.length === 0) return null;
  const set = new Set(
    values
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  );
  return set.size > 0 ? set : null;
}

/** A required capability is satisfied only by an explicit `true`. */
function satisfiesRequirement(
  observed: boolean | null,
  required: boolean | undefined,
): boolean {
  if (required !== true) return true;
  return observed === true;
}

/** An unobserved number never clears a ceiling. */
function underCeiling(observed: number | null, ceiling: number | undefined): boolean {
  if (ceiling === undefined) return true;
  if (observed === null) return false;
  return observed <= ceiling;
}

/** An unobserved number never clears a floor. */
function overFloor(observed: number | null, floor: number | undefined): boolean {
  if (floor === undefined) return true;
  if (observed === null) return false;
  return observed >= floor;
}

function hasModality(
  observed: readonly string[],
  wanted: Set<string> | null,
): boolean {
  if (!wanted) return true;
  if (observed.length === 0) return false;
  const normalized = new Set(observed.map((value) => value.trim().toLowerCase()));
  for (const value of wanted) {
    if (!normalized.has(value)) return false;
  }
  return true;
}

export function matchesExplorerFilters(
  entry: ModelExplorerEntry,
  filters: ModelExplorerFilters,
): boolean {
  const providers = normalizedSet(filters.providers);
  if (providers && !providers.has(entry.provider.slug.toLowerCase())) return false;

  const price = entry.pricing.primary;
  if (!underCeiling(price?.inputPricePer1MTokens ?? null, filters.maxInputPrice)) {
    return false;
  }
  if (!underCeiling(price?.outputPricePer1MTokens ?? null, filters.maxOutputPrice)) {
    return false;
  }

  if (!overFloor(entry.capabilities.contextWindow, filters.minContextWindow)) {
    return false;
  }
  if (!overFloor(entry.capabilities.maxOutputTokens, filters.minMaxOutputTokens)) {
    return false;
  }

  if (!satisfiesRequirement(entry.capabilities.supportsVision, filters.visionRequired)) {
    return false;
  }
  if (
    !satisfiesRequirement(entry.capabilities.supportsToolCalling, filters.toolCallingRequired)
  ) {
    return false;
  }

  // Active-only drops what is *observed* to be past end of life. A model whose
  // lifecycle nobody publishes is not thereby retired, so it stays; callers who
  // want a specific state ask for it through lifecycleStates.
  if (filters.activeOnly === true && entry.lifecycle.endOfLife) return false;

  const states = normalizedSet(filters.lifecycleStates as readonly string[] | undefined);
  if (states) {
    if (entry.lifecycle.state === null) return false;
    if (!states.has(entry.lifecycle.state)) return false;
  }

  const families = normalizedSet(filters.families);
  if (families) {
    if (entry.family === null) return false;
    if (!families.has(entry.family.toLowerCase())) return false;
  }

  const stages = normalizedSet(filters.stages);
  if (stages) {
    if (entry.stage === null) return false;
    if (!stages.has(entry.stage.toLowerCase())) return false;
  }

  if (!hasModality(entry.capabilities.inputModalities, normalizedSet(filters.inputModalities))) {
    return false;
  }
  if (
    !hasModality(entry.capabilities.outputModalities, normalizedSet(filters.outputModalities))
  ) {
    return false;
  }

  const search = filters.search?.trim().toLowerCase();
  if (search) {
    const haystack = [entry.modelName, entry.displayName, entry.apiModelId]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.toLowerCase());
    if (!haystack.some((value) => value.includes(search))) return false;
  }

  return true;
}

export function applyExplorerFilters(
  entries: readonly ModelExplorerEntry[],
  filters: ModelExplorerFilters,
): ModelExplorerEntry[] {
  return entries.filter((entry) => matchesExplorerFilters(entry, filters));
}

/**
 * Sorts entries. Unknown values always sort last regardless of direction, so a
 * price-ascending list never opens with models that simply have no price.
 */
export function sortExplorerEntries(
  entries: readonly ModelExplorerEntry[],
  sort: ModelExplorerSort = "provider",
): ModelExplorerEntry[] {
  const byName = (a: ModelExplorerEntry, b: ModelExplorerEntry) =>
    a.provider.slug.localeCompare(b.provider.slug) ||
    a.modelName.localeCompare(b.modelName);

  const numeric = (
    value: number | null,
    a: ModelExplorerEntry,
    b: ModelExplorerEntry,
    other: number | null,
    descending = false,
  ) => {
    if (value === null && other === null) return byName(a, b);
    if (value === null) return 1;
    if (other === null) return -1;
    if (value === other) return byName(a, b);
    return descending ? other - value : value - other;
  };

  return [...entries].sort((a, b) => {
    switch (sort) {
      case "input_price":
        return numeric(
          a.pricing.primary?.inputPricePer1MTokens ?? null,
          a,
          b,
          b.pricing.primary?.inputPricePer1MTokens ?? null,
        );
      case "output_price":
        return numeric(
          a.pricing.primary?.outputPricePer1MTokens ?? null,
          a,
          b,
          b.pricing.primary?.outputPricePer1MTokens ?? null,
        );
      case "context_window":
        return numeric(a.capabilities.contextWindow, a, b, b.capabilities.contextWindow, true);
      case "last_verified":
        return numeric(
          a.freshness.lastVerifiedAt ? Date.parse(a.freshness.lastVerifiedAt) : null,
          a,
          b,
          b.freshness.lastVerifiedAt ? Date.parse(b.freshness.lastVerifiedAt) : null,
          true,
        );
      case "provider":
      default:
        return byName(a, b);
    }
  });
}

function countBy<T>(
  entries: readonly ModelExplorerEntry[],
  pick: (entry: ModelExplorerEntry) => T | null,
): Map<T, number> {
  const counts = new Map<T, number>();
  for (const entry of entries) {
    const key = pick(entry);
    if (key === null) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Facet counts over the unfiltered set, so the UI can offer real choices. */
export function buildExplorerFacets(
  entries: readonly ModelExplorerEntry[],
): ModelExplorerFacets {
  const providerNames = new Map<string, string>();
  for (const entry of entries) {
    if (entry.provider.slug) providerNames.set(entry.provider.slug, entry.provider.name);
  }
  const providerCounts = countBy(entries, (entry) => entry.provider.slug || null);

  return {
    providers: [...providerCounts.entries()]
      .map(([slug, count]) => ({ slug, name: providerNames.get(slug) ?? slug, count }))
      .sort((a, b) => a.slug.localeCompare(b.slug)),
    lifecycleStates: [...countBy(entries, (entry) => entry.lifecycle.state).entries()]
      .map(([state, count]) => ({ state: state as LifecycleState, count }))
      .sort((a, b) => a.state.localeCompare(b.state)),
    families: [...countBy(entries, (entry) => entry.family).entries()]
      .map(([family, count]) => ({ family, count }))
      .sort((a, b) => a.family.localeCompare(b.family)),
    stages: [...countBy(entries, (entry) => entry.stage).entries()]
      .map(([stage, count]) => ({ stage, count }))
      .sort((a, b) => a.stage.localeCompare(b.stage)),
  };
}
