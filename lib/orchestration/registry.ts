/**
 * Configured intelligence sources.
 *
 * This registry is the single declaration of what the fleet runs. Everything a
 * source needs — collector, cadence, timeout, retry policy, Sentinel contract
 * and failure isolation — is resolved here from configuration, never from
 * magic values scattered across route handlers.
 */

import {
  DEFAULT_ANTHROPIC_LIFECYCLE_COLLECTOR_ID,
  DEFAULT_ANTHROPIC_LIFECYCLE_SOURCE_URL,
  DEFAULT_GEMINI_LIFECYCLE_COLLECTOR_ID,
  DEFAULT_GEMINI_LIFECYCLE_SOURCE_URL,
  fetchAnthropicLifecycle,
  fetchCatalogCollector,
  fetchGeminiLifecycle,
  fetchPricingCollector,
} from "../brightdata";
import {
  CATALOG_PROVIDERS,
  PRICING_PROVIDERS,
  ingestAnthropicLifecycle,
  ingestCatalogProvider,
  ingestGeminiLifecycle,
  ingestPricingProvider,
  resolveCatalogProviderConfiguration,
  resolvePricingProviderConfiguration,
  type CatalogProviderSlug,
  type PricingProviderSlug,
} from "../pipeline";
import { createSourceHealthContractFor } from "../sentinel";
import type {
  CollectionSourceDefinition,
  CollectionSourceKey,
  FailureIsolationPolicy,
  RetryPolicy,
} from "./types";

/**
 * Fleet-wide defaults. Every value is overridable per source through the
 * environment, so cadence and budgets are configuration, not code edits.
 */
export const ORCHESTRATION_DEFAULTS = {
  /** Pricing pages move slowly; six hours keeps cost and drift both low. */
  pricingCadenceMinutes: 360,
  /** Deprecation pages move more slowly still. */
  lifecycleCadenceMinutes: 720,
  /** Catalog pages move slowly; 12 hours keeps cost and drift both low. */
  catalogCadenceMinutes: 720,
  /** Bright Data collector budget for one attempt. */
  timeoutMs: 120_000,
  maxAttempts: 3,
  backoffMs: 2_000,
  backoffMultiplier: 2,
  maxBackoffMs: 30_000,
  alertAfterConsecutiveFailures: 3,
} as const;


const FAILURE_ISOLATION: FailureIsolationPolicy = {
  continueFleetOnFailure: true,
  quarantineBlocksPersistence: true,
  alertAfterConsecutiveFailures: ORCHESTRATION_DEFAULTS.alertAfterConsecutiveFailures,
};

