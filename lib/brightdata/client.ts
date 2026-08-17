import {
  BrightDataAuthError,
  BrightDataCollectorError,
  BrightDataConfigError,
  BrightDataError,
  BrightDataRateLimitError,
  BrightDataTimeoutError,
} from "./errors";
import type {
  BrightDataClientConfig,
  CollectorPollOptions,
  CollectorRunMetadata,
  CollectorRunOptions,
  CollectorRunResult,
  CollectorTriggerOptions,
} from "./types";

export class BrightDataClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly defaultPollIntervalMs: number;
  private readonly defaultPollTimeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(config: BrightDataClientConfig = {}) {
    this.apiKey = config.apiKey || process.env.BRIGHTDATA_API_KEY;
    this.baseUrl = (
      config.baseUrl ||
      process.env.BRIGHTDATA_BASE_URL ||
      "https://api.brightdata.com"
    ).replace(/\/+$/, "");

    this.defaultPollIntervalMs =
      config.defaultPollIntervalMs ??
      (process.env.BRIGHTDATA_POLL_INTERVAL_MS
        ? parseInt(process.env.BRIGHTDATA_POLL_INTERVAL_MS, 10)
        : 2000);

    this.defaultPollTimeoutMs =
      config.defaultPollTimeoutMs ??
      (process.env.BRIGHTDATA_POLL_TIMEOUT_MS
        ? parseInt(process.env.BRIGHTDATA_POLL_TIMEOUT_MS, 10)
        : 120000);

    this.fetchFn = config.fetchFn ?? globalThis.fetch;
  }

  /**
   * Instantiate BrightDataClient using environment variables and optional overrides.
   */
  public static fromEnv(overrides: Partial<BrightDataClientConfig> = {}): BrightDataClient {
    return new BrightDataClient(overrides);
  }

  /**
   * Get authorized HTTP headers.
   * Throws BrightDataConfigError if no API key is provided.
   */
  private getAuthHeaders(): Record<string, string> {
    if (!this.apiKey || this.apiKey.trim() === "") {
      throw new BrightDataConfigError(
        "Bright Data API key is missing. Set BRIGHTDATA_API_KEY environment variable or supply apiKey in configuration."
      );
    }

    return {
      Authorization: `Bearer ${this.apiKey.trim()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  /**
   * Trigger a Scraper Studio collector asynchronously.
   *
   * @param optionsOrId - Collector ID string or CollectorTriggerOptions object
   * @param optionalInputs - Optional inputs array when optionsOrId is a collector ID string
   * @returns Object containing the runId (collection_id / snapshot_id)
   */
  public async triggerCollector<TInput = Record<string, unknown>>(
    optionsOrId: string | CollectorTriggerOptions<TInput>,
    optionalInputs?: TInput[]
  ): Promise<{ runId: string }> {
    const collectorId = typeof optionsOrId === "string" ? optionsOrId : optionsOrId.collectorId;
    const inputs =
      typeof optionsOrId === "string"
        ? (optionalInputs ?? [])
        : (optionsOrId.inputs ?? []);

    if (!collectorId || collectorId.trim() === "") {
      throw new BrightDataCollectorError("Collector ID must be a non-empty string");
    }

    const headers = this.getAuthHeaders();
    const url = `${this.baseUrl}/dca/trigger?collector=${encodeURIComponent(collectorId.trim())}`;

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers,
        body: JSON.stringify(inputs),
      });
    } catch (err) {
      throw new BrightDataCollectorError(
        `Network error while triggering collector '${collectorId}': ${err instanceof Error ? err.message : String(err)}`,
        { collectorId, details: err }
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new BrightDataAuthError(
        `Authentication failed triggering collector '${collectorId}' (HTTP ${response.status})`,
        response.status
      );
    }

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : undefined;
      throw new BrightDataRateLimitError(
        `Rate limit exceeded when triggering collector '${collectorId}'`,
        retryAfterMs
      );
    }

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }
      throw new BrightDataCollectorError(
        `Bright Data API returned error ${response.status} triggering collector '${collectorId}': ${JSON.stringify(errorBody)}`,
        { statusCode: response.status, collectorId, details: errorBody }
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    const runId = (data.collection_id ||
      data.snapshot_id ||
      data.id ||
      data.response_id) as string | undefined;

    if (!runId || typeof runId !== "string") {
      throw new BrightDataCollectorError(
        `Unexpected trigger response format: missing collection/snapshot ID in response: ${JSON.stringify(data)}`,
        { collectorId, details: data }
      );
    }

    return { runId };
  }

  /**
   * Poll for results of a dataset / snapshot run until completion or timeout.
   *
   * @param runId - The collection_id / snapshot_id returned by triggerCollector
   * @param options - Polling options (interval, timeout, progress callback)
   * @returns Raw array of records returned by the collector
   */
  public async pollDataset(
    runId: string,
    options: CollectorPollOptions = {}
  ): Promise<unknown[]> {
    if (!runId || runId.trim() === "") {
      throw new BrightDataCollectorError("runId must be a non-empty string");
    }

    const headers = this.getAuthHeaders();
    const pollIntervalMs = options.pollIntervalMs ?? this.defaultPollIntervalMs;
    const pollTimeoutMs = options.pollTimeoutMs ?? this.defaultPollTimeoutMs;
    const url = `${this.baseUrl}/dca/dataset?id=${encodeURIComponent(runId.trim())}&format=json`;

    const startTime = Date.now();
    let attempt = 0;

    while (Date.now() - startTime < pollTimeoutMs) {
      attempt += 1;
      const elapsedMs = Date.now() - startTime;

      let response: Response;
      try {
        response = await this.fetchFn(url, {
          method: "GET",
          headers,
        });
      } catch (err) {
        throw new BrightDataCollectorError(
          `Network error polling dataset '${runId}': ${err instanceof Error ? err.message : String(err)}`,
          { runId, details: err }
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new BrightDataAuthError(
          `Authentication failed while polling dataset '${runId}' (HTTP ${response.status})`,
          response.status
        );
      }

      if (response.status === 429) {
        // Rate limited during polling: wait a tick before next attempt
        await this.delay(pollIntervalMs);
        continue;
      }

      if (!response.ok && response.status !== 202) {
        let errorBody: unknown;
        try {
          errorBody = await response.json();
        } catch {
          errorBody = await response.text();
        }
        throw new BrightDataCollectorError(
          `Bright Data API returned error ${response.status} while polling dataset '${runId}': ${JSON.stringify(errorBody)}`,
          { statusCode: response.status, runId, details: errorBody }
        );
      }

      const body = (await response.json()) as unknown;

      // When the dataset is ready, Bright Data returns an array of records
      if (Array.isArray(body)) {
        return body;
      }

      // Check for object response with status or error
      if (body && typeof body === "object") {
        const bodyObj = body as Record<string, unknown>;
        const status = (bodyObj.status || bodyObj.state) as string | undefined;
        const message = (bodyObj.message || bodyObj.description) as string | undefined;

        if (status === "failed" || status === "error") {
          throw new BrightDataCollectorError(
            `Collector run '${runId}' failed with status '${status}': ${message || JSON.stringify(bodyObj)}`,
            { runId, details: bodyObj }
          );
        }

        if (status === "ready" && Array.isArray(bodyObj.data)) {
          return bodyObj.data;
        }

        // Still in progress (e.g. status: "building", "running", "collecting", "pending")
        if (options.onProgress) {
          options.onProgress({
            attempt,
            elapsedMs,
            status: status || "processing",
            message,
          });
        }
      }

      // Wait before next polling attempt
      const remainingTime = pollTimeoutMs - (Date.now() - startTime);
      if (remainingTime <= 0) {
        break;
      }
      await this.delay(Math.min(pollIntervalMs, remainingTime));
    }

    throw new BrightDataTimeoutError(
      `Dataset polling for run '${runId}' timed out after ${pollTimeoutMs}ms`,
      pollTimeoutMs,
      runId
    );
  }

  /**
   * Execute a collector end-to-end: trigger, poll for completion, parse records, and track metadata.
   *
   * @param options - Collector execution parameters
   * @returns CollectorRunResult containing parsed data, status, and health monitoring metadata
   */
  public async runCollector<TInput = Record<string, unknown>, TOutput = unknown>(
    options: CollectorRunOptions<TInput, TOutput>
  ): Promise<CollectorRunResult<TOutput>> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    let runId: string | undefined;

    try {
      // 1. Trigger collector
      const triggerRes = await this.triggerCollector({
        collectorId: options.collectorId,
        inputs: options.inputs,
      });
      runId = triggerRes.runId;

      // 2. Poll for results
      const rawRecords = await this.pollDataset(runId, {
        pollIntervalMs: options.pollIntervalMs,
        pollTimeoutMs: options.pollTimeoutMs,
        onProgress: options.onProgress,
      });

      // 3. Parse records
      const parsedRecords: TOutput[] = options.parser
        ? rawRecords.map((record, index) => options.parser!(record, index))
        : (rawRecords as unknown as TOutput[]);

      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;

      const metadata: CollectorRunMetadata = {
        collectorId: options.collectorId,
        runId,
        startedAt,
        completedAt,
        durationMs,
        resultCount: parsedRecords.length,
        status: "success",
      };

      return {
        success: true,
        data: parsedRecords,
        metadata,
      };
    } catch (err) {
      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;
      const isTimeout = err instanceof BrightDataTimeoutError;
      const status = isTimeout ? "timeout" : "failed";
      const errorMessage = err instanceof Error ? err.message : String(err);

      const metadata: CollectorRunMetadata = {
        collectorId: options.collectorId,
        runId,
        startedAt,
        completedAt,
        durationMs,
        resultCount: 0,
        status,
        error: errorMessage,
      };

      return {
        success: false,
        data: [],
        metadata,
        error: err instanceof Error ? err : new BrightDataError(errorMessage),
      };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
