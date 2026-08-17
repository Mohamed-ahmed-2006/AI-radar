import { BrightDataClient } from "../client";
import { parseOpenAIPricingRecord } from "../schemas";
import type { OpenAIPricingRecord } from "../schemas";
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
 * @returns Result with parsed OpenAIPricingRecord array and run metadata
 */
export async function fetchOpenAIPricing(
  options: FetchOpenAIPricingOptions = {}
): Promise<CollectorRunResult<OpenAIPricingRecord>> {
  const client = options.client ?? BrightDataClient.fromEnv();

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

  const inputs = sourceUrl ? [{ url: sourceUrl }] : [];

  return client.runCollector<Record<string, unknown>, OpenAIPricingRecord>({
    collectorId,
    inputs,
    parser: parseOpenAIPricingRecord,
    pollIntervalMs: options.pollIntervalMs,
    pollTimeoutMs: options.pollTimeoutMs,
    onProgress: options.onProgress,
  });
}