function envKey(key: CollectionSourceKey, suffix: string): string {
  return `AI_RADAR_SOURCE_${key.replace(/-/g, "_").toUpperCase()}_${suffix}`;
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * A declared-but-empty environment variable must not override a committed
 * default: `??` accepts `""`, which would leave a source with no collector id
 * and no source URL and fail only at the Bright Data call.
 */
function overrideOrDefault(configured: string | undefined, fallback: string): string {
  const trimmed = configured?.trim();
  return trimmed ? trimmed : fallback.trim();
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if (["false", "0", "off", "no"].includes(raw)) return false;
  if (["true", "1", "on", "yes"].includes(raw)) return true;
  return fallback;
}

function resolveCadenceMinutes(key: CollectionSourceKey, fallback: number): number {
  return readNumber(
    envKey(key, "CADENCE_MINUTES"),
    readNumber("AI_RADAR_COLLECTION_CADENCE_MINUTES", fallback),
  );
}

function resolveTimeoutMs(key: CollectionSourceKey): number {
  return readNumber(
    envKey(key, "TIMEOUT_MS"),
    readNumber("AI_RADAR_COLLECTION_TIMEOUT_MS", ORCHESTRATION_DEFAULTS.timeoutMs),
  );
}

function resolveRetryPolicy(key: CollectionSourceKey): RetryPolicy {
  const configured = readNumber(
    envKey(key, "MAX_ATTEMPTS"),
    readNumber("AI_RADAR_COLLECTION_MAX_ATTEMPTS", ORCHESTRATION_DEFAULTS.maxAttempts),
  );
  // Hard ceiling: retries are bounded by policy, never by how long a source
  // keeps failing.
  const maxAttempts = Math.min(5, Math.max(1, Math.floor(configured)));
  return {
    maxAttempts,
    backoffMs: readNumber("AI_RADAR_COLLECTION_BACKOFF_MS", ORCHESTRATION_DEFAULTS.backoffMs),
    backoffMultiplier: ORCHESTRATION_DEFAULTS.backoffMultiplier,
    maxBackoffMs: readNumber(
      "AI_RADAR_COLLECTION_MAX_BACKOFF_MS",
      ORCHESTRATION_DEFAULTS.maxBackoffMs,
    ),
    retryOn: ["collector_error", "collector_timeout"],
  };
}

/** Cron equivalent of a cadence, for display in the status read model. */
export function cadenceToCronHint(cadenceMinutes: number): string {
  if (cadenceMinutes % 1440 === 0) {
    const days = cadenceMinutes / 1440;
    return days === 1 ? "0 0 * * *" : `0 0 */${days} * *`;
  }
  if (cadenceMinutes % 60 === 0) {
    const hours = cadenceMinutes / 60;
    return hours === 1 ? "0 * * * *" : `0 */${hours} * * *`;
  }
  return `*/${cadenceMinutes} * * * *`;
}

function definePricingSource(slug: PricingProviderSlug): CollectionSourceDefinition {
  const provider = PRICING_PROVIDERS[slug];
  const key = `${slug}-pricing` as CollectionSourceKey;
  const configuration = resolvePricingProviderConfiguration(provider);
  const cadenceMinutes = resolveCadenceMinutes(key, ORCHESTRATION_DEFAULTS.pricingCadenceMinutes);

  return {
    key,
    provider: provider.name,
    providerSlug: provider.slug,
    providerHomepageUrl: provider.homepageUrl,
    sourceType: "pricing",
    sourceKind: "pricing",
    label: provider.label,
    sourceUrl: configuration.sourceUrl,
    collectorId: configuration.collectorId,
    enabled: readBoolean(envKey(key, "ENABLED"), true),
    schedule: { cadenceMinutes, cronHint: cadenceToCronHint(cadenceMinutes) },
    timeoutMs: resolveTimeoutMs(key),
    retry: resolveRetryPolicy(key),
    failureIsolation: FAILURE_ISOLATION,
    collect: () => fetchPricingCollector(configuration),
    persist: (payload, context) =>
      ingestPricingProvider(provider, {
        collect: async () => payload,
        triggeredBy: context.triggeredBy,
        sentinelRepository: context.sentinelRepository,
      }),
    createHealthContract: (sourceId) =>
      createSourceHealthContractFor({ domain: "pricing", providerSlug: slug }, sourceId),
  };
}

function defineAnthropicLifecycleSource(): CollectionSourceDefinition {
  const key: CollectionSourceKey = "anthropic-lifecycle";
  const collectorId = overrideOrDefault(
    process.env.BRIGHTDATA_ANTHROPIC_LIFECYCLE_COLLECTOR_ID,
    DEFAULT_ANTHROPIC_LIFECYCLE_COLLECTOR_ID,
  );
  const sourceUrl = overrideOrDefault(
    process.env.ANTHROPIC_LIFECYCLE_SOURCE_URL,
    DEFAULT_ANTHROPIC_LIFECYCLE_SOURCE_URL,
  );
  const cadenceMinutes = resolveCadenceMinutes(key, ORCHESTRATION_DEFAULTS.lifecycleCadenceMinutes);

  return {
    key,
    provider: "Anthropic",
    providerSlug: "anthropic",
    providerHomepageUrl: "https://www.anthropic.com",
    sourceType: "lifecycle",
    sourceKind: "models",
    label: "Anthropic model lifecycle and deprecations",
    sourceUrl,
    collectorId,
    enabled: readBoolean(envKey(key, "ENABLED"), true),
    schedule: { cadenceMinutes, cronHint: cadenceToCronHint(cadenceMinutes) },
    timeoutMs: resolveTimeoutMs(key),
    retry: resolveRetryPolicy(key),
    failureIsolation: FAILURE_ISOLATION,
    collect: () => fetchAnthropicLifecycle({ collectorId, sourceUrl }),
    persist: (payload, context) =>
      ingestAnthropicLifecycle({
        collect: async () => payload,
        triggeredBy: context.triggeredBy,
        sentinelRepository: context.sentinelRepository,
        collectorId,
        sourceUrl,
      }),
    createHealthContract: (sourceId) =>
      createSourceHealthContractFor({ domain: "lifecycle", providerSlug: "anthropic" }, sourceId),
  };
}

function defineGeminiLifecycleSource(): CollectionSourceDefinition {
  const key: CollectionSourceKey = "gemini-lifecycle";
  const collectorId = overrideOrDefault(
    process.env.BRIGHTDATA_GEMINI_LIFECYCLE_COLLECTOR_ID,
    DEFAULT_GEMINI_LIFECYCLE_COLLECTOR_ID,
  );
  const sourceUrl = overrideOrDefault(
    process.env.GEMINI_LIFECYCLE_SOURCE_URL,
    DEFAULT_GEMINI_LIFECYCLE_SOURCE_URL,
  );
  const cadenceMinutes = resolveCadenceMinutes(key, ORCHESTRATION_DEFAULTS.lifecycleCadenceMinutes);

  return {
    key,
    provider: "Google",
    providerSlug: "gemini",
    providerHomepageUrl: "https://ai.google.dev",
    sourceType: "lifecycle",
    sourceKind: "models",
    label: "Google Gemini model lifecycle and deprecations",
    sourceUrl,
    collectorId,
    enabled: readBoolean(envKey(key, "ENABLED"), true),
    schedule: { cadenceMinutes, cronHint: cadenceToCronHint(cadenceMinutes) },
    timeoutMs: resolveTimeoutMs(key),
    retry: resolveRetryPolicy(key),
    failureIsolation: FAILURE_ISOLATION,
    collect: () => fetchGeminiLifecycle({ collectorId, sourceUrl }),
    persist: (payload, context) =>
      ingestGeminiLifecycle({
        collect: async () => payload,
        triggeredBy: context.triggeredBy,
        sentinelRepository: context.sentinelRepository,
        collectorId,
        sourceUrl,
      }),
    createHealthContract: (sourceId) =>
      createSourceHealthContractFor({ domain: "lifecycle", providerSlug: "gemini" }, sourceId),
  };
}

function defineCatalogSource(slug: CatalogProviderSlug): CollectionSourceDefinition {
  const provider = CATALOG_PROVIDERS[slug];
  const key = `${slug}-catalog` as CollectionSourceKey;
  const configuration = resolveCatalogProviderConfiguration(provider);
  const cadenceMinutes = resolveCadenceMinutes(key, ORCHESTRATION_DEFAULTS.catalogCadenceMinutes);

  return {
    key,
    provider: provider.name,
    providerSlug: provider.slug,
    providerHomepageUrl: provider.homepageUrl,
    sourceType: "catalog",
    sourceKind: "models",
    label: provider.label,
    sourceUrl: configuration.sourceUrl,
    collectorId: configuration.collectorId,
    enabled: readBoolean(envKey(key, "ENABLED"), true),
    schedule: { cadenceMinutes, cronHint: cadenceToCronHint(cadenceMinutes) },
    timeoutMs: resolveTimeoutMs(key),
    retry: resolveRetryPolicy(key),
    failureIsolation: FAILURE_ISOLATION,
    collect: () =>
      fetchCatalogCollector({
        collectorId: configuration.collectorId,
        sourceUrl: configuration.sourceUrl,
      }),
    persist: (payload, context) =>
      ingestCatalogProvider(provider, {
        collect: async () => payload,
        triggeredBy: context.triggeredBy,
        sentinelRepository: context.sentinelRepository,
        collectorId: configuration.collectorId,
        sourceUrl: configuration.sourceUrl,
      }),
    createHealthContract: (sourceId) =>
      createSourceHealthContractFor({ domain: "catalog", providerSlug: slug }, sourceId),
  };
}

/** Declaration order is execution order for a sequential fleet run. */
export const COLLECTION_SOURCE_KEYS: readonly CollectionSourceKey[] = [
  "openai-pricing",
  "anthropic-pricing",
  "gemini-pricing",
  "xai-pricing",
  "anthropic-lifecycle",
  "gemini-lifecycle",
  "openai-catalog",
  "anthropic-catalog",
  "gemini-catalog",
  "xai-catalog",
];

/**
 * Builds the registry from the current environment. Deliberately not memoised:
 * the environment is read per invocation, so a cadence or enablement change
 * takes effect on the next scheduler tick.
 */
export function listCollectionSources(): CollectionSourceDefinition[] {
  return [
    definePricingSource("openai"),
    definePricingSource("anthropic"),
    definePricingSource("gemini"),
    definePricingSource("xai"),
    defineAnthropicLifecycleSource(),
    defineGeminiLifecycleSource(),
    defineCatalogSource("openai"),
    defineCatalogSource("anthropic"),
    defineCatalogSource("gemini"),
    defineCatalogSource("xai"),
  ];
}

export function getCollectionSource(key: CollectionSourceKey): CollectionSourceDefinition {
  const source = listCollectionSources().find((candidate) => candidate.key === key);
  if (!source) throw new Error(`Unknown collection source: ${key}`);
  return source;
}

export function isCollectionSourceKey(value: string): value is CollectionSourceKey {
  return (COLLECTION_SOURCE_KEYS as readonly string[]).includes(value);
}
