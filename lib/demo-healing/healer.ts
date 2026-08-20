/**
 * Real Bright Data Scraper Studio healing for the demo source.
 *
 * Split into explicit phases on purpose. The single-call
 * `BrightDataScraperHealer` decides approval internally, which is fine for the
 * autonomous fleet but hides the step the demo has to show: Bright Data offers
 * a candidate, *Sentinel* judges it, and only then is it approved.
 *
 * So this driver stops at the approval gate and hands the preview back. The
 * decision to approve lives in the orchestrator, and it is made by running the
 * preview through the same contract evaluation as any other payload.
 */

import { DcaTemplateClient, type DcaRefactorProgress } from "../brightdata/dca";
import { BrightDataCollectorError } from "../brightdata/errors";
import type { SentinelEvaluationResult } from "../sentinel/types";

export interface DemoHealRequest {
  collectorId: string;
  prompt: string;
  /**
   * The URL that actually produced the failure. Bright Data otherwise previews
   * the repair against the template's stored input, which is the layout the
   * collector already worked on, so the candidate never sees what broke.
   */
  sourceUrl?: string;
}

export type DemoHealGateOutcome =
  | {
      /** Bright Data is holding a candidate template for a decision. */
      kind: "awaiting_approval";
      previewRecords: unknown[];
      diffSummary: string | null;
      completedSteps: string[];
      rawStatus: string;
    }
  | {
      /** The refactor completed without ever offering a gate. */
      kind: "completed_without_gate";
      previewRecords: unknown[];
      completedSteps: string[];
      rawStatus: string;
    }
  | {
      kind: "failed";
      rawStatus: string;
      error: string;
    }
  | {
      kind: "timed_out";
      lastStep: string | null;
      error: string;
    };

export interface DemoHealerPollOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  onProgress?: (progress: DcaRefactorProgress) => void;
  /** Injectable for tests; defaults to real wall-clock waiting. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * The Bright Data half of the healing cycle. Knows nothing about Sentinel,
 * incidents or canonical data — it starts a refactor, waits for a candidate,
 * and applies the decision it is given.
 */
export interface DemoCollectorHealer {
  requestHeal(request: DemoHealRequest): Promise<{ jobId: string | null }>;
  waitForGate(collectorId: string, options?: DemoHealerPollOptions): Promise<DemoHealGateOutcome>;
  applyDecision(collectorId: string, approve: boolean): Promise<void>;
}

export class BrightDataDemoHealer implements DemoCollectorHealer {
  private readonly client: DcaTemplateClient;
  private readonly defaultTimeoutMs: number;
  private readonly defaultPollIntervalMs: number;

  constructor(options: {
    client?: DcaTemplateClient;
    apiKey?: string;
    baseUrl?: string;
    fetchFn?: typeof fetch;
    timeoutMs?: number;
    pollIntervalMs?: number;
  } = {}) {
    this.client =
      options.client ??
      new DcaTemplateClient({
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        fetchFn: options.fetchFn,
      });
    this.defaultTimeoutMs = options.timeoutMs ?? 600_000;
    this.defaultPollIntervalMs = options.pollIntervalMs ?? 5_000;
  }

  public async requestHeal(request: DemoHealRequest): Promise<{ jobId: string | null }> {
    const collectorId = request.collectorId.trim();
    if (!collectorId) {
      throw new BrightDataCollectorError("A collector id is required to start a refactor");
    }
    const prompt = request.prompt.trim();
    if (!prompt) {
      throw new BrightDataCollectorError("A non-empty repair prompt is required");
    }
    const sourceUrl = request.sourceUrl?.trim();
    return this.client.requestRefactor(
      collectorId,
      prompt,
      sourceUrl ? [{ url: sourceUrl }] : [],
    );
  }

  public async waitForGate(
    collectorId: string,
    options: DemoHealerPollOptions = {},
  ): Promise<DemoHealGateOutcome> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const pollIntervalMs = options.pollIntervalMs ?? this.defaultPollIntervalMs;
    const now = options.now ?? (() => Date.now());
    const sleep =
      options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

    const startedAt = now();
    let lastStep: string | null = null;

    while (now() - startedAt < timeoutMs) {
      let progress: DcaRefactorProgress;
      try {
        progress = await this.client.getRefactorProgress(collectorId);
      } catch {
        // A single failed poll is not a failed refactor.
        await sleep(pollIntervalMs);
        continue;
      }

      lastStep = progress.step ?? lastStep;
      options.onProgress?.(progress);

      if (progress.phase === "awaiting_approval") {
        return {
          kind: "awaiting_approval",
          previewRecords: progress.previewResult ?? [],
          diffSummary: progress.diffSummary,
          completedSteps: progress.completedSteps,
          rawStatus: progress.rawStatus,
        };
      }
      if (progress.phase === "done") {
        return {
          kind: "completed_without_gate",
          previewRecords: progress.previewResult ?? [],
          completedSteps: progress.completedSteps,
          rawStatus: progress.rawStatus,
        };
      }
      if (progress.phase === "failed") {
        return {
          kind: "failed",
          rawStatus: progress.rawStatus,
          error: `Bright Data refactor ended with status '${progress.rawStatus}'`,
        };
      }

      await sleep(pollIntervalMs);
    }

    return {
      kind: "timed_out",
      lastStep,
      error: `Refactor did not reach a decision within ${Math.round(timeoutMs / 1000)}s`,
    };
  }

  public async applyDecision(collectorId: string, approve: boolean): Promise<void> {
    await this.client.resumeRefactor(collectorId, approve);
  }
}

/**
 * Builds the repair prompt from what Sentinel actually observed.
 *
 * The prompt describes the *symptom*, never the fix: we are asking Bright
 * Data's AI to re-derive selectors against the page as it now is, and telling
 * it what a correct record looks like so the candidate can be judged against
 * the same contract.
 */
export function buildDemoHealingPrompt(
  evaluation: SentinelEvaluationResult,
  context: { sourceUrl: string },
): string {
  const symptoms: string[] = [];
  if (evaluation.reasonCodes.includes("ZERO_RECORDS")) {
    symptoms.push("the template now extracts zero records");
  }
  if (evaluation.reasonCodes.includes("RECORD_COUNT_COLLAPSE")) {
    symptoms.push(
      `only ${evaluation.recordsValid} usable records were extracted where the page lists many more`,
    );
  }
  if (
    evaluation.reasonCodes.includes("SCHEMA_VALIDATION_FAILURE") ||
    evaluation.reasonCodes.includes("ILLEGAL_ENUM_VALUE")
  ) {
    symptoms.push(
      `${evaluation.recordsInvalid} of ${evaluation.recordsSeen} extracted records were missing required fields or contained raw markup`,
    );
  }
  if (evaluation.reasonCodes.includes("SEMANTIC_INVARIANT_VIOLATION")) {
    symptoms.push("every extracted record was identical, so the item selector is matching a container");
  }
  if (symptoms.length === 0) {
    symptoms.push(`extraction failed with ${evaluation.reasonCodes.join(", ") || "an unknown anomaly"}`);
  }

  const prompt =
    `The page at ${context.sourceUrl} has been re-laid-out and this scraper's selectors no longer match: `
    + `${symptoms.join("; ")}. `
    + "Re-derive the extraction against the page's current structure. "
    + "Return one record per quotation with these exact fields: "
    + "quote_text (the full quotation text only, no surrounding markup), "
    + "author (the person the quotation is attributed to), "
    + "and tags (an array of the tag keywords shown for that quotation). "
    + "Do not return page headings, navigation links or sidebar content as records.";

  return prompt.slice(0, 990);
}
