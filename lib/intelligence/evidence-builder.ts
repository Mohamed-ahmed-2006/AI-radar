import type {
  AuthorityLevel,
  EvidenceCategory,
  PriceDelta,
  TemporalChangeType,
  TemporalEvidence,
} from "./contracts";
import type {
  ChangeEventRow,
  LatestLifecycleSnapshotRow,
  LatestPricingSnapshotRow,
  LifecycleSnapshotRow,
  PricingSnapshotRow,
  ProviderRow,
  SourceRow,
} from "../supabase/types";

export interface BuildEvidenceOptions {
  providers?: readonly ProviderRow[];
  sources?: readonly SourceRow[];
  pricingSnapshots?: readonly LatestPricingSnapshotRow[] | readonly PricingSnapshotRow[];
  lifecycleSnapshots?: readonly LatestLifecycleSnapshotRow[] | readonly LifecycleSnapshotRow[];
  modelNamesById?: ReadonlyMap<string, string>;
  providerSlugsById?: ReadonlyMap<string, string>;
  providerNamesById?: ReadonlyMap<string, string>;
  /** Bright Data run ids keyed by collection run id, for run-level provenance. */
  externalRunIdsByRunId?: ReadonlyMap<string, string | null>;
}

function calculatePriceDelta(
  oldVal: unknown,
  newVal: unknown,
  field: string,
  unit = "USD per 1M tokens",
): PriceDelta | null {
  const previous = typeof oldVal === "number" ? oldVal : null;
  const current = typeof newVal === "number" ? newVal : null;
  if (previous === null || current === null) return null;

  const absoluteChange = Number((current - previous).toFixed(6));
  const percentChange = previous !== 0
    ? Number((((current - previous) / previous) * 100).toFixed(2))
    : null;

  return {
    previousPrice: previous,
    currentPrice: current,
    absoluteChange,
    percentChange,
    unit,
    field,
  };
}

export function classifyChangeTypeAndCategory(
  rawChangeType: string,
  fieldName: string | null,
): { changeType: TemporalChangeType; category: EvidenceCategory } {
  if (rawChangeType === "price_increased") {
    return { changeType: "price_increased", category: "pricing" };
  }
  if (rawChangeType === "price_decreased") {
    return { changeType: "price_decreased", category: "pricing" };
  }
  if (rawChangeType === "model_added") {
    return { changeType: "model_added", category: "catalog" };
  }
  if (rawChangeType === "model_removed") {
    return { changeType: "model_removed", category: "catalog" };
  }

  if (rawChangeType === "lifecycle_changed") {
    if (fieldName === "deprecatedDate" || fieldName === "deprecated_on") {
      return { changeType: "deprecation_scheduled", category: "deprecations" };
    }
    if (fieldName === "retirementDate" || fieldName === "retirement_date") {
      return { changeType: "retirement_scheduled", category: "retirements" };
    }
    if (
      fieldName === "retirementNotBeforeDate" ||
      fieldName === "retirement_not_before_date"
    ) {
      return {
        changeType: "retirement_not_before_scheduled",
        category: "retirements",
      };
    }
    if (
      fieldName === "recommendedReplacement" ||
      fieldName === "recommended_replacement"
    ) {
      return {
        changeType: "replacement_recommended",
        category: "replacements",
      };
    }
    return { changeType: "lifecycle_transition", category: "lifecycle" };
  }

  if (rawChangeType === "metadata_changed") {
    return { changeType: "metadata_changed", category: "metadata" };
  }

  return { changeType: "metadata_changed", category: "metadata" };
}

export function calculateSignificanceScore(
  changeType: TemporalChangeType,
  category: EvidenceCategory,
  priceDelta: PriceDelta | null,
  modelName: string,
): number {
  const lowerModel = modelName.toLowerCase();
  const isFlagship =
    lowerModel.includes("sonnet") ||
    lowerModel.includes("opus") ||
    lowerModel.includes("gpt-4") ||
    lowerModel.includes("pro") ||
    lowerModel.includes("grok-2");

  if (changeType === "model_added") {
    return isFlagship ? 95 : 85;
  }

  if (changeType === "lifecycle_transition") {
    return 90;
  }

  if (changeType === "retirement_scheduled" || changeType === "retirement_not_before_scheduled") {
    return isFlagship ? 88 : 80;
  }

  if (changeType === "deprecation_scheduled") {
    return isFlagship ? 85 : 75;
  }

  if (changeType === "replacement_recommended") {
    return 82;
  }

  if (priceDelta && priceDelta.percentChange !== null) {
    const absPercent = Math.abs(priceDelta.percentChange);
    if (absPercent >= 50) return 92;
    if (absPercent >= 20) return 82;
    if (absPercent >= 10) return 70;
    return 55;
  }

  if (category === "pricing") return 65;
  if (changeType === "model_removed") return 75;

  return 50;
}

