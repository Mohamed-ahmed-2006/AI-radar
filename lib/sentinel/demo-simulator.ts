/**
 * Sentinel Autonomous Self-Healing Demo Scenario Simulator
 *
 * Deterministically simulates the complete lifecycle:
 * healthy → anomaly detected → quarantined → healing initiated → candidate validated → recovered
 * without mutating live Bright Data production scrapers.
 */

import { createPricingSourceHealthContract } from "./contracts";
import { MockSentinelHealer } from "./healing";
import { runSentinelProtectedIngestion } from "./orchestrator";
import type { SentinelRepository } from "./repository";
import type {
  LastKnownGoodBaseline,
  SentinelStatus,
} from "./types";
import type {
  SentinelHealingAttemptRow,
  SentinelIncidentRow,
  SentinelQuarantinePayloadRow,
  SentinelSourceHealthRow,
} from "../supabase/types";

export interface DemoStepResult {
  step: number;
  stepName: string;
  sourceStatus: SentinelStatus;
  isQuarantined: boolean;
  recordsSeen: number;
  recordsAccepted: number;
  lastKnownGoodCount: number | null;
  lastKnownGoodPreserved: boolean;
  incidentRecorded: boolean;
  incidentReasonCodes: string[];
  healingState?: string;
  summary: string;
  timestamp: string;
}

export interface DemoSimulationResult {
  scenarioName: string;
  provider: string;
  timeline: DemoStepResult[];
  finalStatus: SentinelStatus;
  success: boolean;
  summary: string;
}

// Verified healthy pricing records
const HEALTHY_FIXTURE = [
  {
    provider: "OpenAI",
    model_name: "gpt-4o",
    pricing_mode: "standard",
    context_tier: "default",
    input_price_per_1m_tokens: 2.5,
    cached_input_price_per_1m_tokens: 1.25,
    cache_write_price_per_1m_tokens: null,
    output_price_per_1m_tokens: 10.0,
    pricing_unit: "USD per 1M tokens",
    source_url: "https://developers.openai.com/api/docs/pricing",
  },
  {
    provider: "OpenAI",
    model_name: "gpt-4o-mini",
    pricing_mode: "standard",
    context_tier: "default",
    input_price_per_1m_tokens: 0.15,
    cached_input_price_per_1m_tokens: 0.075,
    cache_write_price_per_1m_tokens: null,
    output_price_per_1m_tokens: 0.6,
    pricing_unit: "USD per 1M tokens",
    source_url: "https://developers.openai.com/api/docs/pricing",
  },
  {
    provider: "OpenAI",
    model_name: "o1",
    pricing_mode: "standard",
    context_tier: "default",
    input_price_per_1m_tokens: 15.0,
    cached_input_price_per_1m_tokens: 7.5,
    cache_write_price_per_1m_tokens: null,
    output_price_per_1m_tokens: 60.0,
    pricing_unit: "USD per 1M tokens",
    source_url: "https://developers.openai.com/api/docs/pricing",
  },
  {
    provider: "OpenAI",
    model_name: "o3-mini",
    pricing_mode: "standard",
    context_tier: "default",
    input_price_per_1m_tokens: 1.1,
    cached_input_price_per_1m_tokens: 0.55,
    cache_write_price_per_1m_tokens: null,
    output_price_per_1m_tokens: 4.4,
    pricing_unit: "USD per 1M tokens",
    source_url: "https://developers.openai.com/api/docs/pricing",
  },
];

// Broken collector payload (null prices and malformed fields)
const BROKEN_FIXTURE = [
  {
    provider: "OpenAI",
    model_name: "gpt-4o",
    pricing_mode: "standard",
    context_tier: "default",
    input_price_per_1m_tokens: null,
    cached_input_price_per_1m_tokens: null,
    cache_write_price_per_1m_tokens: null,
    output_price_per_1m_tokens: null,
    pricing_unit: "USD per 1M tokens",
    source_url: "https://developers.openai.com/api/docs/pricing",
  },
  {
    provider: "OpenAI",
    model_name: "gpt-4o-mini",
    pricing_mode: "standard",
    context_tier: "default",
    input_price_per_1m_tokens: null,
    cached_input_price_per_1m_tokens: null,
    cache_write_price_per_1m_tokens: null,
    output_price_per_1m_tokens: null,
    pricing_unit: "USD per 1M tokens",
    source_url: "https://developers.openai.com/api/docs/pricing",
  },
];

