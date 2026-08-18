import type {
  EvidenceBundle,
  EvidenceCategory,
  EvidenceMetrics,
  RelativeDateRange,
  TemporalEvidence,
  TemporalQuery,
  TimelineBucket,
} from "./contracts";
import { TemporalQuerySchema } from "./contracts";

export interface DateRangeBounds {
  since: Date | null;
  until: Date | null;
}

export function resolveDateRange(
  range: RelativeDateRange | undefined,
  sinceStr?: string,
  untilStr?: string,
  referenceDate?: string | Date,
): DateRangeBounds {
  const ref = referenceDate ? new Date(referenceDate) : new Date();
  const refTime = ref.getTime();

  if (sinceStr || untilStr) {
    return {
      since: sinceStr ? new Date(sinceStr) : null,
      until: untilStr ? new Date(untilStr) : null,
    };
  }

  const selectedRange = range ?? "30d";

  switch (selectedRange) {
    case "24h":
      return { since: new Date(refTime - 24 * 60 * 60 * 1000), until: ref };
    case "7d":
      return { since: new Date(refTime - 7 * 24 * 60 * 60 * 1000), until: ref };
    case "14d":
      return { since: new Date(refTime - 14 * 24 * 60 * 60 * 1000), until: ref };
    case "30d":
      return { since: new Date(refTime - 30 * 24 * 60 * 60 * 1000), until: ref };
    case "60d":
      return { since: new Date(refTime - 60 * 24 * 60 * 60 * 1000), until: ref };
    case "90d":
      return { since: new Date(refTime - 90 * 24 * 60 * 60 * 1000), until: ref };
    case "180d":
      return { since: new Date(refTime - 180 * 24 * 60 * 60 * 1000), until: ref };
    case "ytd": {
      const yearStart = new Date(Date.UTC(ref.getUTCFullYear(), 0, 1));
      return { since: yearStart, until: ref };
    }
    case "all":
      return { since: null, until: null };
    default:
      return { since: new Date(refTime - 30 * 24 * 60 * 60 * 1000), until: ref };
  }
}

export function normalizeProviderSlug(input: string): string {
  const clean = input.trim().toLowerCase();
  if (clean === "claude" || clean === "anthropic") return "anthropic";
  if (clean === "gemini" || clean === "google") return "google";
  if (clean === "openai" || clean === "gpt" || clean === "chatgpt") return "openai";
  if (clean === "xai" || clean === "grok") return "xai";
  return clean;
}

export function matchesProvider(
  evidenceProvider: string,
  queryProvider?: string | readonly string[],
): boolean {
  if (!queryProvider) return true;
  const providers = Array.isArray(queryProvider) ? queryProvider : [queryProvider];
  if (providers.length === 0 || providers.includes("all")) return true;

  const normalizedQuery = providers.map(normalizeProviderSlug);
  const normalizedEvidence = normalizeProviderSlug(evidenceProvider);
  return normalizedQuery.includes(normalizedEvidence);
}

export function matchesModelOrFamily(
  evidence: TemporalEvidence,
  queryModel?: string | readonly string[],
  queryFamily?: string,
): boolean {
  if (queryFamily) {
    const family = queryFamily.toLowerCase();
    const model = evidence.model.toLowerCase();
    const display = (evidence.displayName ?? "").toLowerCase();
    if (!model.includes(family) && !display.includes(family)) {
      return false;
    }
  }

  if (!queryModel) return true;
  const models = Array.isArray(queryModel) ? queryModel : [queryModel];
  if (models.length === 0) return true;

  return models.some((m) => {
    const clean = m.toLowerCase().trim();
    const evModel = evidence.model.toLowerCase();
    const evDisplay = (evidence.displayName ?? "").toLowerCase();
    return evModel === clean || evModel.includes(clean) || evDisplay.includes(clean);
  });
}

