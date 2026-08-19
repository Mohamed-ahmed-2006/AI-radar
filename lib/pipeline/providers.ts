import {
  adaptAnthropicPricingRecord,
  adaptGeminiPricingRecord,
  adaptOpenAiPricingRecord,
  adaptXaiPricingRecord,
} from "../brightdata/adapters/pricing";
import {
  adaptAnthropicCatalogRecord,
  adaptGeminiCatalogRecord,
  adaptOpenAiCatalogRecord,
  adaptXaiCatalogRecord,
} from "../brightdata/adapters/catalog";
import {
  DEFAULT_ANTHROPIC_CATALOG_COLLECTOR_ID,
  DEFAULT_ANTHROPIC_CATALOG_SOURCE_URL,
  DEFAULT_GEMINI_CATALOG_COLLECTOR_ID,
  DEFAULT_GEMINI_CATALOG_SOURCE_URL,
  DEFAULT_OPENAI_CATALOG_COLLECTOR_ID,
  DEFAULT_OPENAI_CATALOG_SOURCE_URL,
  DEFAULT_XAI_CATALOG_COLLECTOR_ID,
  DEFAULT_XAI_CATALOG_SOURCE_URL,
} from "../brightdata/collectors/catalog";
import type { CatalogProviderSlug, NormalizedCatalogRecord } from "../contracts";

export type { CatalogProviderSlug };
export type PricingProviderSlug = "openai" | "anthropic" | "gemini" | "xai";


export interface PricingProviderDefinition {
  slug: PricingProviderSlug;
  name: string;
  homepageUrl: string;
  label: string;
  collectorEnv: string;
  defaultCollectorId: string;
  sourceUrlEnv: string;
  defaultSourceUrl: string;
  adapt(raw: unknown, sourceUrl: string): unknown;
}

export interface CatalogProviderDefinition {
  slug: CatalogProviderSlug;
  name: string;
  homepageUrl: string;
  label: string;
  collectorEnv: string;
  defaultCollectorId: string;
  sourceUrlEnv: string;
  defaultSourceUrl: string;
  adapt(
    raw: unknown,
    sourceUrl: string,
    collectorId?: string | null,
    collectedAt?: string | null,
  ): NormalizedCatalogRecord;
}

export const PRICING_PROVIDERS: Record<PricingProviderSlug, PricingProviderDefinition> = {
  openai: {
    slug: "openai", name: "OpenAI", homepageUrl: "https://openai.com", label: "OpenAI pricing page",
    collectorEnv: "BRIGHTDATA_OPENAI_COLLECTOR_ID", defaultCollectorId: "c_msx3bqlyjtv2qustx",
    sourceUrlEnv: "OPENAI_PRICING_SOURCE_URL", defaultSourceUrl: "https://developers.openai.com/api/docs/pricing",
    adapt: adaptOpenAiPricingRecord,
  },
  anthropic: {
    slug: "anthropic", name: "Anthropic", homepageUrl: "https://www.anthropic.com", label: "Anthropic pricing page",
    collectorEnv: "BRIGHTDATA_ANTHROPIC_COLLECTOR_ID", defaultCollectorId: "c_msxbuggp1czbtysx06",
    sourceUrlEnv: "ANTHROPIC_PRICING_SOURCE_URL", defaultSourceUrl: "https://platform.claude.com/docs/en/about-claude/pricing",
    adapt: adaptAnthropicPricingRecord,
  },
  gemini: {
    slug: "gemini", name: "Google", homepageUrl: "https://ai.google.dev", label: "Google Gemini pricing page",
    collectorEnv: "BRIGHTDATA_GEMINI_COLLECTOR_ID", defaultCollectorId: "c_msxdkx5424fwc069z7",
    sourceUrlEnv: "GEMINI_PRICING_SOURCE_URL", defaultSourceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
    adapt: adaptGeminiPricingRecord,
  },
  xai: {
    slug: "xai", name: "xAI", homepageUrl: "https://x.ai", label: "xAI pricing page",
    collectorEnv: "BRIGHTDATA_XAI_COLLECTOR_ID", defaultCollectorId: "c_msxf12ec1vq9w3d0r1",
    sourceUrlEnv: "XAI_PRICING_SOURCE_URL", defaultSourceUrl: "https://docs.x.ai/developers/pricing",
    adapt: adaptXaiPricingRecord,
  },
};

export const CATALOG_PROVIDERS: Record<CatalogProviderSlug, CatalogProviderDefinition> = {
  openai: {
    slug: "openai", name: "OpenAI", homepageUrl: "https://openai.com", label: "OpenAI model catalog",
    collectorEnv: "BRIGHTDATA_OPENAI_CATALOG_COLLECTOR_ID", defaultCollectorId: DEFAULT_OPENAI_CATALOG_COLLECTOR_ID,
    sourceUrlEnv: "OPENAI_CATALOG_SOURCE_URL", defaultSourceUrl: DEFAULT_OPENAI_CATALOG_SOURCE_URL,
    adapt: adaptOpenAiCatalogRecord,
  },
  anthropic: {
    slug: "anthropic", name: "Anthropic", homepageUrl: "https://www.anthropic.com", label: "Anthropic model catalog",
    collectorEnv: "BRIGHTDATA_ANTHROPIC_CATALOG_COLLECTOR_ID", defaultCollectorId: DEFAULT_ANTHROPIC_CATALOG_COLLECTOR_ID,
    sourceUrlEnv: "ANTHROPIC_CATALOG_SOURCE_URL", defaultSourceUrl: DEFAULT_ANTHROPIC_CATALOG_SOURCE_URL,
    adapt: adaptAnthropicCatalogRecord,
  },
  gemini: {
    slug: "gemini", name: "Google", homepageUrl: "https://ai.google.dev", label: "Google Gemini model catalog",
    collectorEnv: "BRIGHTDATA_GEMINI_CATALOG_COLLECTOR_ID", defaultCollectorId: DEFAULT_GEMINI_CATALOG_COLLECTOR_ID,
    sourceUrlEnv: "GEMINI_CATALOG_SOURCE_URL", defaultSourceUrl: DEFAULT_GEMINI_CATALOG_SOURCE_URL,
    adapt: adaptGeminiCatalogRecord,
  },
  xai: {
    slug: "xai", name: "xAI", homepageUrl: "https://x.ai", label: "xAI model catalog",
    collectorEnv: "BRIGHTDATA_XAI_CATALOG_COLLECTOR_ID", defaultCollectorId: DEFAULT_XAI_CATALOG_COLLECTOR_ID,
    sourceUrlEnv: "XAI_CATALOG_SOURCE_URL", defaultSourceUrl: DEFAULT_XAI_CATALOG_SOURCE_URL,
    adapt: adaptXaiCatalogRecord,
  },
};

export function resolvePricingProviderConfiguration(provider: PricingProviderDefinition) {
  return {
    collectorId: process.env[provider.collectorEnv] ?? provider.defaultCollectorId,
    sourceUrl: process.env[provider.sourceUrlEnv] ?? provider.defaultSourceUrl,
  };
}

export function resolveCatalogProviderConfiguration(provider: CatalogProviderDefinition) {
  return {
    collectorId: process.env[provider.collectorEnv] ?? provider.defaultCollectorId,
    sourceUrl: process.env[provider.sourceUrlEnv] ?? provider.defaultSourceUrl,
  };
}
