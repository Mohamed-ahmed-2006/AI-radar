/**
 * Sentinel Generic Source Health Contracts & Factory
 */

import {
  RawBrightDataPricingRecordSchema,
  pricingRecordIdentity,
  type RawBrightDataPricingRecord,
  RawAnthropicLifecycleRecordSchema,
  type RawAnthropicLifecycleRecord,
  RawGeminiLifecycleRecordSchema,
  type RawGeminiLifecycleRecord,
  RawOpenAiCatalogRecordSchema,
  type RawOpenAiCatalogRecord,
  RawAnthropicCatalogRecordSchema,
  type RawAnthropicCatalogRecord,
  RawGeminiCatalogRecordSchema,
  type RawGeminiCatalogRecord,
  RawXaiCatalogRecordSchema,
  type RawXaiCatalogRecord,
  type CatalogProviderSlug,
  normalizeExactTokenCount,
  normalizeModalities,
} from "../contracts";

/**
 * The language a documentation URL was rendered in, when it names one.
 *
 * Returns null for a canonical URL, so "no locale" and "locale we happen to
 * expect" cannot be confused: any `hl` at all means the page was translated.
 */
/**
 * True when a stored capability observation would be refused by the catalog
 * contract as it stands today.
 *
 * The single admissibility rule every judge-facing surface shares. Only the
 * *lookup* differs between surfaces — the Change Feed resolves the snapshot by
 * id, Model Detail already holds the capability history — and this is the test
 * all of them apply once they have the raw evidence in hand.
 */
export function isInadmissibleCapabilityEvidence(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const sourceUrl = (raw as { source_url?: unknown }).source_url;
  return localeQueryParameter(typeof sourceUrl === "string" ? sourceUrl : undefined) !== null;
}

export function localeQueryParameter(sourceUrl: string | undefined): string | null {
  if (!sourceUrl) return null;
  try {
    return new URL(sourceUrl).searchParams.get("hl");
  } catch {
    return null;
  }
}
import { PRICING_PROVIDERS, type PricingProviderSlug } from "../pipeline/providers";
import type {
  SourceHealthContract,
  SemanticInvariantCheckResult,
} from "./types";

/**
 * Creates a generic SourceHealthContract with sensible defaults.
 */
export function createSourceHealthContract<T = unknown>(
  definition: SourceHealthContract<T>,
): SourceHealthContract<T> {
  return {
    ...definition,
    failurePolicy: {
      maxHealingAttempts: definition.failurePolicy?.maxHealingAttempts ?? 3,
      autoHeal: definition.failurePolicy?.autoHeal ?? true,
      quarantineThresholdPercentage:
        definition.failurePolicy?.quarantineThresholdPercentage ?? 0.1,
    },
    recordCountDrift: {
      minExpectedCount: definition.recordCountDrift?.minExpectedCount ?? 1,
      maxDropPercentage: definition.recordCountDrift?.maxDropPercentage ?? 0.35,
      maxSpikePercentage: definition.recordCountDrift?.maxSpikePercentage ?? 3.0,
    },
    sourceFreshness: {
      maxStalenessMinutes: definition.sourceFreshness?.maxStalenessMinutes ?? 1440, // 24 hours
    },
  };
}

/** The provider/domain pair a health contract is chosen by. */
export type SourceHealthContractTarget =
  | { domain: "pricing"; providerSlug: PricingProviderSlug }
  | { domain: "lifecycle"; providerSlug: "anthropic" | "gemini" }
  | { domain: "catalog"; providerSlug: CatalogProviderSlug };

/**
 * Single resolution point from a configured source to its health contract, so
 * the ingestion pipelines and the collection orchestrator can never disagree
 * about which contract governs a source.
 */
export function createSourceHealthContractFor(
  target: SourceHealthContractTarget,
  sourceId: string,
): SourceHealthContract<unknown> {
  if (target.domain === "pricing") {
    return createPricingSourceHealthContract(
      target.providerSlug,
      sourceId,
    ) as SourceHealthContract<unknown>;
  }
  if (target.domain === "catalog") {
    return createCatalogSourceHealthContract(
      target.providerSlug,
      sourceId,
    ) as SourceHealthContract<unknown>;
  }
  return (
    target.providerSlug === "anthropic"
      ? createAnthropicLifecycleSourceHealthContract(sourceId)
      : createGeminiLifecycleSourceHealthContract(sourceId)
  ) as SourceHealthContract<unknown>;
}


