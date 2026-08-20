/**
 * Expected collection cadence, resolved from configuration.
 *
 * The registry declares the cadence every fleet source runs at. The dashboard's
 * freshness panel needs the same number to say "collected 40m into a 360m
 * window", and it must be the *same* number — a second copy of "pricing is
 * hourly-ish" written next to the UI is how a screen starts lying.
 *
 * So the resolution lives here, in a leaf module with no collector imports, and
 * `registry.ts` builds its schedules from it. A read model can ask for a
 * cadence without pulling Bright Data clients and ingestion pipelines into its
 * import graph.
 */

import type { SourceCategory } from "../sources/types";
import type { CollectionSourceKey } from "./types";

/** Cadence defaults, per source family. Overridable per source by environment. */
export const CADENCE_DEFAULTS = {
  /** Pricing pages move slowly; six hours keeps cost and drift both low. */
  pricing: 360,
  /** Deprecation pages move more slowly still. */
  lifecycle: 720,
  /** Catalog pages move slowly; 12 hours keeps cost and drift both low. */
  catalog: 720,
} as const;

export function cadenceEnvKey(key: CollectionSourceKey, suffix: string): string {
  return `AI_RADAR_SOURCE_${key.replace(/-/g, "_").toUpperCase()}_${suffix}`;
}

export function readCadenceNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveCadenceMinutes(
  key: CollectionSourceKey,
  fallback: number,
): number {
  return readCadenceNumber(
    cadenceEnvKey(key, "CADENCE_MINUTES"),
    readCadenceNumber("AI_RADAR_COLLECTION_CADENCE_MINUTES", fallback),
  );
}

/** Registry key for a source, from what a read model actually knows about it. */
function cadenceKeyFor(
  category: SourceCategory,
  providerSlug: string,
): { key: CollectionSourceKey; fallback: number } | null {
  if (category === "pricing") {
    return { key: `${providerSlug}-pricing` as CollectionSourceKey, fallback: CADENCE_DEFAULTS.pricing };
  }
  if (category === "lifecycle") {
    return { key: `${providerSlug}-lifecycle` as CollectionSourceKey, fallback: CADENCE_DEFAULTS.lifecycle };
  }
  if (category === "models") {
    return { key: `${providerSlug}-catalog` as CollectionSourceKey, fallback: CADENCE_DEFAULTS.catalog };
  }
  return null;
}

/**
 * The cadence a source is expected to be collected at, or null when the source
 * is not on the fleet schedule at all. Null is a real answer — the self-healing
 * demo source is run by hand, so reporting an interval for it would be a
 * fabrication — and callers must omit the percentage rather than show zero.
 */
export function expectedCadenceMinutes(
  category: SourceCategory,
  providerSlug: string,
): number | null {
  const resolved = cadenceKeyFor(category, providerSlug);
  if (!resolved) return null;
  return resolveCadenceMinutes(resolved.key, resolved.fallback);
}
