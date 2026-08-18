/**
 * Payload fixtures shaped like the real collectors' output, plus helpers for
 * building orchestration sources that keep the real pipelines and the real
 * Sentinel gate while standing in for Bright Data and Supabase.
 */

import {
  CATALOG_PROVIDERS,
  PRICING_PROVIDERS,
  ingestAnthropicLifecycle,
  ingestCatalogProvider,
  ingestGeminiLifecycle,
  ingestPricingProvider,
  type CatalogProviderSlug,
  type PricingProviderSlug,
} from "../../../lib/pipeline";
import {
  getCollectionSource,
  type CollectionSourceDefinition,
  type CollectionSourceKey,
} from "../../../lib/orchestration";
import {
  RecordingCatalogRepository,
  RecordingLifecycleRepository,
  RecordingPricingRepository,
  collectorPayload,
} from "./pipeline-doubles";
import type { OpenAiCollectorResult } from "../../../lib/pipeline";

export const ANTHROPIC_LIFECYCLE_URL =
  "https://platform.claude.com/docs/en/about-claude/model-deprecations";
export const GEMINI_LIFECYCLE_URL = "https://ai.google.dev/gemini-api/docs/deprecations";

/** Two priced models, the shape a healthy pricing collector returns. */
export function pricingRecords(slug: PricingProviderSlug): Record<string, unknown>[] {
  const provider = PRICING_PROVIDERS[slug];
  return ["alpha", "beta"].map((name, index) => ({
    input: {},
    provider: provider.name,
    model_name: `${slug}-${name}`,
    pricing_mode: "standard",
    context_tier: "standard",
    input_price_per_1m_tokens: index + 1,
    cached_input_price_per_1m_tokens: 0.5,
    cache_write_price_per_1m_tokens: 0.75,
    output_price_per_1m_tokens: (index + 1) * 4,
    pricing_unit: "USD per 1M tokens",
    source_url: provider.defaultSourceUrl,
  }));
}

export function anthropicLifecycleRecords(): Record<string, unknown>[] {
  return [
    {
      product_page_url: ANTHROPIC_LIFECYCLE_URL,
      input: { url: ANTHROPIC_LIFECYCLE_URL },
      api_model_name: "claude-sonnet-4-5-20250929",
      current_state: "Active",
      tentative_retirement_date: "Not sooner than September 29, 2027",
    },
    {
      product_page_url: ANTHROPIC_LIFECYCLE_URL,
      input: { url: ANTHROPIC_LIFECYCLE_URL },
      api_model_name: "claude-opus-4-1-20250805",
      current_state: "Deprecated",
      deprecated_date: "June 5, 2026",
      // A lower bound, not an exact retirement date.
      tentative_retirement_date: "Not sooner than August 5, 2027",
    },
  ];
}

export function geminiLifecycleRecords(): Record<string, unknown>[] {
  return [
    {
      model_id: "gemini-2.5-pro",
      model_group: "Gemini 2.5 models",
      model_stage: "stable",
      release_date_raw: "June 17, 2025",
      shutdown_not_before_date_raw: "May 7, 2027",
      recommended_replacement: null,
      product_page_url: null,
      is_shutdown: false,
      input: { url: GEMINI_LIFECYCLE_URL },
    },
    {
      model_id: "gemini-2.5-flash",
      model_group: "Gemini 2.5 models",
      model_stage: "stable",
      shutdown_not_before_date_raw: "No shutdown date announced",
      is_shutdown: false,
      input: { url: GEMINI_LIFECYCLE_URL },
    },
  ];
}

export function openAiCatalogRecords(): Record<string, unknown>[] {
  return [
    {
      model_id: "gpt-5.6-sol",
      display_name: "GPT-5.6 Sol",
      context_window_raw: 256000,
      max_output_tokens_raw: 32768,
      supports_vision: true,
      supports_function_calling: true,
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
    },
    {
      model_id: "gpt-4o",
      display_name: "GPT-4o",
      context_window_raw: 128000,
      max_output_tokens_raw: 16384,
      supports_vision: true,
      supports_function_calling: true,
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
    },
  ];
}

export function anthropicCatalogRecords(): Record<string, unknown>[] {
  return [
    {
      api_model_id: "claude-sonnet-4-5-20250929",
      display_name: "Claude Sonnet 4.5",
      model_family: "Claude Sonnet",
      context_window_raw: 200000,
      max_output_tokens_raw: 8192,
      supports_vision: true,
      supports_tool_use: true,
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
    },
    {
      api_model_id: "claude-opus-4-6-20260205",
      display_name: "Claude Opus 4.6",
      model_family: "Claude Opus",
      context_window_raw: 1000000,
      max_output_tokens_raw: 64000,
      supports_vision: true,
      supports_tool_use: true,
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
    },
  ];
}

export function geminiCatalogRecords(): Record<string, unknown>[] {
  return [
    {
      model_id: "gemini-2.5-pro",
      display_name: "Gemini 2.5 Pro",
      model_group: "Gemini 2.5",
      context_window_raw: 1000000,
      max_output_tokens_raw: 65536,
      supports_vision: true,
      supports_function_calling: true,
      input_modalities: ["text", "image", "audio", "video"],
      output_modalities: ["text"],
    },
    {
      model_id: "gemini-2.5-flash",
      display_name: "Gemini 2.5 Flash",
      model_group: "Gemini 2.5",
      context_window_raw: 1000000,
      max_output_tokens_raw: 65536,
      supports_vision: true,
      supports_function_calling: true,
      input_modalities: ["text", "image", "audio", "video"],
      output_modalities: ["text"],
    },
  ];
}