/**
 * Factory for pricing source contracts across all supported providers (OpenAI, Anthropic, Gemini, xAI).
 */
export function createPricingSourceHealthContract(
  providerSlug: PricingProviderSlug,
  sourceId = `pricing-${providerSlug}`,
): SourceHealthContract<RawBrightDataPricingRecord> {
  const providerDef = PRICING_PROVIDERS[providerSlug];
  const expectedProviderName = providerDef ? providerDef.name : providerSlug;

  return createSourceHealthContract<RawBrightDataPricingRecord>({
    sourceId,
    sourceCategory: "pricing",
    authorityDomain: "pricing",
    isAuthoritative: false, // Pricing is never authoritative for model inventory/retirement
    requiredFields: [
      "provider",
      "model_name",
      "pricing_mode",
      "context_tier",
      "pricing_unit",
      "source_url",
    ],
    expectedEnumDomains: {
      pricingUnit: ["USD per 1M tokens", "USD", "tokens"],
    },
    minViableRecords: 1,
    recordCountDrift: {
      minExpectedCount: 2,
      maxDropPercentage: 0.4, // >40% sudden drop triggers collapse
      maxSpikePercentage: 3.0, // >300% sudden increase triggers spike
    },
    sourceFreshness: {
      maxStalenessMinutes: 1440,
    },
    failurePolicy: {
      maxHealingAttempts: 3,
      autoHeal: true,
      quarantineThresholdPercentage: 0.15, // >15% invalid records quarantines
    },
    extractKey: (record) =>
      pricingRecordIdentity({
        provider: record.provider,
        modelName: record.model_name,
        pricingMode: record.pricing_mode,
        contextTier: record.context_tier,
      }),
    validateRecord: (raw) => {
      try {
        const adapted = providerDef
          ? providerDef.adapt(raw, providerDef.defaultSourceUrl)
          : raw;
        const result = RawBrightDataPricingRecordSchema.safeParse(adapted);
        if (!result.success) {
          return {
            success: false,
            issues: result.error.issues.map(
              (issue) => `[${issue.path.join(".") || "root"}] ${issue.message}`,
            ),
          };
        }
        if (result.data.provider !== expectedProviderName) {
          return {
            success: false,
            issues: [
              `Expected provider '${expectedProviderName}', got '${result.data.provider}'`,
            ],
          };
        }
        return {
          success: true,
          data: result.data,
        };
      } catch (err) {
        return {
          success: false,
          issues: [err instanceof Error ? err.message : String(err)],
        };
      }
    },
    validateSemanticInvariants: (records): SemanticInvariantCheckResult[] => {
      const results: SemanticInvariantCheckResult[] = [];
      if (records.length === 0) return results;

      // Invariant 1: Not all records may have all prices null
      const allPricesNull = records.every(
        (r) =>
          r.input_price_per_1m_tokens == null &&
          r.cached_input_price_per_1m_tokens == null &&
          r.cache_write_price_per_1m_tokens == null &&
          r.output_price_per_1m_tokens == null,
      );

      if (allPricesNull) {
        results.push({
          passed: false,
          code: "ALL_PRICES_NULL",
          reason: "All pricing records in candidate dataset have null prices.",
        });
      }

      // Invariant 2: No negative prices
      const hasNegative = records.some((r) => {
        const p1 = r.input_price_per_1m_tokens ?? 0;
        const p2 = r.cached_input_price_per_1m_tokens ?? 0;
        const p3 = r.cache_write_price_per_1m_tokens ?? 0;
        const p4 = r.output_price_per_1m_tokens ?? 0;
        return p1 < 0 || p2 < 0 || p3 < 0 || p4 < 0;
      });

      if (hasNegative) {
        results.push({
          passed: false,
          code: "SEMANTIC_INVARIANT_VIOLATION",
          reason: "One or more pricing records contain negative price values.",
        });
      }

      return results;
    },
  });
}

/**
 * Factory for Anthropic authoritative lifecycle contract.
 */
