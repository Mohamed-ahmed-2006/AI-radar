/**
 * Public projection of a source's health contract.
 *
 * The Sentinel contract that governs a source is executable: it carries the
 * record validators, the identity extractor and the semantic invariant checks.
 * None of that is publishable. What a reader needs is the *expectation*: what
 * the source is an authority on, which semantic fields every record must
 * carry, how much drift is tolerated, how stale it may get, and what happens
 * when it breaks. This module derives exactly that and nothing else.
 */

import { createSourceHealthContractFor } from "../sentinel/contracts";
import type { PricingProviderSlug } from "../pipeline/providers";
import type { SourceKind } from "../supabase/types";
import type { SourceCategory, SourceContractView } from "./types";

const PRICING_PROVIDER_SLUGS: readonly string[] = [
  "openai",
  "anthropic",
  "gemini",
  "xai",
];

const LIFECYCLE_PROVIDER_SLUGS: readonly string[] = ["anthropic", "gemini"];

/** What the source is an authority on, from its kind and provider. */
export function resolveSourceCategory(
  kind: SourceKind,
  providerSlug: string,
): SourceCategory {
  if (kind === "pricing") return "pricing";
  if (kind === "models") {
    return LIFECYCLE_PROVIDER_SLUGS.includes(providerSlug) ? "lifecycle" : "models";
  }
  return "other";
}

/**
 * Resolves the public contract view for a source, or null when no contract is
 * registered for that provider/kind pair. A null contract is meaningful: it
 * says the source is collected but not yet governed by Sentinel expectations.
 */
export function resolveSourceContractView(
  kind: SourceKind,
  providerSlug: string,
  sourceId: string,
): SourceContractView | null {
  const category = resolveSourceCategory(kind, providerSlug);

  const contract =
    category === "pricing" && PRICING_PROVIDER_SLUGS.includes(providerSlug)
      ? createSourceHealthContractFor(
          { domain: "pricing", providerSlug: providerSlug as PricingProviderSlug },
          sourceId,
        )
      : category === "lifecycle"
        ? createSourceHealthContractFor(
            {
              domain: "lifecycle",
              providerSlug: providerSlug as "anthropic" | "gemini",
            },
            sourceId,
          )
        : null;

  if (!contract) return null;

  return {
    category,
    authorityDomain: contract.authorityDomain,
    isAuthoritative: contract.isAuthoritative,
    requiredFields: [...contract.requiredFields],
    expectedEnumDomains: Object.fromEntries(
      Object.entries(contract.expectedEnumDomains ?? {}).map(([field, values]) => [
        field,
        [...values],
      ]),
    ),
    minViableRecords: contract.minViableRecords,
    recordCountDrift: {
      minExpectedCount: contract.recordCountDrift.minExpectedCount ?? null,
      maxDropPercentage: contract.recordCountDrift.maxDropPercentage ?? null,
      maxSpikePercentage: contract.recordCountDrift.maxSpikePercentage ?? null,
    },
    freshness: {
      maxStalenessMinutes: contract.sourceFreshness.maxStalenessMinutes ?? null,
    },
    failurePolicy: {
      maxHealingAttempts: contract.failurePolicy.maxHealingAttempts,
      autoHeal: contract.failurePolicy.autoHeal,
      quarantineThresholdPercentage:
        contract.failurePolicy.quarantineThresholdPercentage,
    },
  };
}
