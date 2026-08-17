import { BrightDataClient } from "../client";
import type { CollectorPollProgress, CollectorRunResult } from "../types";

export interface FetchPricingCollectorOptions {
  client?: BrightDataClient;
  collectorId: string;
  sourceUrl: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  onProgress?: (progress: CollectorPollProgress) => void;
}

/** Runs a verified pricing collector and returns only transport-decoded rows. */
export async function fetchPricingCollector(
  options: FetchPricingCollectorOptions,
): Promise<CollectorRunResult<unknown>> {
  const client = options.client ?? BrightDataClient.fromEnv();
  return client.runCollector<Record<string, unknown>, unknown>({
    collectorId: options.collectorId.trim(),
    inputs: [{ url: options.sourceUrl.trim() }],
    pollIntervalMs: options.pollIntervalMs,
    pollTimeoutMs: options.pollTimeoutMs,
    onProgress: options.onProgress,
  });
}