export function createAnthropicLifecycleSourceHealthContract(
  sourceId = "lifecycle-anthropic",
): SourceHealthContract<RawAnthropicLifecycleRecord> {
  return createSourceHealthContract<RawAnthropicLifecycleRecord>({
    sourceId,
    sourceCategory: "lifecycle",
    authorityDomain: "lifecycle",
    isAuthoritative: true, // Authoritative lifecycle intelligence
    requiredFields: [
      "product_page_url",
      "api_model_name",
      "current_state",
    ],
    expectedEnumDomains: {
      current_state: ["Active", "Legacy", "Deprecated", "Retired"],
    },
    minViableRecords: 2,
    recordCountDrift: {
      minExpectedCount: 2,
      maxDropPercentage: 0.35,
      maxSpikePercentage: 3.0,
    },
    sourceFreshness: {
      maxStalenessMinutes: 1440,
    },
    failurePolicy: {
      maxHealingAttempts: 3,
      autoHeal: true,
      quarantineThresholdPercentage: 0.0, // Strict: any malformed lifecycle record triggers quarantine
    },
    extractKey: (record) => record.api_model_name,
    validateRecord: (raw) => {
      try {
        const result = RawAnthropicLifecycleRecordSchema.safeParse(raw);
        if (!result.success) {
          return {
            success: false,
            issues: result.error.issues.map(
              (issue) => `[${issue.path.join(".") || "root"}] ${issue.message}`,
            ),
          };
        }
        return {
          success: true,
          data: result.data,
        };
      } catch (err) {
        return {
          success: false,
          issues: [err instanceof Error ? err.message : String(err)],
        };
      }
    },
    validateSemanticInvariants: (records): SemanticInvariantCheckResult[] => {
      const results: SemanticInvariantCheckResult[] = [];
      if (records.length === 0) return results;

      // Invariant: At least one Active model must exist
      const hasActive = records.some((r) => r.current_state === "Active");
      if (!hasActive) {
        results.push({
          passed: false,
          code: "SEMANTIC_INVARIANT_VIOLATION",
          reason: "Authoritative lifecycle snapshot contains zero Active models.",
        });
      }

      return results;
    },
  });
}

/**
 * Factory for Gemini authoritative lifecycle contract.
 */
export function createGeminiLifecycleSourceHealthContract(
  sourceId = "lifecycle-gemini",
): SourceHealthContract<RawGeminiLifecycleRecord> {
  return createSourceHealthContract<RawGeminiLifecycleRecord>({
    sourceId,
    sourceCategory: "lifecycle",
    authorityDomain: "lifecycle",
    isAuthoritative: true,
    requiredFields: [
      "model_id",
      "model_stage",
      "is_shutdown",
    ],
    minViableRecords: 2,
    recordCountDrift: {
      minExpectedCount: 2,
      maxDropPercentage: 0.35,
      maxSpikePercentage: 3.0,
    },
    sourceFreshness: {
      maxStalenessMinutes: 1440,
    },
    failurePolicy: {
      maxHealingAttempts: 3,
      autoHeal: true,
      quarantineThresholdPercentage: 0.0,
    },
    extractKey: (record) => record.model_id,
    validateRecord: (raw) => {
      try {
        const result = RawGeminiLifecycleRecordSchema.safeParse(raw);
        if (!result.success) {
          return {
            success: false,
            issues: result.error.issues.map(
              (issue) => `[${issue.path.join(".") || "root"}] ${issue.message}`,
            ),
          };
        }
        return {
          success: true,
          data: result.data,
        };
      } catch (err) {
        return {
          success: false,
          issues: [err instanceof Error ? err.message : String(err)],
        };
      }
    },
  });
}

/**
 * Factory for OpenAI model catalog health contract.
 */
export function createOpenAiCatalogSourceHealthContract(
  sourceId = "catalog-openai",
): SourceHealthContract<RawOpenAiCatalogRecord> {
  return createSourceHealthContract<RawOpenAiCatalogRecord>({
    sourceId,
    sourceCategory: "models",
    authorityDomain: "catalog",
    isAuthoritative: true,
    requiredFields: ["model_id"],
    minViableRecords: 1,
    recordCountDrift: {
      minExpectedCount: 1,
      maxDropPercentage: 0.4,
      maxSpikePercentage: 3.0,
    },
    sourceFreshness: {
      maxStalenessMinutes: 1440,
    },
    failurePolicy: {
      maxHealingAttempts: 3,
      autoHeal: true,
      quarantineThresholdPercentage: 0.15,
    },
    extractKey: (record) => record.model_id,
    validateRecord: (raw) => {
      try {
        const result = RawOpenAiCatalogRecordSchema.safeParse(raw);
        if (!result.success) {
          return {
            success: false,
            issues: result.error.issues.map(
              (issue) => `[${issue.path.join(".") || "root"}] ${issue.message}`,
            ),
          };
        }
        return { success: true, data: result.data };
      } catch (err) {
        return { success: false, issues: [err instanceof Error ? err.message : String(err)] };
      }
    },
  });
}

