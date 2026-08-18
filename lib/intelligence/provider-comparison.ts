import type {
  ProviderComparisonResult,
  ProviderStats,
  RelativeDateRange,
  TemporalEvidence,
} from "./contracts";
import { resolveDateRange } from "./query-engine";

export interface CompareProvidersOptions {
  providers?: readonly string[];
  range?: RelativeDateRange;
  since?: string;
  until?: string;
  referenceDate?: string | Date;
}

export function compareProvidersOverPeriod(
  dataset: readonly TemporalEvidence[],
  options: CompareProvidersOptions = {},
): ProviderComparisonResult {
  const range = options.range ?? "30d";
  const { since, until } = resolveDateRange(
    range,
    options.since,
    options.until,
    options.referenceDate,
  );

  const targetProviders = options.providers?.length
    ? options.providers.map((p) => p.toLowerCase().trim())
    : ["anthropic", "google", "openai", "xai"];

  const filtered = dataset.filter((e) => {
    const evDate = new Date(e.observedAt);
    if (since && evDate < since) return false;
    if (until && evDate > until) return false;
    return targetProviders.includes(e.provider.toLowerCase());
  });

  const providerMap = new Map<string, ProviderStats>();

  for (const slug of targetProviders) {
    const providerName =
      slug === "anthropic"
        ? "Anthropic"
        : slug === "google"
          ? "Google"
          : slug === "openai"
            ? "OpenAI"
            : slug === "xai"
              ? "xAI"
              : slug.toUpperCase();

    providerMap.set(slug, {
      providerSlug: slug,
      providerName,
      totalEvents: 0,
      priceChanges: {
        reductions: 0,
        increases: 0,
        avgReductionPercent: null,
      },
      launches: [],
      deprecations: [],
      retirements: [],
      replacements: [],
      stabilityScore: 100,
    });
  }

  const reductionPercentsByProvider = new Map<string, number[]>();

  for (const event of filtered) {
    let stats = providerMap.get(event.provider.toLowerCase());
    if (!stats) {
      stats = {
        providerSlug: event.provider,
        providerName: event.providerName,
        totalEvents: 0,
        priceChanges: { reductions: 0, increases: 0, avgReductionPercent: null },
        launches: [],
        deprecations: [],
        retirements: [],
        replacements: [],
        stabilityScore: 100,
      };
      providerMap.set(event.provider.toLowerCase(), stats);
    }

    stats.totalEvents++;

    if (event.changeType === "price_decreased") {
      stats.priceChanges.reductions++;
      if (event.priceDelta?.percentChange !== null && event.priceDelta?.percentChange !== undefined) {
        const reductions = reductionPercentsByProvider.get(event.provider) ?? [];
        reductions.push(Math.abs(event.priceDelta.percentChange));
        reductionPercentsByProvider.set(event.provider, reductions);
      }
    } else if (event.changeType === "price_increased") {
      stats.priceChanges.increases++;
    } else if (event.changeType === "model_added") {
      if (!stats.launches.includes(event.model)) stats.launches.push(event.model);
    } else if (event.changeType === "deprecation_scheduled") {
      if (!stats.deprecations.includes(event.model)) stats.deprecations.push(event.model);
    } else if (
      event.changeType === "retirement_scheduled" ||
      event.changeType === "retirement_not_before_scheduled" ||
      (event.changeType === "lifecycle_transition" && event.currentValue === "retired")
    ) {
      if (!stats.retirements.includes(event.model)) stats.retirements.push(event.model);
    } else if (event.changeType === "replacement_recommended") {
      const repl = `${event.model} → ${String(event.currentValue)}`;
      if (!stats.replacements.includes(repl)) stats.replacements.push(repl);
    }
  }

  // Calculate average reductions & stability scores
  const highlights: string[] = [];
  const providersObj: Record<string, ProviderStats> = {};

  for (const [slug, stats] of providerMap.entries()) {
    const reductions = reductionPercentsByProvider.get(slug);
    if (reductions && reductions.length > 0) {
      const avg = reductions.reduce((sum, val) => sum + val, 0) / reductions.length;
      stats.priceChanges.avgReductionPercent = Number(avg.toFixed(1));
    }

    // Stability score formula: Starts at 100, drops by event volume and rapid changes
    const penalty = stats.priceChanges.reductions * 5 + stats.priceChanges.increases * 8 +
      stats.deprecations.length * 6 + stats.retirements.length * 10 + stats.launches.length * 4;
    stats.stabilityScore = Math.max(20, Math.min(100, 100 - penalty));

    providersObj[slug] = stats;

    if (stats.totalEvents > 0) {
      const parts: string[] = [];
      if (stats.launches.length > 0) parts.push(`${stats.launches.length} new model(s) added`);
      if (stats.priceChanges.reductions > 0) {
        parts.push(`${stats.priceChanges.reductions} price cut(s)${stats.priceChanges.avgReductionPercent ? ` (avg -${stats.priceChanges.avgReductionPercent}%)` : ""}`);
      }
      if (stats.deprecations.length > 0) parts.push(`${stats.deprecations.length} deprecation(s) scheduled`);
      if (stats.retirements.length > 0) parts.push(`${stats.retirements.length} retirement(s)`);

      highlights.push(`${stats.providerName}: ${parts.join(", ")} (${stats.totalEvents} total recorded changes).`);
    } else {
      highlights.push(`${stats.providerName}: No price or lifecycle changes recorded in this period.`);
    }
  }

  return {
    range,
    timeframe: {
      since: since ? since.toISOString() : "start of history",
      until: until ? until.toISOString() : "present",
    },
    providers: providersObj,
    comparisonHighlights: highlights,
    isDemoData: filtered.some((e) => e.isDemo),
  };
}
