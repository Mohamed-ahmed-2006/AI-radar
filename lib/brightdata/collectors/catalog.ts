import { BrightDataClient } from "../client";
import type { CollectorPollProgress, CollectorRunResult } from "../types";

export const DEFAULT_OPENAI_CATALOG_COLLECTOR_ID = "c_msz67jyrmiom6mbvn";
export const DEFAULT_OPENAI_CATALOG_SOURCE_URL =
  "https://developers.openai.com/api/docs/models";

export const DEFAULT_ANTHROPIC_CATALOG_COLLECTOR_ID = "c_msz68u3ovithdetgu";
export const DEFAULT_ANTHROPIC_CATALOG_SOURCE_URL =
  "https://platform.claude.com/docs/en/about-claude/models/overview";

export const DEFAULT_GEMINI_CATALOG_COLLECTOR_ID = "c_msz708an1gawux0njo";
export const DEFAULT_GEMINI_CATALOG_SOURCE_URL =
  "https://ai.google.dev/gemini-api/docs/models";

export const DEFAULT_XAI_CATALOG_COLLECTOR_ID = "c_msz6ahaofpm2d9j73";
export const DEFAULT_XAI_CATALOG_SOURCE_URL = "https://docs.x.ai/developers/models";

export interface FetchCatalogCollectorOptions {
  client?: BrightDataClient;
  collectorId: string;
  sourceUrl: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  onProgress?: (progress: CollectorPollProgress) => void;
}

export async function fetchCatalogCollector(
  options: FetchCatalogCollectorOptions,
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

export async function fetchOpenAiCatalog(
  options: Partial<FetchCatalogCollectorOptions> = {},
): Promise<CollectorRunResult<unknown>> {
  const collectorId = (
    options.collectorId ??
    process.env.BRIGHTDATA_OPENAI_CATALOG_COLLECTOR_ID ??
    DEFAULT_OPENAI_CATALOG_COLLECTOR_ID
  ).trim();
  const sourceUrl = (
    options.sourceUrl ??
    process.env.OPENAI_CATALOG_SOURCE_URL ??
    DEFAULT_OPENAI_CATALOG_SOURCE_URL
  ).trim();

  return fetchCatalogCollector({ ...options, collectorId, sourceUrl });
}

export async function fetchAnthropicCatalog(
  options: Partial<FetchCatalogCollectorOptions> = {},
): Promise<CollectorRunResult<unknown>> {
  const collectorId = (
    options.collectorId ??
    process.env.BRIGHTDATA_ANTHROPIC_CATALOG_COLLECTOR_ID ??
    DEFAULT_ANTHROPIC_CATALOG_COLLECTOR_ID
  ).trim();
  const sourceUrl = (
    options.sourceUrl ??
    process.env.ANTHROPIC_CATALOG_SOURCE_URL ??
    DEFAULT_ANTHROPIC_CATALOG_SOURCE_URL
  ).trim();

  return fetchCatalogCollector({ ...options, collectorId, sourceUrl });
}

export async function fetchGeminiCatalog(
  options: Partial<FetchCatalogCollectorOptions> = {},
): Promise<CollectorRunResult<unknown>> {
  const collectorId = (
    options.collectorId ??
    process.env.BRIGHTDATA_GEMINI_CATALOG_COLLECTOR_ID ??
    DEFAULT_GEMINI_CATALOG_COLLECTOR_ID
  ).trim();
  const sourceUrl = (
    options.sourceUrl ??
    process.env.GEMINI_CATALOG_SOURCE_URL ??
    DEFAULT_GEMINI_CATALOG_SOURCE_URL
  ).trim();

  return fetchCatalogCollector({ ...options, collectorId, sourceUrl });
}

export async function fetchXaiCatalog(
  options: Partial<FetchCatalogCollectorOptions> = {},
): Promise<CollectorRunResult<unknown>> {
  const collectorId = (
    options.collectorId ??
    process.env.BRIGHTDATA_XAI_CATALOG_COLLECTOR_ID ??
    DEFAULT_XAI_CATALOG_COLLECTOR_ID
  ).trim();
  const sourceUrl = (
    options.sourceUrl ??
    process.env.XAI_CATALOG_SOURCE_URL ??
    DEFAULT_XAI_CATALOG_SOURCE_URL
  ).trim();

  return fetchCatalogCollector({ ...options, collectorId, sourceUrl });
}
