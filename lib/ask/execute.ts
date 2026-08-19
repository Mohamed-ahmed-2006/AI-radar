/**
 * Ask executor: a compiled plan in, trusted evidence out.
 *
 * The planner is the only reader of free text. This module never parses
 * English, never emits SQL, and never consults a language model. It dispatches
 * on the typed intent to the deterministic engines that already own the
 * domain: temporal intelligence, the model explorer, and the stack optimizer.
 *
 * When those engines cannot answer from collected evidence, the result says
 * so. There is no pretrained-fact fallback.
 */

import { getDemoTemporalEvidence } from "../intelligence/demo-evidence";
import { executeTemporalQuery } from "../intelligence/query-engine";
import { loadLiveTemporalEvidence } from "../intelligence/read-model";
import {
  buildDeterministicNarrativeSummary,
  verifySummaryGroundedness,
} from "../intelligence/summarizer";
import type { TemporalEvidence, TemporalQuery } from "../intelligence/contracts";
import { provenanceFromEvidence, type ProvenanceView } from "../product/provenance";
import {
  bestPerProvider,
  optimizeStack,
  TOKENS_PER_PRICING_UNIT,
  type StackOptimizerRequest,
  type StackOptimizerResult,
} from "../optimizer";
import type { ModelExplorerReadPort } from "../explorer";
import {
  comparisonAnswer,
  filterAnswer,
  optimizerAnswer,
  optimizerCalculations,
} from "./answer";
import {
  collectKnownAmounts,
  collectKnownDates,
  groundedFallbackFromOptimizer,
  groundednessFromTemporal,
  verifyDecisionText,
} from "./groundedness";
import {
  planQuery,
  type ComparisonIntent,
  type ModelFilterIntent,
  type QueryPlan,
  type SelectionConstraints,
  type TemporalChangeIntent,
  type UnsupportedIntent,
  type WorkloadOptimizerIntent,
} from "./intent";
import type {
  AskCalculation,
  AskEvidenceFreshness,
  GroundedAskResult,
  StructuredAskResults,
} from "./types";

export interface AskOptions {
  port?: ModelExplorerReadPort;
  now?: () => Date;
  /** A workload the caller already holds, recorded as source `caller`. */
  workload?: { monthlyInputTokens: number; monthlyOutputTokens: number };
  /**
   * Injected temporal evidence. Tests use this so the executor can be proven
   * against rows. Production leaves it unset and reads the live change feed.
   */
  loadTemporalEvidence?: () => Promise<readonly TemporalEvidence[]>;
  /**
   * When true, temporal questions read the isolated demo corpus. Decision
   * questions still read the explorer port — demo never invents prices.
   */
  demo?: boolean;
  referenceDate?: string;
}

function toOptimizerRequest(
  constraints: SelectionConstraints,
  workload: { monthlyInputTokens: number; monthlyOutputTokens: number },
  extras: Pick<StackOptimizerRequest, "priority" | "limit"> = {},
): StackOptimizerRequest {
  return {
    workload,
    minContextWindow: constraints.minContextWindow ?? undefined,
    minMaxOutputTokens: constraints.minMaxOutputTokens ?? undefined,
    visionRequired: constraints.visionRequired,
    toolCallingRequired: constraints.toolCallingRequired,
    providers: constraints.providers,
    activeOnly: constraints.activeOnly,
    excludeModelIds: constraints.excludeModelIds,
    excludeProviders: constraints.excludeProviders,
    priority: extras.priority,
    limit: extras.limit,
  };
}

function freshnessFromOptimizer(
  optimizer: StackOptimizerResult | null,
): AskEvidenceFreshness {
  if (!optimizer) {
    return { oldestObservedAt: null, newestObservedAt: null, maxAgeMinutes: null };
  }
  return optimizer.evidenceFreshness;
}

function freshnessFromEvents(
  events: readonly TemporalEvidence[],
  now: Date,
): AskEvidenceFreshness {
  const timestamps = events.map((event) => event.observedAt).sort();
  if (timestamps.length === 0) {
    return { oldestObservedAt: null, newestObservedAt: null, maxAgeMinutes: null };
  }
  const oldest = timestamps[0];
  return {
    oldestObservedAt: oldest,
    newestObservedAt: timestamps[timestamps.length - 1],
    maxAgeMinutes: Math.max(
      0,
      Math.round((now.getTime() - Date.parse(oldest)) / 60_000),
    ),
  };
}

