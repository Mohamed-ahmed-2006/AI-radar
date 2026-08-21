/**
 * Sentinel Autonomous Scraper Studio Healing Integration
 */

import {
  BrightDataAuthError,
  BrightDataCollectorError,
  BrightDataConfigError,
  BrightDataRateLimitError,
} from "../brightdata/errors";
import { evaluateSourceHealth } from "./evaluator";
import type {
  SentinelEvaluationResult,
  SentinelHealingExecutionOptions,
  SentinelHealingExecutionResult,
  SourceHealthContract,
} from "./types";

export interface SentinelHealer {
  healScraper<T = unknown>(
    options: SentinelHealingExecutionOptions,
    contract: SourceHealthContract<T>,
    fetchCandidateRecords?: (collectorId: string) => Promise<unknown[]>,
  ): Promise<SentinelHealingExecutionResult<T>>;
}

/**
 * Automatically crafts a concise, high-signal repair prompt for Bright Data Scraper Studio AI refactor.
 */
export function generateHealingPrompt(
  evaluation: SentinelEvaluationResult,
  options: {
    sourceUrl?: string;
    providerName?: string;
    collectorId?: string;
  } = {},
): string {
  const issues = evaluation.issues.slice(0, 5).map((iss) => iss.message).join("; ");
  const reasons = evaluation.reasonCodes.join(", ");
  const urlPart = options.sourceUrl ? ` on ${options.sourceUrl}` : "";
  const providerPart = options.providerName ? ` for ${options.providerName}` : "";

  let prompt = `Fix scraper extraction${providerPart}${urlPart}. `;

  if (evaluation.reasonCodes.includes("ZERO_RECORDS")) {
    prompt += "Scraper extracted 0 records. DOM selectors may have moved. Locate and extract all pricing rows again.";
  } else if (evaluation.reasonCodes.includes("ALL_PRICES_NULL")) {
    prompt += "All price values extracted as null. Inspect table cells/spans and capture numeric input/output token prices.";
  } else if (evaluation.reasonCodes.includes("CAPABILITY_TOKEN_LIMITS_MISSING")) {
    prompt +=
      "Every record lost its context window and/or max output value. Re-locate the model " +
      "comparison table and capture the context window and max output cells verbatim, " +
      "including shorthand such as '1M tokens' or '128k tokens'.";
  } else if (evaluation.reasonCodes.includes("RECORD_COUNT_COLLAPSE")) {
    prompt += `Extracted records collapsed unexpectedly (${evaluation.recordsValid} valid vs expected). Ensure pagination/containers capture all models.`;
  } else if (evaluation.reasonCodes.includes("ILLEGAL_ENUM_VALUE") || evaluation.reasonCodes.includes("SCHEMA_VALIDATION_FAILURE")) {
    prompt += `Extraction failed schema validation: ${issues || reasons}. Normalize field types and required identifiers.`;
  } else {
    prompt += `Anomaly detected: ${reasons}. Issues: ${issues}.`;
  }

  // Enforce DCA API 1000 chars limit
  return prompt.slice(0, 990);
}

/**
 * Production Bright Data Scraper Studio AI Healer.
 * Interacts with DCA API `/refactor_template` and gates template save on Sentinel contract validation.
 */