export function generateDeterministicSummary(
  modelName: string,
  changeType: TemporalChangeType,
  field: string | null,
  previousValue: unknown,
  currentValue: unknown,
  priceDelta: PriceDelta | null,
  providerName: string,
): string {
  if (changeType === "model_added") {
    return `${modelName} was added to ${providerName}'s catalog.`;
  }
  if (changeType === "model_removed") {
    return `${modelName} was removed from ${providerName}'s catalog.`;
  }
  if (changeType === "price_decreased" && priceDelta) {
    const pct = priceDelta.percentChange !== null ? `${Math.abs(priceDelta.percentChange)}%` : "";
    const pctPart = pct ? ` (${pct} reduction)` : "";
    return `${modelName} ${priceDelta.field} reduced from $${priceDelta.previousPrice} to $${priceDelta.currentPrice} / 1M tokens${pctPart}.`;
  }
  if (changeType === "price_increased" && priceDelta) {
    const pct = priceDelta.percentChange !== null ? `${priceDelta.percentChange}%` : "";
    const pctPart = pct ? ` (${pct} increase)` : "";
    return `${modelName} ${priceDelta.field} increased from $${priceDelta.previousPrice} to $${priceDelta.currentPrice} / 1M tokens${pctPart}.`;
  }
  if (changeType === "lifecycle_transition") {
    return `${modelName} transitioned lifecycle state from ${String(previousValue)} to ${String(currentValue)}.`;
  }
  if (changeType === "deprecation_scheduled") {
    return `${modelName} scheduled for deprecation effective ${String(currentValue)}.`;
  }
  if (changeType === "retirement_scheduled") {
    return `${modelName} scheduled for retirement on ${String(currentValue)}.`;
  }
  if (changeType === "retirement_not_before_scheduled") {
    return `${modelName} shutdown scheduled not sooner than ${String(currentValue)}.`;
  }
  if (changeType === "replacement_recommended") {
    return `${modelName} recommended replacement designated as ${String(currentValue)}.`;
  }
  if (changeType === "metadata_changed" && field) {
    return `${modelName} ${field} updated from ${String(previousValue)} to ${String(currentValue)}.`;
  }

  return `${modelName} updated in ${providerName}.`;
}

/**
 * Transforms a single database ChangeEventRow into a structured TemporalEvidence item.
 */
export function transformChangeEventToEvidence(
  row: ChangeEventRow,
  options: BuildEvidenceOptions = {},
): TemporalEvidence {
  const providerSlug =
    options.providerSlugsById?.get(row.provider_id) ??
    (row.provider_id.includes("anthropic")
      ? "anthropic"
      : row.provider_id.includes("google")
        ? "google"
        : row.provider_id.includes("openai")
          ? "openai"
          : row.provider_id.includes("xai")
            ? "xai"
            : "unknown");

  const providerName =
    options.providerNamesById?.get(row.provider_id) ??
    (providerSlug === "anthropic"
      ? "Anthropic"
      : providerSlug === "google"
        ? "Google"
        : providerSlug === "openai"
          ? "OpenAI"
          : providerSlug === "xai"
            ? "xAI"
            : providerSlug);

  const modelName =
    (row.model_id ? options.modelNamesById?.get(row.model_id) : null) ??
    (typeof row.new_value === "string" ? row.new_value : row.model_id ?? "unknown-model");

  const { changeType, category } = classifyChangeTypeAndCategory(
    row.change_type,
    row.field_name,
  );

  const priceDelta =
    category === "pricing" && row.field_name
      ? calculatePriceDelta(row.old_value, row.new_value, row.field_name)
      : null;

  const significanceScore = calculateSignificanceScore(
    changeType,
    category,
    priceDelta,
    modelName,
  );

  const summary =
    row.summary ??
    generateDeterministicSummary(
      modelName,
      changeType,
      row.field_name,
      row.old_value,
      row.new_value,
      priceDelta,
      providerName,
    );

  const authority: AuthorityLevel =
    category === "lifecycle" || category === "deprecations" || category === "retirements"
      ? "authoritative"
      : "verified_scrape";

  const sourceUrl =
    options.sources?.find((s) => s.id === row.source_id)?.source_url ??
    (providerSlug === "anthropic"
      ? "https://www.anthropic.com/pricing"
      : providerSlug === "google"
        ? "https://ai.google.dev/pricing"
        : providerSlug === "openai"
          ? "https://openai.com/api/pricing/"
          : "https://x.ai/api");

  const collectorId = options.sources?.find((s) => s.id === row.source_id)?.collector_id ?? null;

  return {
    id: row.id,
    provider: providerSlug,
    providerName,
    model: modelName,
    displayName: modelName,
    changeType,
    category,
    field: row.field_name,
    pricingMode: row.pricing_mode,
    contextTier: row.context_tier,
    previousValue: (row.old_value ?? null) as string | number | boolean | null | Record<string, unknown>,
    currentValue: (row.new_value ?? null) as string | number | boolean | null | Record<string, unknown>,
    priceDelta,
    observedAt: row.detected_at,
    source: {
      url: sourceUrl,
      sourceId: row.source_id,
      collectorId,
      kind: category === "pricing" ? "pricing" : "models",
      label: `${providerName} ${category}`,
    },
    provenance: {
      runId: row.run_id,
      externalRunId: options.externalRunIdsByRunId?.get(row.run_id ?? "") ?? null,
      previousSnapshotId: row.previous_snapshot_id,
      currentSnapshotId: row.current_snapshot_id,
      previousLifecycleSnapshotId: row.previous_lifecycle_snapshot_id,
      currentLifecycleSnapshotId: row.current_lifecycle_snapshot_id,
    },
    authority,
    confidence: authority === "authoritative" ? 1.0 : 0.95,
    significanceScore,
    summary,
    isDemo: false,
  };
}

/**
 * Transforms an array of database change event rows into TemporalEvidence items.
 */
export function transformChangeEventsToEvidence(
  rows: readonly ChangeEventRow[],
  options: BuildEvidenceOptions = {},
): TemporalEvidence[] {
  return rows.map((row) => transformChangeEventToEvidence(row, options));
}
