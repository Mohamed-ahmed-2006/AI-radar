import {
  adaptAnthropicPricingRecord,
  adaptGeminiPricingRecord,
  adaptOpenAiPricingRecord,
  adaptXaiPricingRecord,
} from "../brightdata/adapters/pricing";

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

export function resolvePricingProviderConfiguration(provider: PricingProviderDefinition) {
  return {
    collectorId: process.env[provider.collectorEnv] ?? provider.defaultCollectorId,
    sourceUrl: process.env[provider.sourceUrlEnv] ?? provider.defaultSourceUrl,
  };
}
