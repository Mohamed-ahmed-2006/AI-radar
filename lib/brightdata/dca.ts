/**
 * Bright Data Direct Collector API (DCA) — Scraper Studio template operations.
 *
 * One definition of the AI-Flow endpoints and their status vocabulary, so the
 * Sentinel healer and the demo harness cannot drift apart on what "awaiting
 * approval" means or which path approves a refactor.
 *
 * Server-only. The API key never leaves this module's callers.
 */

import {
  BrightDataAuthError,
  BrightDataCollectorError,
  BrightDataConfigError,
  BrightDataRateLimitError,
} from "./errors";

export const DCA_TEMPLATE_ENDPOINT = "/dca/collector";
export const DCA_AI_TRIGGER_PATH = "automate_template";
export const DCA_AI_PROGRESS_PATH = "automate_template/progress";
export const DCA_REFACTOR_TRIGGER_PATH = "refactor_template";
export const DCA_REFACTOR_PROGRESS_PATH = "refactor_template/progress";
export const DCA_RESUME_JOB_PATH = "resume_automation_job";

/** Longest prompt the refactor endpoint accepts. */
export const DCA_PROMPT_MAX_LENGTH = 1000;

/** Bright Data parks a refactor here until a human (or Sentinel) answers. */
export const DCA_AWAITING_APPROVAL_STATUS = "pending_answer";
export const DCA_DONE_STATUS = "done";
export const DCA_TERMINAL_FAILURE_STATUSES = ["failed", "error", "cancelled"] as const;

/** Normalised view of a refactor job's state, independent of wire vocabulary. */
export type DcaRefactorPhase = "running" | "awaiting_approval" | "done" | "failed";

export interface DcaRefactorProgress {
  phase: DcaRefactorPhase;
  /** Verbatim status string Bright Data reported. */
  rawStatus: string;
  step: string | null;
  completedSteps: string[];
  /** Candidate records the refactored template produced, when offered. */
  previewResult: unknown[] | null;
  /** Human-readable note about the proposed template; never the template body. */
  diffSummary: string | null;
}

export interface DcaClientConfig {
  apiKey?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

function authHeaders(apiKey: string | undefined): Record<string, string> {
  if (!apiKey || apiKey.trim() === "") {
    throw new BrightDataConfigError(
      "Bright Data API key is missing. Set BRIGHTDATA_API_KEY to use Scraper Studio template operations.",
    );
  }
  return {
    Authorization: `Bearer ${apiKey.trim()}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function summariseDiff(diff: unknown): string | null {
  if (!diff || typeof diff !== "object") return null;
  const proposed = (diff as { template_b?: { steps?: unknown[] } }).template_b;
  const steps = Array.isArray(proposed?.steps) ? proposed.steps.length : null;
  if (steps === null) return "Template change proposed; review in Scraper Studio.";
  return `Proposed template has ${steps} extraction step(s).`;
}

export function normaliseRefactorProgress(body: unknown): DcaRefactorProgress {
  const payload = (body ?? {}) as Record<string, unknown>;
  const rawStatus = String(payload.status ?? payload.state ?? "");
  const step = payload.step === undefined || payload.step === null ? null : String(payload.step);
  const completedSteps = Array.isArray(payload.completed_steps)
    ? payload.completed_steps.map((entry) => String(entry))
    : [];
  const previewResult = Array.isArray(payload.preview_result)
    ? (payload.preview_result as unknown[])
    : null;

  let phase: DcaRefactorPhase = "running";
  if (rawStatus === DCA_AWAITING_APPROVAL_STATUS) phase = "awaiting_approval";
  else if (rawStatus === DCA_DONE_STATUS || rawStatus === "success") phase = "done";
  else if ((DCA_TERMINAL_FAILURE_STATUSES as readonly string[]).includes(rawStatus)) phase = "failed";

  return {
    phase,
    rawStatus,
    step,
    completedSteps,
    previewResult,
    diffSummary: summariseDiff(payload.diff),
  };
}

/**
 * Thin authenticated transport for the DCA template endpoints. Translates HTTP
 * faults into the Bright Data error taxonomy the rest of the codebase already
 * handles.
 */
export class DcaTemplateClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: DcaClientConfig = {}) {
    this.apiKey = config.apiKey || process.env.BRIGHTDATA_API_KEY;
    this.baseUrl = (
      config.baseUrl || process.env.BRIGHTDATA_BASE_URL || "https://api.brightdata.com"
    ).replace(/\/+$/, "");
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers: authHeaders(this.apiKey),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new BrightDataCollectorError(
        `Network error calling ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new BrightDataAuthError(
        `Authentication failed calling ${path}`,
        response.status,
      );
    }
    if (response.status === 429) {
      throw new BrightDataRateLimitError(
        "Bright Data AI-Flow concurrent-job cap reached; the refactor was not started.",
      );
    }
    if (!response.ok) {
      const detail = await response.text();
      throw new BrightDataCollectorError(
        `Bright Data returned ${response.status} calling ${path}: ${detail.slice(0, 500)}`,
        { statusCode: response.status },
      );
    }

    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  /** Starts an AI refactor of the collector's extraction template. */
  public async requestRefactor(
    collectorId: string,
    prompt: string,
  ): Promise<{ jobId: string | null }> {
    const body = await this.request(
      "POST",
      `/dca/collectors/${encodeURIComponent(collectorId)}/${DCA_REFACTOR_TRIGGER_PATH}`,
      { prompt: prompt.slice(0, DCA_PROMPT_MAX_LENGTH), custom_input: [] },
    );
    const id = (body as { id?: unknown }).id;
    return { jobId: typeof id === "string" ? id : null };
  }

  public async getRefactorProgress(collectorId: string): Promise<DcaRefactorProgress> {
    const body = await this.request(
      "GET",
      `/dca/collectors/${encodeURIComponent(collectorId)}/${DCA_REFACTOR_PROGRESS_PATH}`,
    );
    return normaliseRefactorProgress(body);
  }

  /**
   * Answers a refactor parked at the approval gate.
   *
   * `auto_save` is only meaningful on approval; Bright Data ignores it on a
   * rejection, so a rejection sends the minimal body and the collector keeps
   * the template it already had.
   */
  public async resumeRefactor(collectorId: string, approve: boolean): Promise<void> {
    await this.request(
      "POST",
      `/dca/collectors/${encodeURIComponent(collectorId)}/${DCA_RESUME_JOB_PATH}`,
      approve ? { message: true, auto_save: true } : { message: false },
    );
  }
}
