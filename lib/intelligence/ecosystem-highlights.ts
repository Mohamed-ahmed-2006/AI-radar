import type {
  EcosystemSignificanceItem,
  EcosystemSignificanceSummary,
  RelativeDateRange,
  TemporalEvidence,
} from "./contracts";
import { resolveDateRange } from "./query-engine";

export interface SignificantChangesOptions {
  range?: RelativeDateRange;
  since?: string;
  until?: string;
  limit?: number;
  minScore?: number;
  referenceDate?: string | Date;
}

function deriveImpactReason(event: TemporalEvidence): string {
  if (event.changeType === "model_added") {
    return "New model release introduced to provider catalog";
  }
  if (event.changeType === "price_decreased" && event.priceDelta?.percentChange) {
    return `Major price reduction of ${Math.abs(event.priceDelta.percentChange)}% on ${event.priceDelta.field}`;
  }
  if (event.changeType === "price_increased" && event.priceDelta?.percentChange) {
    return `Price increase of ${event.priceDelta.percentChange}% on ${event.priceDelta.field}`;
  }
  if (event.changeType === "lifecycle_transition" && event.currentValue === "retired") {
    return "Model lifecycle officially shut down / retired";
  }
  if (event.changeType === "retirement_scheduled" || event.changeType === "retirement_not_before_scheduled") {
    return `Retirement date scheduled for ${String(event.currentValue)}`;
  }
  if (event.changeType === "deprecation_scheduled") {
    return `Deprecation announced with effective date ${String(event.currentValue)}`;
  }
  if (event.changeType === "replacement_recommended") {
    return `Migration path designated to ${String(event.currentValue)}`;
  }
  return "Significant operational update observed";
}

export function extractMostSignificantChanges(
  dataset: readonly TemporalEvidence[],
  options: SignificantChangesOptions = {},
): EcosystemSignificanceSummary {
  const range = options.range ?? "30d";
  const limit = options.limit ?? 10;
  const minScore = options.minScore ?? 75;
  const { since, until } = resolveDateRange(
    range,
    options.since,
    options.until,
    options.referenceDate,
  );

  const filtered = dataset.filter((e) => {
    const evDate = new Date(e.observedAt);
    if (since && evDate < since) return false;
    if (until && evDate > until) return false;
    return e.significanceScore >= minScore;
  });

  const sorted = [...filtered].sort((a, b) => {
    const scoreDiff = b.significanceScore - a.significanceScore;
    if (scoreDiff !== 0) return scoreDiff;
    return b.observedAt.localeCompare(a.observedAt);
  });

  const topChanges: EcosystemSignificanceItem[] = sorted.slice(0, limit).map((event) => ({
    ...event,
    impactReason: deriveImpactReason(event),
  }));

  const priceCuts = topChanges.filter((c) => c.changeType === "price_decreased").length;
  const launches = topChanges.filter((c) => c.changeType === "model_added").length;
  const deprecations = topChanges.filter(
    (c) => c.changeType === "deprecation_scheduled" || c.changeType === "retirement_scheduled" || c.changeType === "lifecycle_transition",
  ).length;

  const headline = topChanges.length > 0
    ? `Identified ${topChanges.length} high-impact changes across AI providers in the last ${range}: ${launches} launches, ${priceCuts} major price cuts, and ${deprecations} lifecycle events.`
    : `No high-significance ecosystem changes detected in the last ${range}.`;

  return {
    range,
    timeframe: {
      since: since ? since.toISOString() : "start of history",
      until: until ? until.toISOString() : "present",
    },
    topChanges,
    headline,
    isDemoData: topChanges.some((e) => e.isDemo),
  };
}