export function xaiCatalogRecords(): Record<string, unknown>[] {
  return [
    {
      name: "grok-4.20-0309-reasoning",
      max_prompt_length: 1000000,
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
      features: { functionCalling: true, structuredOutputs: true, reasoning: true },
    },
    {
      name: "grok-4.6",
      max_prompt_length: 500000,
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
      features: { functionCalling: true, structuredOutputs: true, reasoning: false },
    },
  ];
}

/** A healthy payload for whichever source key is asked for. */
export function healthyRecordsFor(key: CollectionSourceKey): Record<string, unknown>[] {
  if (key === "anthropic-lifecycle") return anthropicLifecycleRecords();
  if (key === "gemini-lifecycle") return geminiLifecycleRecords();
  if (key === "openai-catalog") return openAiCatalogRecords();
  if (key === "anthropic-catalog") return anthropicCatalogRecords();
  if (key === "gemini-catalog") return geminiCatalogRecords();
  if (key === "xai-catalog") return xaiCatalogRecords();
  return pricingRecords(key.replace("-pricing", "") as PricingProviderSlug);
}

/**
 * A structurally broken payload for a source: the DOM moved and the collector
 * is emitting rows that no longer satisfy the contract.
 */
export function malformedRecordsFor(key: CollectionSourceKey): Record<string, unknown>[] {
  if (key === "anthropic-lifecycle") {
    return [
      {
        product_page_url: ANTHROPIC_LIFECYCLE_URL,
        api_model_name: "claude-sonnet-4-5-20250929",
        current_state: "Totally Unknown State",
      },
      { product_page_url: ANTHROPIC_LIFECYCLE_URL, api_model_name: "", current_state: "Active" },
    ];
  }
  if (key === "gemini-lifecycle") {
    return [
      { model_id: "gemini-2.5-pro", model_stage: "who knows", input: { url: GEMINI_LIFECYCLE_URL } },
      { model_id: "", model_group: "", is_shutdown: "maybe", input: { url: GEMINI_LIFECYCLE_URL } },
    ];
  }
  if (key === "openai-catalog") {
    return [
      { model_id: "", display_name: "Broken Model" },
      { invalid_column: 123 },
    ];
  }
  if (key === "anthropic-catalog") {
    return [
      { api_model_id: "", display_name: "Broken Claude" },
      { invalid_column: 456 },
    ];
  }
  if (key === "gemini-catalog") {
    return [
      { model_id: "", display_name: "Broken Gemini" },
      { missing_model: true },
    ];
  }
  if (key === "xai-catalog") {
    return [
      { name: "", max_prompt_length: -1 },
      { broken_key: true },
    ];
  }
  return [
    { provider: PRICING_PROVIDERS[key.replace("-pricing", "") as PricingProviderSlug].name },
    { model_name: "<div class=\"price\">", pricing_mode: "", context_tier: "" },
  ];
}

export interface HarnessedSource {
  source: CollectionSourceDefinition;
  pricing: RecordingPricingRepository;
  lifecycle: RecordingLifecycleRepository;
  catalog: RecordingCatalogRepository;
  collectCalls: number;
}

/**
 * Wraps a registry source so the collector returns `respond()` and persistence
 * lands in memory. Everything between — contract validation, the Sentinel gate,
 * change detection — is the production code path.
 */
export function harnessSource(
  key: CollectionSourceKey,
  respond: (attempt: number) => Promise<OpenAiCollectorResult>,
): HarnessedSource {
  const registrySource = getCollectionSource(key);
  const pricing = new RecordingPricingRepository(`provider-${registrySource.providerSlug}`);
  const lifecycle = new RecordingLifecycleRepository(`provider-${registrySource.providerSlug}`);
  const catalog = new RecordingCatalogRepository(`provider-${registrySource.providerSlug}`);
  const harness: HarnessedSource = {
    pricing,
    lifecycle,
    catalog,
    collectCalls: 0,
    source: {
      ...registrySource,
      collect: () => {
        harness.collectCalls += 1;
        return respond(harness.collectCalls);
      },
      persist: (payload, context) => {
        if (key === "anthropic-lifecycle") {
          return ingestAnthropicLifecycle({
            repository: lifecycle,
            sentinelRepository: context.sentinelRepository,
            collect: async () => payload,
            triggeredBy: context.triggeredBy,
          });
        }
        if (key === "gemini-lifecycle") {
          return ingestGeminiLifecycle({
            repository: lifecycle,
            sentinelRepository: context.sentinelRepository,
            collect: async () => payload,
            triggeredBy: context.triggeredBy,
          });
        }
        if (key.endsWith("-catalog")) {
          const providerSlug = key.replace("-catalog", "") as CatalogProviderSlug;
          return ingestCatalogProvider(CATALOG_PROVIDERS[providerSlug], {
            repository: catalog,
            sentinelRepository: context.sentinelRepository,
            collect: async () => payload,
            triggeredBy: context.triggeredBy,
          });
        }
        return ingestPricingProvider(
          PRICING_PROVIDERS[key.replace("-pricing", "") as PricingProviderSlug],
          {
            repository: pricing,
            sentinelRepository: context.sentinelRepository,
            collect: async () => payload,
            triggeredBy: context.triggeredBy,
          },
        );
      },
    },
  };
  return harness;
}

export function healthyResponder(key: CollectionSourceKey, runId = `${key}-run`) {
  const source = getCollectionSource(key);
  return async () =>
    collectorPayload(healthyRecordsFor(key), { collectorId: source.collectorId, runId });
}
