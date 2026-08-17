import { BrightDataClient } from "../client";
import { fetchPricingCollector } from "./pricing";
import type { CollectorPollProgress, CollectorRunResult } from "../types";

export const DEFAULT_OPENAI_COLLECTOR_ID = "c_msx3bqlyjtv2qustx";
export const DEFAULT_OPENAI_PRICING_SOURCE_URL =
  "https://developers.openai.com/api/docs/pricing";

export interface FetchOpenAIPricingOptions {
  /**
   * Optional pre-configured BrightDataClient instance.
   * If omitted, a new client is instantiated via BrightDataClient.fromEnv().
   */
  client?: BrightDataClient;

  /**
   * Collector ID override.
   * Defaults to process.env.BRIGHTDATA_OPENAI_COLLECTOR_ID or 'c_msx3bqlyjtv2qustx'.
   */
  collectorId?: string;

  /**
   * Target pricing URL override.
   * Defaults to process.env.OPENAI_PRICING_SOURCE_URL or 'https://developers.openai.com/api/docs/pricing'.
   */
  sourceUrl?: string;

  /**
   * Polling interval in milliseconds.
   */
  pollIntervalMs?: number;

  /**
   * Polling timeout in milliseconds.
   */
  pollTimeoutMs?: number;

  /**
   * Optional callback to track polling progress.
   */
  onProgress?: (progress: CollectorPollProgress) => void;
}

/**
 * Executes the OpenAI Pricing Collector via Bright Data Scraper Studio.
 *
 * @param options - Configuration and override options
 * @returns Result with transport-decoded records and run metadata. Validation
 * is performed per record by the server-only ingestion pipeline.
 */
export async function fetchOpenAIPricing(
  options: FetchOpenAIPricingOptions = {}
): Promise<CollectorRunResult<unknown>> {
  const collectorId = (
    options.collectorId ||
    process.env.BRIGHTDATA_OPENAI_COLLECTOR_ID ||
    DEFAULT_OPENAI_COLLECTOR_ID
  ).trim();

  const sourceUrl = (
    options.sourceUrl ||
    process.env.OPENAI_PRICING_SOURCE_URL ||
    DEFAULT_OPENAI_PRICING_SOURCE_URL
  ).trim();

  return fetchPricingCollector({
    client: options.client,
    collectorId,
    sourceUrl,
    pollIntervalMs: options.pollIntervalMs,
    pollTimeoutMs: options.pollTimeoutMs,
    onProgress: options.onProgress,
  });
}