export class BrightDataScraperHealer implements SentinelHealer {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: { apiKey?: string; baseUrl?: string; fetchFn?: typeof fetch } = {}) {
    this.apiKey = config.apiKey || process.env.BRIGHTDATA_API_KEY;
    this.baseUrl = (
      config.baseUrl ||
      process.env.BRIGHTDATA_BASE_URL ||
      "https://api.brightdata.com"
    ).replace(/\/+$/, "");
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
  }

  private getAuthHeaders(): Record<string, string> {
    if (!this.apiKey || this.apiKey.trim() === "") {
      throw new BrightDataConfigError(
        "Bright Data API key is missing. Set BRIGHTDATA_API_KEY environment variable to enable live autonomous self-healing.",
      );
    }
    return {
      Authorization: `Bearer ${this.apiKey.trim()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  public async healScraper<T = unknown>(
    options: SentinelHealingExecutionOptions,
    contract: SourceHealthContract<T>,
    fetchCandidateRecords?: (collectorId: string) => Promise<unknown[]>,
  ): Promise<SentinelHealingExecutionResult<T>> {
    const collectorId = options.collectorId?.trim();
    if (!collectorId) {
      throw new BrightDataCollectorError("Collector ID must be provided to initiate healing");
    }

    const headers = this.getAuthHeaders();
    const prompt = options.prompt.trim().slice(0, 1000);
    const timeoutSeconds = options.timeoutSeconds ?? 180;
    const triggerUrl = `${this.baseUrl}/dca/collectors/${encodeURIComponent(collectorId)}/refactor_template`;

    // 1. Trigger refactor job
    let triggerRes: Response;
    try {
      triggerRes = await this.fetchFn(triggerUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt, custom_input: [] }),
      });
    } catch (err) {
      return {
        success: false,
        status: "failed",
        error: `Network error triggering refactor: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (triggerRes.status === 401 || triggerRes.status === 403) {
      throw new BrightDataAuthError("Authentication failed triggering Scraper Studio refactor", triggerRes.status);
    }
    if (triggerRes.status === 429) {
      throw new BrightDataRateLimitError("Rate limit reached on AI-Flow parallel jobs");
    }
    if (!triggerRes.ok) {
      const errorText = await triggerRes.text();
      return {
        success: false,
        status: "failed",
        error: `API error ${triggerRes.status} triggering refactor: ${errorText}`,
      };
    }

    // 2. Poll refactor progress
    const progressUrl = `${this.baseUrl}/dca/collectors/${encodeURIComponent(collectorId)}/refactor_template/progress`;
    const startTime = Date.now();
    const pollIntervalMs = 3000;
    let attempts = 0;
    let lastProgress: Record<string, unknown> | null = null;
    let hitApprovalGate = false;

    while (Date.now() - startTime < timeoutSeconds * 1000) {
      attempts += 1;
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

      let progRes: Response;
      try {
        progRes = await this.fetchFn(progressUrl, { method: "GET", headers });
      } catch {
        continue;
      }

      if (!progRes.ok) continue;

      const progress = (await progRes.json()) as Record<string, unknown>;
      lastProgress = progress;
      const status = String(progress.status || progress.state || "");
      const step = String(progress.step || "");

      if (options.onProgress) {
        options.onProgress({
          attemptNumber: attempts,
          status,
          step,
          message: String(progress.description || ""),
        });
      }

      if (status === "pending_answer" || status === "__awaiting_approval__") {
        hitApprovalGate = true;
        break;
      }

      if (status === "done" || status === "success") {
        break;
      }

      if (status === "failed" || status === "error" || status === "cancelled") {
        return {
          success: false,
          status: "failed",
          error: `Refactor job failed with status: ${status}`,
          viewUrl: `https://brightdata.com/cp/scrapers/${collectorId}`,
        };
      }
    }

    if (!lastProgress && Date.now() - startTime >= timeoutSeconds * 1000) {
      return {
        success: false,
        status: "timed_out",
        error: `Healing refactor timed out after ${timeoutSeconds}s`,
      };
    }

    // 3. Test & Validate candidate scraper before approving
    let candidateData: T[] = [];
    let candidateRaw: unknown[] = [];
    let candidatePassed = false;

    if (fetchCandidateRecords) {
      try {
        candidateRaw = await fetchCandidateRecords(collectorId);
        const evalResult = evaluateSourceHealth(candidateRaw, contract);
        candidatePassed = evalResult.isHealthy && !evalResult.shouldQuarantine;
        if (candidatePassed) {
          candidateData = evalResult.validRecords;
        }
      } catch {
        candidatePassed = false;
      }
    } else {
      // If preview_result exists in progress
      if (Array.isArray(lastProgress?.preview_result)) {
        candidateRaw = lastProgress.preview_result;
        const evalResult = evaluateSourceHealth(candidateRaw, contract);
        candidatePassed = evalResult.isHealthy && !evalResult.shouldQuarantine;
        if (candidatePassed) {
          candidateData = evalResult.validRecords;
        }
      } else {
        // Without test fetcher or preview, cannot auto-approve blindly
        candidatePassed = false;
      }
    }

    // 4. Resume automation job (approve or reject) if at approval gate
    if (hitApprovalGate) {
      const resumeUrl = `${this.baseUrl}/dca/collectors/${encodeURIComponent(collectorId)}/resume_automation_job`;
      const shouldApprove = candidatePassed;
      const resumeBody = shouldApprove ? { message: true, auto_save: true } : { message: false };

      try {
        await this.fetchFn(resumeUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(resumeBody),
        });
      } catch {
        // Log resume failure
      }

      return {
        success: shouldApprove,
        status: shouldApprove ? "approved" : "rejected",
        candidateData: shouldApprove ? candidateData : undefined,
        candidateRaw,
        error: shouldApprove ? undefined : "Candidate scraper failed Sentinel validation checks",
        diffSummary: String(lastProgress?.diff ? "Refactored steps pending" : ""),
        viewUrl: `https://brightdata.com/cp/scrapers/${collectorId}`,
      };
    }

    return {
      success: candidatePassed,
      status: candidatePassed ? "approved" : "rejected",
      candidateData: candidatePassed ? candidateData : undefined,
      candidateRaw,
      viewUrl: `https://brightdata.com/cp/scrapers/${collectorId}`,
    };
  }
}

