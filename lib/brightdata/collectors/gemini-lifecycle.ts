import { BrightDataClient } from "../client";
import type { CollectorPollProgress, CollectorRunResult } from "../types";

export const DEFAULT_GEMINI_LIFECYCLE_COLLECTOR_ID = "c_msxqpelk2cpxz8r386";
export const DEFAULT_GEMINI_LIFECYCLE_SOURCE_URL =
  "https://ai.google.dev/gemini-api/docs/deprecations";

export interface FetchGeminiLifecycleOptions {
  client?: BrightDataClient;
  collectorId?: string;
  sourceUrl?: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  onProgress?: (progress: CollectorPollProgress) => void;
}

export async function fetchGeminiLifecycle(
  options: FetchGeminiLifecycleOptions = {},
): Promise<CollectorRunResult<unknown>> {
  const client = options.client ?? BrightDataClient.fromEnv();
  const collectorId = (
    options.collectorId ??
    process.env.BRIGHTDATA_GEMINI_LIFECYCLE_COLLECTOR_ID ??
    DEFAULT_GEMINI_LIFECYCLE_COLLECTOR_ID
  ).trim();
  const sourceUrl = (
    options.sourceUrl ??
    process.env.GEMINI_LIFECYCLE_SOURCE_URL ??
    DEFAULT_GEMINI_LIFECYCLE_SOURCE_URL
  ).trim();

  return client.runCollector<Record<string, unknown>, unknown>({
    collectorId,
    inputs: [{ url: sourceUrl }],
    pollIntervalMs: options.pollIntervalMs,
    pollTimeoutMs: options.pollTimeoutMs,
    onProgress: options.onProgress,
  });
}