// In-Memory Test Repository for Demo & Tests
export class InMemorySentinelRepository implements SentinelRepository {
  public incidents: SentinelIncidentRow[] = [];
  public quarantinePayloads: SentinelQuarantinePayloadRow[] = [];
  public healingAttempts: SentinelHealingAttemptRow[] = [];
  public baselines: Map<string, LastKnownGoodBaseline> = new Map();
  public canonicalSnapshots: Map<string, unknown[]> = new Map();

  public async createIncident(input: Parameters<SentinelRepository["createIncident"]>[0]): Promise<SentinelIncidentRow> {
    const id = `inc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const row: SentinelIncidentRow = {
      id,
      source_id: input.sourceId,
      provider_id: input.providerId,
      run_id: input.runId ?? null,
      status: input.status ?? "open",
      severity: input.severity ?? "warning",
      reason_codes: input.reasonCodes,
      summary: input.summary ?? null,
      records_seen: input.recordsSeen,
      records_valid: input.recordsValid,
      records_invalid: input.recordsInvalid,
      expected_count: input.expectedCount ?? null,
      last_known_good_count: input.lastKnownGoodCount ?? null,
      last_known_good_run_id: input.lastKnownGoodRunId ?? null,
      last_known_good_at: input.lastKnownGoodAt ?? null,
      healing_attempt_count: input.healingAttemptCount ?? 0,
      resolution_note: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      resolved_at: null,
    };
    this.incidents.push(row);
    return row;
  }

  public async updateIncident(id: string, input: Parameters<SentinelRepository["updateIncident"]>[1]): Promise<SentinelIncidentRow> {
    const inc = this.incidents.find((i) => i.id === id);
    if (!inc) throw new Error(`Incident ${id} not found`);
    if (input.status !== undefined) inc.status = input.status;
    if (input.severity !== undefined) inc.severity = input.severity;
    if (input.healingAttemptCount !== undefined) inc.healing_attempt_count = input.healingAttemptCount;
    if (input.resolutionNote !== undefined) inc.resolution_note = input.resolutionNote;
    if (input.resolvedAt !== undefined) inc.resolved_at = input.resolvedAt;
    if (input.reasonCodes !== undefined) inc.reason_codes = input.reasonCodes;
    inc.updated_at = new Date().toISOString();
    return inc;
  }

  public async getLatestOpenIncident(sourceId: string): Promise<SentinelIncidentRow | null> {
    const inc = [...this.incidents]
      .reverse()
      .find((i) => i.source_id === sourceId && (i.status === "open" || i.status === "healing" || i.status === "needs_review"));
    return inc ?? null;
  }

  public async saveQuarantinePayload(input: Parameters<SentinelRepository["saveQuarantinePayload"]>[0]): Promise<SentinelQuarantinePayloadRow> {
    const id = `quar-${Date.now()}`;
    const row: SentinelQuarantinePayloadRow = {
      id,
      incident_id: input.incidentId,
      source_id: input.sourceId,
      run_id: input.runId ?? null,
      raw_payload: input.rawPayload as never,
      validation_errors: input.validationErrors as never,
      created_at: new Date().toISOString(),
    };
    this.quarantinePayloads.push(row);
    return row;
  }

  public async recordHealingAttempt(input: Parameters<SentinelRepository["recordHealingAttempt"]>[0]): Promise<SentinelHealingAttemptRow> {
    const id = `heal-${Date.now()}`;
    const row: SentinelHealingAttemptRow = {
      id,
      incident_id: input.incidentId,
      source_id: input.sourceId,
      collector_id: input.collectorId ?? null,
      attempt_number: input.attemptNumber,
      prompt: input.prompt,
      status: input.status,
      refactor_job_id: input.refactorJobId ?? null,
      candidate_records_count: input.candidateRecordsCount ?? null,
      candidate_passed_validation: input.candidatePassedValidation ?? null,
      validation_details: (input.validationDetails ?? null) as never,
      error_message: input.errorMessage ?? null,
      started_at: input.startedAt ?? new Date().toISOString(),
      completed_at: input.completedAt ?? null,
      created_at: new Date().toISOString(),
    };
    this.healingAttempts.push(row);
    return row;
  }

  public async getLastKnownGoodBaseline(sourceId: string): Promise<LastKnownGoodBaseline | null> {
    return this.baselines.get(sourceId) ?? null;
  }

  public setLastKnownGoodBaseline(sourceId: string, baseline: LastKnownGoodBaseline) {
    this.baselines.set(sourceId, baseline);
  }

  public async getSentinelSourceHealth(): Promise<SentinelSourceHealthRow[]> {
    return [];
  }

  public async listRecentIncidents(limit = 50): Promise<SentinelIncidentRow[]> {
    return this.incidents.slice(-limit).reverse();
  }

  public async listRecentHealingAttempts(limit = 50): Promise<SentinelHealingAttemptRow[]> {
    return this.healingAttempts.slice(-limit).reverse();
  }
}

/**
 * Runs the full 5-step Sentinel Hero Demo Scenario.
 */
export async function runSentinelDemoSimulation(options: {
  repository?: InMemorySentinelRepository;
  providerSlug?: "openai" | "anthropic" | "gemini" | "xai";
} = {}): Promise<DemoSimulationResult> {
  const providerSlug = options.providerSlug ?? "openai";
  const repo = options.repository ?? new InMemorySentinelRepository();
  const contract = createPricingSourceHealthContract(providerSlug, `source-${providerSlug}`);
  const source = {
    id: `src-${providerSlug}`,
    providerId: `prov-${providerSlug}`,
    collectorId: "c_msx3bqlyjtv2qustx",
    sourceUrl: "https://developers.openai.com/api/docs/pricing",
    label: "OpenAI pricing page",
  };
  const provider = {
    id: `prov-${providerSlug}`,
    slug: providerSlug,
    name: "OpenAI",
  };

  const timeline: DemoStepResult[] = [];
  let canonicalState: unknown[] = [];

  const persistCanonical = async (validRecords: unknown[]) => {
    canonicalState = [...validRecords];
    repo.setLastKnownGoodBaseline(source.id, {
      runId: `run-${Date.now()}`,
      recordCount: validRecords.length,
      observedAt: new Date().toISOString(),
    });
    return {
      acceptedCount: validRecords.length,
      rejectedCount: 0,
      changesDetected: validRecords.length,
    };
  };

  // -------------------------------------------------------------
  // Step 1: Normal Healthy Run
  // -------------------------------------------------------------
  const healer = new MockSentinelHealer("succeed", HEALTHY_FIXTURE);

  const step1 = await runSentinelProtectedIngestion(
    contract,
    source,
    provider,
    async () => ({
      success: true,
      data: HEALTHY_FIXTURE,
      metadata: {
        collectorId: source.collectorId,
        runId: "run-1-healthy",
        status: "success",
      },
    }),
    persistCanonical,
    { repository: repo, healer },
  );

  timeline.push({
    step: 1,
    stepName: "Baseline Ingestion (Healthy)",
    sourceStatus: step1.status,
    isQuarantined: step1.isQuarantined,
    recordsSeen: step1.recordsSeen,
    recordsAccepted: step1.recordsAccepted,
    lastKnownGoodCount: step1.lastKnownGoodCount,
    lastKnownGoodPreserved: step1.lastKnownGoodPreserved,
    incidentRecorded: false,
    incidentReasonCodes: [],
    summary: "Scraper output validated 100% against pricing contract. 4 models persisted canonically. LKG established at 4 records.",
    timestamp: new Date().toISOString(),
  });

  // -------------------------------------------------------------
  // Step 2 & 3 & 4 & 5: Anomaly Injection -> Quarantine -> Healing -> Recovered
  // -------------------------------------------------------------
  // The second run provides the broken fixture.
  // The healer mock provides the healed valid fixture as candidate.
  const step2to5 = await runSentinelProtectedIngestion(
    contract,
    source,
    provider,
    async () => ({
      success: true,
      data: BROKEN_FIXTURE,
      metadata: {
        collectorId: source.collectorId,
        runId: "run-2-broken",
        status: "success",
      },
    }),
    persistCanonical,
    { repository: repo, healer, autoHealOverride: true },
  );

  // Quarantine Step Telemetry
  timeline.push({
    step: 2,
    stepName: "Anomaly Detected & Candidate Quarantined",
    sourceStatus: "quarantined",
    isQuarantined: true,
    recordsSeen: BROKEN_FIXTURE.length,
    recordsAccepted: 0,
    lastKnownGoodCount: 4,
    lastKnownGoodPreserved: canonicalState.length === 4,
    incidentRecorded: true,
    incidentReasonCodes: ["ALL_PRICES_NULL", "RECORD_COUNT_COLLAPSE"],
    summary: "Anomaly detected: all prices extracted as null. Run quarantined. Canonical store protected with LKG (4 models intact).",
    timestamp: new Date().toISOString(),
  });

  // Healing Initiated Step Telemetry
  timeline.push({
    step: 3,
    stepName: "Bright Data Autonomous Healing Initiated",
    sourceStatus: "healing",
    isQuarantined: true,
    recordsSeen: BROKEN_FIXTURE.length,
    recordsAccepted: 0,
    lastKnownGoodCount: 4,
    lastKnownGoodPreserved: true,
    incidentRecorded: true,
    incidentReasonCodes: ["ALL_PRICES_NULL"],
    healingState: "in_progress",
    summary: "Sentinel generated repair prompt and triggered Scraper Studio AI refactor for collector c_msx3bqlyjtv2qustx.",
    timestamp: new Date().toISOString(),
  });

  // Candidate Validated Step Telemetry
  timeline.push({
    step: 4,
    stepName: "Repaired Candidate Validated by Sentinel",
    sourceStatus: "healing",
    isQuarantined: false,
    recordsSeen: HEALTHY_FIXTURE.length,
    recordsAccepted: 4,
    lastKnownGoodCount: 4,
    lastKnownGoodPreserved: true,
    incidentRecorded: true,
    incidentReasonCodes: [],
    healingState: "candidate_validated",
    summary: "Refactored candidate passed all Sentinel structural and semantic invariants. Template approval granted.",
    timestamp: new Date().toISOString(),
  });

  // Recovered Step Telemetry
  timeline.push({
    step: 5,
    stepName: "Autonomous Recovery Completed",
    sourceStatus: step2to5.status,
    isQuarantined: false,
    recordsSeen: HEALTHY_FIXTURE.length,
    recordsAccepted: step2to5.recordsAccepted,
    lastKnownGoodCount: step2to5.lastKnownGoodCount,
    lastKnownGoodPreserved: true,
    incidentRecorded: true,
    incidentReasonCodes: [],
    healingState: "approved",
    summary: `Self-healing recovered: 4 models safely updated. Incident resolved. Source health restored to ${step2to5.status}.`,
    timestamp: new Date().toISOString(),
  });

  return {
    scenarioName: "Autonomous Scraper Self-Healing & Quarantine Pipeline",
    provider: "OpenAI",
    timeline,
    finalStatus: step2to5.status,
    success: step2to5.success && step2to5.status === "recovered",
    summary: "Hero Demo complete: Anomaly intercepted, last-known-good preserved, AI healing executed and verified.",
  };
}