/**
 * Factory for Anthropic model catalog health contract.
 */
export function createAnthropicCatalogSourceHealthContract(
  sourceId = "catalog-anthropic",
): SourceHealthContract<RawAnthropicCatalogRecord> {
  return createSourceHealthContract<RawAnthropicCatalogRecord>({
    sourceId,
    sourceCategory: "models",
    authorityDomain: "catalog",
    isAuthoritative: true,
    requiredFields: ["api_model_id"],
    minViableRecords: 1,
    recordCountDrift: {
      minExpectedCount: 1,
      maxDropPercentage: 0.4,
      maxSpikePercentage: 3.0,
    },
    sourceFreshness: {
      maxStalenessMinutes: 1440,
    },
    failurePolicy: {
      maxHealingAttempts: 3,
      autoHeal: true,
      quarantineThresholdPercentage: 0.15,
    },
    extractKey: (record) => record.api_model_id,
    validateRecord: (raw) => {
      try {
        const result = RawAnthropicCatalogRecordSchema.safeParse(raw);
        if (!result.success) {
          return {
            success: false,
            issues: result.error.issues.map(
              (issue) => `[${issue.path.join(".") || "root"}] ${issue.message}`,
            ),
          };
        }
        return { success: true, data: result.data };
      } catch (err) {
        return { success: false, issues: [err instanceof Error ? err.message : String(err)] };
      }
    },
    /**
     * The Anthropic models overview *is* the comparison table: every current
     * model it lists publishes a context window and a max output figure in the
     * same two rows. A batch where not one record yields either number did not
     * observe an Anthropic page that stopped stating limits — it observed a
     * broken extraction, or a normalizer that stopped recognising the shorthand
     * the table is written in.
     *
     * This is deliberately a source-specific invariant rather than a change to
     * what null means. Unknown stays Unknown everywhere, including here: a
     * single model missing a figure is still just unobserved. What is refused
     * is the *uniform* disappearance across the whole batch, which is the
     * signature this source cannot produce honestly.
     */
    validateSemanticInvariants: (records): SemanticInvariantCheckResult[] => {
      const results: SemanticInvariantCheckResult[] = [];
      if (records.length === 0) return results;

      const withContext = records.filter(
        (record) => normalizeExactTokenCount(record.context_window_raw) !== null,
      ).length;
      const withMaxOutput = records.filter(
        (record) => normalizeExactTokenCount(record.max_output_tokens_raw) !== null,
      ).length;

      if (withContext === 0) {
        results.push({
          passed: false,
          code: "CAPABILITY_TOKEN_LIMITS_MISSING",
          reason:
            `None of the ${records.length} Anthropic catalog records yielded a context ` +
            "window. The models overview publishes one per current model, so a uniform " +
            "absence is an extraction or normalization fault rather than a source change.",
        });
      }
      if (withMaxOutput === 0) {
        results.push({
          passed: false,
          code: "CAPABILITY_TOKEN_LIMITS_MISSING",
          reason:
            `None of the ${records.length} Anthropic catalog records yielded a max output ` +
            "figure. The models overview publishes one per current model, so a uniform " +
            "absence is an extraction or normalization fault rather than a source change.",
        });
      }

      return results;
    },
  });
}

/**
 * Factory for Gemini model catalog health contract.
 */
