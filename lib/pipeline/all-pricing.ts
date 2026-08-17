import {
  ingestAnthropicPricing,
  ingestGeminiPricing,
  ingestOpenAiPricing,
  ingestXaiPricing,
  PricingIngestionError,
  type IngestOpenAiPricingOptions,
  type OpenAiPricingIngestionResult,
} from "./openai-pricing";
import type { PricingProviderSlug } from "./providers";

export type ProviderIngestor = (
  options?: IngestOpenAiPricingOptions,
) => Promise<OpenAiPricingIngestionResult>;

export interface ProviderIngestionSummary {
  provider: PricingProviderSlug;
  success: boolean;
  collectionRunId: string | null;
  externalBrightDataRunId: string | null;
  acceptedCount: number;
  rejectedCount: number;
  changesDetected: number;
  durationMs: number;
  error?: "ingestion_failed";
}

const defaultIngestors: Record<PricingProviderSlug, ProviderIngestor> = {
  openai: ingestOpenAiPricing,
  anthropic: ingestAnthropicPricing,
  gemini: ingestGeminiPricing,
  xai: ingestXaiPricing,
};

/** Sequential by design: one provider failure never masks earlier successes. */
export async function ingestAllPricing(
  options: {
    ingestors?: Partial<Record<PricingProviderSlug, ProviderIngestor>>;
    triggeredBy?: string;
  } = {},
): Promise<ProviderIngestionSummary[]> {
  const summaries: ProviderIngestionSummary[] = [];
  for (const provider of Object.keys(defaultIngestors) as PricingProviderSlug[]) {
    const ingest = options.ingestors?.[provider] ?? defaultIngestors[provider];
    try {
      const result = await ingest({ triggeredBy: options.triggeredBy ?? "manual-api-all" });
      summaries.push({
        provider,
        success: true,
        collectionRunId: result.collectionRunId,
        externalBrightDataRunId: result.externalRunId ?? null,
        acceptedCount: result.acceptedCount,
        rejectedCount: result.rejectedCount,
        changesDetected: result.changesDetected,
        durationMs: result.durationMs,
      });
    } catch (error) {
      const ingestionError = error instanceof PricingIngestionError ? error : undefined;
      summaries.push({
        provider,
        success: false,
        collectionRunId: ingestionError?.collectionRunId ?? null,
        externalBrightDataRunId: ingestionError?.externalRunId ?? null,
        acceptedCount: 0,
        rejectedCount: 0,
        changesDetected: 0,
        durationMs: 0,
        error: "ingestion_failed",
      });
    }
  }
  return summaries;
}