function dedupeProvenance(views: readonly (ProvenanceView | null | undefined)[]): ProvenanceView[] {
  const seen = new Set<string>();
  const result: ProvenanceView[] = [];
  for (const view of views) {
    if (!view) continue;
    const key = `${view.snapshotId ?? ""}|${view.sourceUrl ?? ""}|${view.observedAt ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(view);
  }
  return result;
}

function missingFromOptimizer(optimizer: StackOptimizerResult): string[] {
  const missing: string[] = [];
  if (optimizer.insufficientEvidence) {
    missing.push(optimizer.insufficientEvidence.detail);
  }
  for (const candidate of optimizer.eligibleWithoutCost) {
    missing.push(
      `${candidate.modelName}: ${candidate.costExclusion?.detail ?? "no comparable price"}.`,
    );
  }
  for (const excluded of optimizer.excluded) {
    for (const reason of excluded.reasons) {
      if (reason.status !== "unknown") continue;
      missing.push(`${excluded.modelName}: ${reason.detail}`);
    }
  }
  return missing;
}

function publishDecision(args: {
  question: string;
  plan: QueryPlan;
  now: Date;
  structured: StructuredAskResults;
  draft: string;
  optimizer: StackOptimizerResult | null;
  calculations: AskCalculation[];
  provenance: ProvenanceView[];
  missingEvidence: string[];
  unsupportedEvidence: string[];
}): GroundedAskResult {
  const groundedness = verifyDecisionText(
    args.draft,
    collectKnownAmounts(args.optimizer),
    collectKnownDates(args.optimizer),
  );
  const answerSummary =
    groundedness.isGrounded
      ? args.draft
      : args.optimizer
        ? groundedFallbackFromOptimizer(args.optimizer)
        : "Trusted evidence is insufficient to answer this question.";
  const published = groundedness.isGrounded
    ? groundedness
    : {
        ...verifyDecisionText(
          answerSummary,
          collectKnownAmounts(args.optimizer),
          collectKnownDates(args.optimizer),
        ),
        sanitized: true,
        violations: groundedness.violations,
      };

  return {
    question: args.question,
    interpretedIntent: args.plan.intent.kind,
    plan: args.plan,
    constraints: args.plan.constraints,
    answerSummary,
    structured: args.structured,
    calculations: args.calculations,
    evidenceFreshness: freshnessFromOptimizer(args.optimizer),
    provenance: args.provenance,
    missingEvidence: args.missingEvidence,
    unsupportedEvidence: args.unsupportedEvidence,
    groundedness: published,
    generatedAt: args.now.toISOString(),
    interpreter: args.plan.interpreter,
  };
}

async function loadTemporalDataset(options: AskOptions): Promise<readonly TemporalEvidence[]> {
  if (options.loadTemporalEvidence) return options.loadTemporalEvidence();
  if (options.demo) return getDemoTemporalEvidence();
  return loadLiveTemporalEvidence();
}

async function executeTemporal(
  plan: QueryPlan,
  intent: TemporalChangeIntent,
  options: AskOptions,
  now: Date,
): Promise<GroundedAskResult> {
  const dataset = await loadTemporalDataset(options);
  const query: TemporalQuery = {
    provider: intent.provider ?? undefined,
    family: intent.family ?? undefined,
    model: intent.model ?? undefined,
    range: intent.range,
    categories: intent.categories.length > 0 ? intent.categories : undefined,
    referenceDate: options.referenceDate,
    includeSummary: false,
  };
  const bundle = executeTemporalQuery(dataset, query);
  const draft = buildDeterministicNarrativeSummary(bundle);
  const verification = verifySummaryGroundedness(draft, bundle.events);
  const answerSummary = verification.isGrounded ? draft : verification.sanitizedSummary;

  const missingEvidence: string[] = [];
  if (bundle.totalEvents === 0) {
    missingEvidence.push(
      `No change events were found in trusted evidence for this query in the ${intent.range} range.`,
    );
  }

  return {
    question: plan.question,
    interpretedIntent: "temporal_change_query",
    plan,
    constraints: plan.constraints,
    answerSummary,
    structured: { kind: "temporal_change_query", bundle },
    calculations: [],
    evidenceFreshness: freshnessFromEvents(bundle.events, now),
    provenance: dedupeProvenance(bundle.events.map(provenanceFromEvidence)),
    missingEvidence,
    unsupportedEvidence: verification.violations,
    groundedness: groundednessFromTemporal({
      ...verification,
      isGrounded: verification.isGrounded || answerSummary === verification.sanitizedSummary,
    }),
    generatedAt: now.toISOString(),
    interpreter: plan.interpreter,
  };
}

async function executeOptimizerIntent(
  plan: QueryPlan,
  intent: WorkloadOptimizerIntent,
  options: AskOptions,
  now: Date,
): Promise<GroundedAskResult> {
  const optimizer = await optimizeStack(
    toOptimizerRequest(intent.constraints, intent.workload, {
      priority: intent.priority,
      limit: intent.limit,
    }),
    { port: options.port, now: () => now },
  );
  return publishDecision({
    question: plan.question,
    plan,
    now,
    structured: { kind: "workload_optimizer_query", optimizer },
    draft: optimizerAnswer(intent, optimizer),
    optimizer,
    calculations: optimizerCalculations(optimizer, "Deterministic arithmetic over published prices."),
    provenance: optimizer.provenance,
    missingEvidence: missingFromOptimizer(optimizer),
    unsupportedEvidence: [],
  });
}

async function executeFilter(
  plan: QueryPlan,
  intent: ModelFilterIntent,
  options: AskOptions,
  now: Date,
): Promise<GroundedAskResult> {
  const unitPriceComparison = intent.superlative === "cheapest_unit_price";
  const optimizer = await optimizeStack(
    toOptimizerRequest(
      intent.constraints,
      {
        monthlyInputTokens: TOKENS_PER_PRICING_UNIT,
        monthlyOutputTokens: TOKENS_PER_PRICING_UNIT,
      },
      {
        priority: "lowest_total_cost",
        limit: intent.limit,
      },
    ),
    { port: options.port, now: () => now },
  );

  const eligibleCount = optimizer.eligibleCount;
  const draft = filterAnswer(intent, optimizer, eligibleCount, optimizer.totalModelsConsidered);

  return publishDecision({
    question: plan.question,
    plan,
    now,
    structured: {
      kind: "model_filter_query",
      optimizer,
      unitPriceComparison,
      eligibleCount,
      totalConsidered: optimizer.totalModelsConsidered,
    },
    draft,
    optimizer,
    calculations: unitPriceComparison
      ? optimizerCalculations(
          optimizer,
          "Unit-price ranking: 1 million input tokens plus 1 million output tokens.",
        )
      : [],
    provenance: optimizer.provenance,
    missingEvidence: missingFromOptimizer(optimizer),
    unsupportedEvidence: [],
  });
}

async function executeComparison(
  plan: QueryPlan,
  intent: ComparisonIntent,
  options: AskOptions,
  now: Date,
): Promise<GroundedAskResult> {
  const optimizer = await optimizeStack(
    toOptimizerRequest(intent.constraints, intent.workload, {
      priority: intent.priority,
    }),
    { port: options.port, now: () => now },
  );
  const choices = bestPerProvider(optimizer, intent.compareProviders);
  return publishDecision({
    question: plan.question,
    plan,
    now,
    structured: { kind: "comparison_query", optimizer, choices },
    draft: comparisonAnswer(intent, choices, optimizer),
    optimizer,
    calculations: optimizerCalculations(optimizer, "Per-provider first appearance in the ranking."),
    provenance: optimizer.provenance,
    missingEvidence: missingFromOptimizer(optimizer),
    unsupportedEvidence: [],
  });
}

function executeUnsupported(
  plan: QueryPlan,
  intent: UnsupportedIntent,
  now: Date,
): GroundedAskResult {
  return {
    question: plan.question,
    interpretedIntent: "unsupported",
    plan,
    constraints: plan.constraints,
    answerSummary: intent.detail,
    structured: {
      kind: "unsupported",
      reason: intent.reason,
      detail: intent.detail,
      missing: intent.missing,
    },
    calculations: [],
    evidenceFreshness: {
      oldestObservedAt: null,
      newestObservedAt: null,
      maxAgeMinutes: null,
    },
    provenance: [],
    missingEvidence: intent.missing.map((field) => `Missing constraint: ${field}`),
    unsupportedEvidence: [intent.detail],
    groundedness: {
      isGrounded: true,
      violations: [],
      unsupportedPrices: [],
      unsupportedDates: [],
      groundedFactsCount: 0,
      sanitized: false,
    },
    generatedAt: now.toISOString(),
    interpreter: plan.interpreter,
  };
}

/**
 * Answers a natural-language question from trusted AI Radar evidence.
 *
 * The return is fully structured so a UI can render it without re-deriving
 * anything, and so a groundedness check can compare the published sentence
 * against the rows that produced it.
 */
export async function answerQuestion(
  question: string,
  options: AskOptions = {},
): Promise<GroundedAskResult> {
  const now = options.now?.() ?? new Date();
  const plan = planQuery(question, { workload: options.workload });
  const intent = plan.intent;

  switch (intent.kind) {
    case "temporal_change_query":
      return executeTemporal(plan, intent, options, now);
    case "model_filter_query":
      return executeFilter(plan, intent, options, now);
    case "workload_optimizer_query":
      return executeOptimizerIntent(plan, intent, options, now);
    case "comparison_query":
      return executeComparison(plan, intent, options, now);
    case "unsupported":
      return executeUnsupported(plan, intent, now);
  }
}
