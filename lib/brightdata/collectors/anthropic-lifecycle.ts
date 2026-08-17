import { BrightDataClient } from "../client";
import type { CollectorPollProgress, CollectorRunResult } from "../types";

export const DEFAULT_ANTHROPIC_LIFECYCLE_COLLECTOR_ID = "c_msxj0fk3153bu9oz7l";
export const DEFAULT_ANTHROPIC_LIFECYCLE_SOURCE_URL =
  "https://platform.claude.com/docs/en/about-claude/model-deprecations";

export interface FetchAnthropicLifecycleOptions {
  client?: BrightDataClient;
  collectorId?: string;
  sourceUrl?: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  onProgress?: (progress: CollectorPollProgress) => void;
}

export async function fetchAnthropicLifecycle(
  options: FetchAnthropicLifecycleOptions = {},
): Promise<CollectorRunResult<unknown>> {
  const client = options.client ?? BrightDataClient.fromEnv();
  const collectorId = (
    options.collectorId ??
    process.env.BRIGHTDATA_ANTHROPIC_LIFECYCLE_COLLECTOR_ID ??
    DEFAULT_ANTHROPIC_LIFECYCLE_COLLECTOR_ID
  ).trim();
  const sourceUrl = (
    options.sourceUrl ??
    process.env.ANTHROPIC_LIFECYCLE_SOURCE_URL ??
    DEFAULT_ANTHROPIC_LIFECYCLE_SOURCE_URL
  ).trim();

  return client.runCollector<Record<string, unknown>, unknown>({
    collectorId,
    inputs: [{ url: sourceUrl }],
    pollIntervalMs: options.pollIntervalMs,
    pollTimeoutMs: options.pollTimeoutMs,
    onProgress: options.onProgress,
  });
}