export function computeEvidenceMetrics(
  events: readonly TemporalEvidence[],
): EvidenceMetrics {
  let priceIncreases = 0;
  let priceDecreases = 0;
  let modelsAdded = 0;
  let modelsRemoved = 0;
  let lifecycleTransitions = 0;
  let deprecationsScheduled = 0;
  let retirementsScheduled = 0;
  let replacementsAnnounced = 0;

  const byProvider: EvidenceMetrics["byProvider"] = {};
  const byCategory: EvidenceMetrics["byCategory"] = {
    pricing: 0,
    lifecycle: 0,
    catalog: 0,
    deprecations: 0,
    retirements: 0,
    replacements: 0,
    metadata: 0,
  };

  for (const event of events) {
    if (event.changeType === "price_increased") priceIncreases++;
    if (event.changeType === "price_decreased") priceDecreases++;
    if (event.changeType === "model_added") modelsAdded++;
    if (event.changeType === "model_removed") modelsRemoved++;
    if (event.changeType === "lifecycle_transition") lifecycleTransitions++;
    if (event.changeType === "deprecation_scheduled") deprecationsScheduled++;
    if (
      event.changeType === "retirement_scheduled" ||
      event.changeType === "retirement_not_before_scheduled"
    ) {
      retirementsScheduled++;
    }
    if (event.changeType === "replacement_recommended") replacementsAnnounced++;

    byCategory[event.category] = (byCategory[event.category] ?? 0) + 1;

    const providerKey = event.provider;
    if (!byProvider[providerKey]) {
      byProvider[providerKey] = {
        providerName: event.providerName,
        total: 0,
        priceChanges: 0,
        lifecycleChanges: 0,
        additions: 0,
        removals: 0,
      };
    }
    byProvider[providerKey].total++;
    if (event.category === "pricing") byProvider[providerKey].priceChanges++;
    if (
      event.category === "lifecycle" ||
      event.category === "deprecations" ||
      event.category === "retirements" ||
      event.category === "replacements"
    ) {
      byProvider[providerKey].lifecycleChanges++;
    }
    if (event.changeType === "model_added") byProvider[providerKey].additions++;
    if (event.changeType === "model_removed") byProvider[providerKey].removals++;
  }

  return {
    totalEvents: events.length,
    priceIncreases,
    priceDecreases,
    modelsAdded,
    modelsRemoved,
    lifecycleTransitions,
    deprecationsScheduled,
    retirementsScheduled,
    replacementsAnnounced,
    byProvider,
    byCategory,
  };
}

export function buildTimelineBuckets(
  events: readonly TemporalEvidence[],
): TimelineBucket[] {
  const byDate = new Map<string, TemporalEvidence[]>();

  for (const event of events) {
    const dateStr = event.observedAt.slice(0, 10);
    const existing = byDate.get(dateStr) ?? [];
    existing.push(event);
    byDate.set(dateStr, existing);
  }

  const buckets: TimelineBucket[] = [];
  for (const [date, bucketEvents] of byDate.entries()) {
    buckets.push({
      date,
      count: bucketEvents.length,
      events: bucketEvents,
    });
  }

  return buckets.sort((a, b) => b.date.localeCompare(a.date));
}

export function buildDeltaSummary(events: readonly TemporalEvidence[]): string[] {
  return events.map((e) => {
    const date = e.observedAt.slice(0, 10);
    return `[${date}] [${e.providerName}] ${e.summary}`;
  });
}

/**
 * Executes a deterministic query against a list of TemporalEvidence items.
 */
export function executeTemporalQuery(
  dataset: readonly TemporalEvidence[],
  rawQuery: TemporalQuery = {},
): EvidenceBundle {
  const query = TemporalQuerySchema.parse(rawQuery);
  const { since, until } = resolveDateRange(
    query.range,
    query.since,
    query.until,
    query.referenceDate,
  );

  const minSignificance = query.significantOnly
    ? Math.max(query.minSignificance ?? 80, 80)
    : (query.minSignificance ?? 0);

  const filtered = dataset.filter((evidence) => {
    const evDate = new Date(evidence.observedAt);

    if (since && evDate < since) return false;
    if (until && evDate > until) return false;

    if (!matchesProvider(evidence.provider, query.provider)) return false;
    if (!matchesModelOrFamily(evidence, query.model, query.family)) return false;

    if (query.categories?.length && !query.categories.includes(evidence.category)) {
      return false;
    }

    if (query.types?.length && !query.types.includes(evidence.changeType)) {
      return false;
    }

    if (evidence.significanceScore < minSignificance) {
      return false;
    }

    return true;
  });

  // Deterministic sorting
  const isAsc = query.sort === "asc";
  const sorted = [...filtered].sort((left, right) => {
    const timeDiff = isAsc
      ? left.observedAt.localeCompare(right.observedAt)
      : right.observedAt.localeCompare(left.observedAt);
    if (timeDiff !== 0) return timeDiff;

    const providerDiff = left.provider.localeCompare(right.provider);
    if (providerDiff !== 0) return providerDiff;

    const modelDiff = left.model.localeCompare(right.model);
    if (modelDiff !== 0) return modelDiff;

    const typeDiff = left.changeType.localeCompare(right.changeType);
    if (typeDiff !== 0) return typeDiff;

    return left.id.localeCompare(right.id);
  });

  // Pagination
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 100;
  const paginated = sorted.slice(offset, offset + limit);

  const metrics = computeEvidenceMetrics(sorted);
  const timeline = buildTimelineBuckets(sorted);
  const deltaSummary = buildDeltaSummary(sorted);

  const hasDemo = sorted.some((e) => e.isDemo);

  return {
    query,
    generatedAt: new Date().toISOString(),
    totalEvents: sorted.length,
    events: paginated,
    metrics,
    timeline,
    deltaSummary,
    isDemoData: hasDemo,
  };
}