export function createGeminiCatalogSourceHealthContract(
  sourceId = "catalog-gemini",
): SourceHealthContract<RawGeminiCatalogRecord> {
  return createSourceHealthContract<RawGeminiCatalogRecord>({
    sourceId,
    sourceCategory: "models",
    authorityDomain: "catalog",
    isAuthoritative: true,
    requiredFields: ["model_id"],
    minViableRecords: 1,
    recordCountDrift: {
      minExpectedCount: 1,
      maxDropPercentage: 0.4,
      maxSpikePercentage: 3.0,
    },
    sourceFreshness: {
      maxStalenessMinutes: 1440,
    },
    failurePolicy: {
      maxHealingAttempts: 3,
      autoHeal: true,
      quarantineThresholdPercentage: 0.15,
    },
    extractKey: (record) => record.model_id,
    validateRecord: (raw) => {
      try {
        const result = RawGeminiCatalogRecordSchema.safeParse(raw);
        if (!result.success) {
          return {
            success: false,
            issues: result.error.issues.map(
              (issue) => `[${issue.path.join(".") || "root"}] ${issue.message}`,
            ),
          };
        }
        // Google serves every model page in ~40 languages behind an `hl` query
        // parameter, and its index occasionally links one. A translated page is
        // not a second opinion about the model — it is the same facts written in
        // a vocabulary this contract cannot read: `llamada_a_función` never
        // matches the function-calling feature test, `texto`/`imagen` never
        // normalize to modalities, and what survives is a model that appears to
        // have lost tool calling and half its inputs. Refusing the localized
        // rendering is what keeps a translation from being recorded as a
        // capability change.
        const locale = localeQueryParameter(result.data.source_url);
        if (locale !== null) {
          return {
            success: false,
            issues: [
              `[source_url] localized rendering (hl=${locale}); capability vocabulary ` +
              "on a translated page cannot be read against this contract",
            ],
          };
        }
        return { success: true, data: result.data };
      } catch (err) {
        return { success: false, issues: [err instanceof Error ? err.message : String(err)] };
      }
    },
    /**
     * Google publishes input modalities and a context window for every model on
     * this page. A batch where not one record carries either did not observe a
     * source that stopped saying so — it observed an extraction that stopped
     * reading it.
     *
     * Source-specific on purpose, and deliberately about the *whole* batch:
     * Unknown semantics are unchanged, and a single model missing a field is
     * still just unobserved.
     */
    validateSemanticInvariants: (records): SemanticInvariantCheckResult[] => {
      const results: SemanticInvariantCheckResult[] = [];
      if (records.length === 0) return results;

      const withModalities = records.filter(
        (record) => normalizeModalities(record.input_modalities).length > 0,
      ).length;
      const withContext = records.filter(
        (record) => normalizeExactTokenCount(record.context_window_raw) !== null,
      ).length;

      if (withModalities === 0) {
        results.push({
          passed: false,
          code: "SEMANTIC_INVARIANT_VIOLATION",
          reason:
            `None of the ${records.length} Gemini catalog records yielded an input ` +
            "modality. This page publishes supported data types per model, so a uniform " +
            "absence is an extraction fault rather than a source change.",
        });
      }
      if (withContext === 0) {
        results.push({
          passed: false,
          code: "CAPABILITY_TOKEN_LIMITS_MISSING",
          reason:
            `None of the ${records.length} Gemini catalog records yielded a context ` +
            "window. This page publishes one per model, so a uniform absence is an " +
            "extraction fault rather than a source change.",
        });
      }

      return results;
    },
  });
}

/**
 * Factory for xAI model catalog health contract.
 */
export function createXaiCatalogSourceHealthContract(
  sourceId = "catalog-xai",
): SourceHealthContract<RawXaiCatalogRecord> {
  return createSourceHealthContract<RawXaiCatalogRecord>({
    sourceId,
    sourceCategory: "models",
    authorityDomain: "catalog",
    isAuthoritative: true,
    requiredFields: ["name"],
    minViableRecords: 1,
    recordCountDrift: {
      minExpectedCount: 1,
      maxDropPercentage: 0.4,
      maxSpikePercentage: 3.0,
    },
    sourceFreshness: {
      maxStalenessMinutes: 1440,
    },
    failurePolicy: {
      maxHealingAttempts: 3,
      autoHeal: true,
      quarantineThresholdPercentage: 0.15,
    },

    extractKey: (record) => record.name,
    validateRecord: (raw) => {
      try {
        const result = RawXaiCatalogRecordSchema.safeParse(raw);
        if (!result.success) {
          return {
            success: false,
            issues: result.error.issues.map(
              (issue) => `[${issue.path.join(".") || "root"}] ${issue.message}`,
            ),
          };
        }
        return { success: true, data: result.data };
      } catch (err) {
        return { success: false, issues: [err instanceof Error ? err.message : String(err)] };
      }
    },
  });
}

/**
 * Factory for catalog source contracts across all supported providers (OpenAI, Anthropic, Gemini, xAI).
 */
export function createCatalogSourceHealthContract(
  providerSlug: CatalogProviderSlug,
  sourceId = `catalog-${providerSlug}`,
): SourceHealthContract<unknown> {
  switch (providerSlug) {
    case "openai":
      return createOpenAiCatalogSourceHealthContract(sourceId) as SourceHealthContract<unknown>;
    case "anthropic":
      return createAnthropicCatalogSourceHealthContract(sourceId) as SourceHealthContract<unknown>;
    case "gemini":
      return createGeminiCatalogSourceHealthContract(sourceId) as SourceHealthContract<unknown>;
    case "xai":
      return createXaiCatalogSourceHealthContract(sourceId) as SourceHealthContract<unknown>;
  }
}
