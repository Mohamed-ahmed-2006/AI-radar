/**
 * Bright Data Ingestion Type Definitions
 */

export interface BrightDataClientConfig {
  /**
   * Bright Data API key/token.
   * If omitted, falls back to process.env.BRIGHTDATA_API_KEY.
   */
  apiKey?: string;

  /**
   * Base URL for Bright Data API.
   * Defaults to 'https://api.brightdata.com'.
   */
  baseUrl?: string;

  /**
   * Default polling interval in milliseconds.
   * Defaults to 2000 ms (2 seconds).
   */
  defaultPollIntervalMs?: number;

  /**
   * Default timeout for polling a dataset in milliseconds.
   * Defaults to 120000 ms (2 minutes).
   */
  defaultPollTimeoutMs?: number;

  /**
   * Optional custom fetch implementation (useful for tests or proxies).
   */
  fetchFn?: typeof fetch;
}

export interface CollectorTriggerOptions<TInput = Record<string, unknown>> {
  /**
   * The Bright Data Scraper Studio Collector ID (e.g. 'c_msx3bqlyjtv2qustx').
   */
  collectorId: string;

  /**
   * Input payload array passed to the collector.
   * Defaults to empty array [].
   */
  inputs?: TInput[];
}

export interface CollectorPollProgress {
  attempt: number;
  elapsedMs: number;
  status?: string;
  message?: string;
}

export interface CollectorPollOptions {
  /**
   * Polling interval in milliseconds.
   */
  pollIntervalMs?: number;

  /**
   * Maximum duration to wait before timing out in milliseconds.
   */
  pollTimeoutMs?: number;

  /**
   * Optional progress callback invoked on each poll attempt.
   */
  onProgress?: (progress: CollectorPollProgress) => void;
}

export interface CollectorRunOptions<TInput = Record<string, unknown>, TOutput = unknown>
  extends CollectorTriggerOptions<TInput>,
    CollectorPollOptions {
  /**
   * Custom parser function to transform raw record objects into typed models.
   */
  parser?: (item: unknown, index: number) => TOutput;
}

export type CollectorRunStatus = "success" | "failed" | "timeout";

export interface CollectorRunMetadata {
  /**
   * The Collector ID targeted during this run.
   */
  collectorId: string;

  /**
   * The snapshot/collection ID returned by Bright Data (e.g. 'j_...').
   */
  runId?: string;

  /**
   * ISO 8601 timestamp when the trigger request was initiated.
   */
  startedAt: string;

  /**
   * ISO 8601 timestamp when the run finished (success, timeout, or failure).
   */
  completedAt: string;

  /**
   * Total elapsed time in milliseconds.
   */
  durationMs: number;

  /**
   * Total number of valid records returned.
   */
  resultCount: number;

  /**
   * Outcome status of the run.
   */
  status: CollectorRunStatus;

  /**
   * Error message if the run failed.
   */
  error?: string;
}

export interface CollectorRunResult<TData> {
  success: boolean;
  data: TData[];
  metadata: CollectorRunMetadata;
  error?: Error;
}