export interface ParsedNaturalQuery {
  provider?: string;
  family?: string;
  model?: string;
  range: RelativeDateRange;
  categories?: EvidenceCategory[];
  rawQuestion: string;
}

/**
 * Deterministically parses natural questions into structured query parameters.
 * E.g. "What changed in Claude this month?" -> { provider: "anthropic", family: "claude", range: "30d" }
 */
export function parseNaturalQuestion(question: string): ParsedNaturalQuery {
  const text = question.toLowerCase();
  let provider: string | undefined;
  let family: string | undefined;
  let model: string | undefined;
  let range: RelativeDateRange = "30d";
  const categories: EvidenceCategory[] = [];

  // Provider / Model family detection
  if (text.includes("claude") || text.includes("anthropic")) {
    provider = "anthropic";
    family = text.includes("claude") ? "claude" : undefined;
  } else if (text.includes("gemini") || text.includes("google")) {
    provider = "google";
    family = text.includes("gemini") ? "gemini" : undefined;
  } else if (text.includes("openai") || text.includes("gpt") || text.includes("chatgpt")) {
    provider = "openai";
    family = text.includes("gpt") ? "gpt" : undefined;
  } else if (text.includes("xai") || text.includes("grok")) {
    provider = "xai";
    family = text.includes("grok") ? "grok" : undefined;
  }

  // Specific model targets
  if (text.includes("sonnet")) model = "sonnet";
  if (text.includes("opus")) model = "opus";
  if (text.includes("haiku")) model = "haiku";
  if (text.includes("flash")) model = "flash";
  if (text.includes("gpt-4o")) model = "gpt-4o";

  // Date range detection
  if (text.includes("today") || text.includes("last 24") || text.includes("24h")) {
    range = "24h";
  } else if (text.includes("this week") || text.includes("last 7") || text.includes("7d") || text.includes("past week")) {
    range = "7d";
  } else if (text.includes("2 weeks") || text.includes("14d")) {
    range = "14d";
  } else if (text.includes("this month") || text.includes("last 30") || text.includes("30d") || text.includes("past month")) {
    range = "30d";
  } else if (text.includes("60 days") || text.includes("2 months")) {
    range = "60d";
  } else if (text.includes("90 days") || text.includes("quarter") || text.includes("3 months")) {
    range = "90d";
  } else if (text.includes("all time") || text.includes("history") || text.includes("ever")) {
    range = "all";
  }

  // Category intent detection
  if (text.includes("price") || text.includes("pricing") || text.includes("cost") || text.includes("rate") || text.includes("cheap")) {
    categories.push("pricing");
  }
  if (text.includes("deprecat") || text.includes("shutdown") || text.includes("retire") || text.includes("end of life") || text.includes("eol")) {
    categories.push("deprecations", "retirements");
  }
  if (text.includes("launch") || text.includes("new model") || text.includes("release") || text.includes("added")) {
    categories.push("catalog");
  }
  if (text.includes("replace") || text.includes("alternative") || text.includes("upgrade to")) {
    categories.push("replacements");
  }

  return {
    provider,
    family,
    model,
    range,
    categories: categories.length > 0 ? categories : undefined,
    rawQuestion: question,
  };
}
