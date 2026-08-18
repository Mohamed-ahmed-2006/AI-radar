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
} from "../contracts";
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
  | { domain: "lifecycle"; providerSlug: "anthropic" | "gemini" };

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
