/**
 * Raw observation → canonical value evidence.
 *
 * A snapshot row already *is* the normalized value; what a reader cannot see
 * from it is which part of the collector payload produced it. This module pairs
 * each canonical column with the raw key it was derived from, matching keys
 * structurally (case, separators and common provider spellings are ignored) so
 * the mapping keeps working when a collector renames `inputPrice` to
 * `input_price_per_1m_tokens`.
 *
 * Raw values are sanitized and truncated on the way out. The purpose is to show
 * how a value came to be trusted, not to republish the collector payload.
 */

import type { LifecycleSnapshotRow, PricingSnapshotRow } from "../supabase/types";
import { safeSourceUrl, sanitizeRawValue } from "./sanitize";
import type { SourceTransformationView, TransformationFieldView } from "./types";

/** Key comparison ignores case and every non-alphanumeric separator. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

type RawRecord = Record<string, unknown>;

/**
 * The `raw` column holds whatever the collector returned for one record. It may
 * be an object, an array of one record, or absent entirely.
 */
function asRawRecord(raw: unknown): RawRecord | null {
  if (Array.isArray(raw)) return asRawRecord(raw[0]);
  if (raw && typeof raw === "object") return raw as RawRecord;
  return null;
}

function findRawEntry(
  raw: RawRecord | null,
  aliases: readonly string[],
): { key: string; value: unknown } | null {
  if (!raw) return null;
  const wanted = aliases.map(normalizeKey);
  for (const alias of wanted) {
    for (const [key, value] of Object.entries(raw)) {
      if (normalizeKey(key) === alias) return { key, value };
    }
  }
  return null;
}

interface FieldSpec {
  normalizedField: string;
  aliases: readonly string[];
  normalizedValue: string | number | boolean | null;
}

function buildFields(
  raw: RawRecord | null,
  specs: readonly FieldSpec[],
): TransformationFieldView[] {
  return specs.map((spec) => {
    const entry = findRawEntry(raw, spec.aliases);
    return {
      rawField: entry?.key ?? null,
      rawValue: entry ? sanitizeRawValue(entry.value) : null,
      normalizedField: spec.normalizedField,
      normalizedValue: spec.normalizedValue,
      derivation: entry ? "mapped" : "derived",
    };
  });
}

export function buildPricingTransformation(
  snapshot: PricingSnapshotRow,
  modelName: string | null,
): SourceTransformationView {
  const raw = asRawRecord(snapshot.raw);

  const fields = buildFields(raw, [
    {
      normalizedField: "modelName",
      aliases: ["model_name", "model", "name", "modelId"],
      normalizedValue: modelName,
    },
    {
      normalizedField: "pricingMode",
      aliases: ["pricing_mode", "mode"],
      normalizedValue: snapshot.pricing_mode,
    },
    {
      normalizedField: "contextTier",
      aliases: ["context_tier", "context", "tier", "context_window"],
      normalizedValue: snapshot.context_tier,
    },
    {
      normalizedField: "inputPricePer1MTokens",
      aliases: [
        "input_price_per_1m_tokens",
        "input_price",
        "input",
        "input_cost",
        "price_input",
      ],
      normalizedValue: snapshot.input_price_per_1m_tokens,
    },
    {
      normalizedField: "cachedInputPricePer1MTokens",
      aliases: [
        "cached_input_price_per_1m_tokens",
        "cached_input_price",
        "cached_input",
        "cache_read",
      ],
      normalizedValue: snapshot.cached_input_price_per_1m_tokens,
    },
    {
      normalizedField: "cacheWritePricePer1MTokens",
      aliases: [
        "cache_write_price_per_1m_tokens",
        "cache_write_price",
        "cache_write",
      ],
      normalizedValue: snapshot.cache_write_price_per_1m_tokens,
    },
    {
      normalizedField: "outputPricePer1MTokens",
      aliases: [
        "output_price_per_1m_tokens",
        "output_price",
        "output",
        "output_cost",
        "price_output",
      ],
      normalizedValue: snapshot.output_price_per_1m_tokens,
    },
    {
      normalizedField: "currency",
      aliases: ["currency"],
      normalizedValue: snapshot.currency,
    },
    {
      normalizedField: "pricingUnit",
      aliases: ["pricing_unit", "unit"],
      normalizedValue: snapshot.pricing_unit,
    },
    {
      normalizedField: "sourceUrl",
      aliases: ["source_url", "url", "page_url"],
      normalizedValue: safeSourceUrl(snapshot.source_url),
    },
    {
      normalizedField: "observedAt",
      aliases: ["observed_at", "timestamp", "collected_at"],
      normalizedValue: snapshot.observed_at,
    },
  ]);

  return {
    snapshotId: snapshot.id,
    runId: snapshot.run_id,
    observedAt: snapshot.observed_at,
    modelId: snapshot.model_id,
    modelName,
    fields,
  };
}

export function buildLifecycleTransformation(
  snapshot: LifecycleSnapshotRow,
  modelName: string | null,
): SourceTransformationView {
  const raw = asRawRecord(snapshot.raw);

  const fields = buildFields(raw, [
    {
      normalizedField: "apiModelId",
      aliases: ["api_model_id", "api_model_name", "model_id", "model"],
      normalizedValue: snapshot.api_model_id,
    },
    {
      normalizedField: "lifecycleState",
      aliases: ["lifecycle_state", "current_state", "state", "model_stage", "stage"],
      normalizedValue: snapshot.lifecycle_state,
    },
    {
      normalizedField: "deprecatedOn",
      aliases: ["deprecated_on", "deprecation_date", "deprecated"],
      normalizedValue: snapshot.deprecated_on,
    },
    {
      normalizedField: "retirementDate",
      aliases: ["retirement_date", "retirement", "shutdown_date", "retired_on"],
      normalizedValue: snapshot.retirement_date,
    },
    {
      normalizedField: "retirementNotBeforeDate",
      aliases: [
        "retirement_not_before_date",
        "retirement_not_before",
        "not_before",
      ],
      normalizedValue: snapshot.retirement_not_before_date,
    },
    {
      normalizedField: "retirementNotBeforeObservation",
      aliases: ["retirement_not_before_observation"],
      normalizedValue: snapshot.retirement_not_before_observation,
    },
    {
      normalizedField: "recommendedReplacement",
      aliases: [
        "recommended_replacement",
        "replacement",
        "recommended_model",
        "replacement_model",
      ],
      normalizedValue: snapshot.recommended_replacement,
    },
    {
      normalizedField: "sourceUrl",
      aliases: ["source_url", "product_page_url", "url"],
      normalizedValue: safeSourceUrl(snapshot.source_url),
    },
    {
      normalizedField: "observedAt",
      aliases: ["observed_at", "timestamp", "collected_at"],
      normalizedValue: snapshot.observed_at,
    },
  ]);

  return {
    snapshotId: snapshot.id,
    runId: snapshot.run_id,
    observedAt: snapshot.observed_at,
    modelId: snapshot.model_id,
    modelName,
    fields,
  };
}