/**
 * In-memory Mock Healer for deterministic unit testing, development, and hackathon demo.
 */
export class MockSentinelHealer implements SentinelHealer {
  private mode: "succeed" | "fail_validation" | "error" | "timeout";
  private mockCandidateRecords: unknown[];
  public recordedAttempts: SentinelHealingExecutionOptions[] = [];

  constructor(
    mode: "succeed" | "fail_validation" | "error" | "timeout" = "succeed",
    mockCandidateRecords: unknown[] = [],
  ) {
    this.mode = mode;
    this.mockCandidateRecords = mockCandidateRecords;
  }

  public setMode(mode: "succeed" | "fail_validation" | "error" | "timeout", records?: unknown[]) {
    this.mode = mode;
    if (records) this.mockCandidateRecords = records;
  }

  public async healScraper<T = unknown>(
    options: SentinelHealingExecutionOptions,
    contract: SourceHealthContract<T>,
  ): Promise<SentinelHealingExecutionResult<T>> {
    this.recordedAttempts.push(options);

    if (this.mode === "error") {
      return {
        success: false,
        status: "failed",
        error: "Simulated Scraper Studio refactor error (e.g. 500 API failure)",
      };
    }

    if (this.mode === "timeout") {
      return {
        success: false,
        status: "timed_out",
        error: "Simulated Scraper Studio refactor timeout",
      };
    }

    if (this.mode === "fail_validation") {
      // Simulate broken candidate output
      const badCandidate = this.mockCandidateRecords.length > 0
        ? this.mockCandidateRecords
        : [{ invalid_field: "corrupt_data" }];
      const evalResult = evaluateSourceHealth(badCandidate, contract);

      return {
        success: false,
        status: "rejected",
        candidateRaw: badCandidate,
        error: `Repaired candidate failed Sentinel contract: ${evalResult.summary}`,
        viewUrl: `https://brightdata.com/cp/scrapers/${options.collectorId}`,
      };
    }

    // Success mode: evaluate mock candidate
    const rawCandidate = this.mockCandidateRecords;
    const evalResult = evaluateSourceHealth(rawCandidate, contract);

    return {
      success: evalResult.isHealthy,
      status: evalResult.isHealthy ? "approved" : "rejected",
      candidateData: evalResult.validRecords,
      candidateRaw: rawCandidate,
      viewUrl: `https://brightdata.com/cp/scrapers/${options.collectorId}`,
    };
  }
}
