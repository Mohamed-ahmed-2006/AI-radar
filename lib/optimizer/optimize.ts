/**
 * Stack Optimizer read model.
 *
 * One function, one pass: read every canonical model with its current trusted
 * evidence, check it against the request, cost it, rank what can be ranked and
 * explain the order. The optimizer never queries Supabase itself — it reads
 * through the same `ModelExplorerReadPort` the explorer uses, which is what
 * lets the whole decision be tested against rows.
 *
 * The pipeline is deliberately linear and observable at each stage:
 *
 *     models -> requirement checks -> eligible / excluded
 *            -> monthly cost       -> rankable / eligible-without-price
 *            -> ranking            -> winner, explanation, provenance
 *
 * A winner is only ever the head of a non-empty ranking. When nothing is
 * rankable the result says which stage ran dry — no models at all, none
 * eligible, or none priced — and `winner` stays null. There is no fallback
 * that promotes an unpriced model, and nothing here consults a language model.
 */

import { getModelExplorer } from "../explorer/read-model";
import { createModelExplorerReadPort, type ModelExplorerReadPort } from "../explorer/port";
import type { ModelExplorerEntry } from "../explorer/types";
import type { ProvenanceView } from "../product/provenance";
import { calculateMonthlyCost, costExclusionFor } from "./cost";
import { buildExplanation, rankCandidates } from "./rank";
import {
  evaluateRequirements,
  failingChecks,
  isEligible,
  normalizeRequest,
  providerMatches,
} from "./requirements";
import type {
  ExcludedCandidate,
  InsufficientEvidence,
  NormalizedStackOptimizerRequest,
  OptimizerCandidate,
  OptimizerEvidenceFreshness,
  StackOptimizerRequest,
  StackOptimizerResult,
} from "./types";

export interface StackOptimizerOptions {
  port?: ModelExplorerReadPort;
  now?: () => Date;
}

function buildCandidate(
  entry: ModelExplorerEntry,
  request: NormalizedStackOptimizerRequest,
): OptimizerCandidate {
  const tier = entry.pricing.primary;
  const cost = calculateMonthlyCost(tier, request.workload, request.currency);

  return {
    canonicalModelId: entry.canonicalModelId,
    modelName: entry.modelName,
    displayName: entry.displayName,
    provider: entry.provider,
    cost,
    requirementChecks: evaluateRequirements(entry, request),
    capabilities: {
      contextWindow: entry.capabilities.contextWindow,
      maxOutputTokens: entry.capabilities.maxOutputTokens,
      supportsVision: entry.capabilities.supportsVision,
      supportsToolCalling: entry.capabilities.supportsToolCalling,
    },
    lifecycleState: entry.lifecycle.state,
    endOfLife: entry.lifecycle.endOfLife,
    freshness: entry.freshness,
    provenance: entry.provenance,
    rank: null,
    rankBasis: null,
    costExclusion: costExclusionFor(cost, tier, request.currency),
  };
}

function freshnessOf(
  candidates: readonly OptimizerCandidate[],
  now: Date,
): OptimizerEvidenceFreshness {
  const timestamps = candidates
    .map((candidate) => candidate.freshness.lastVerifiedAt)
    .filter((value): value is string => value !== null)
    .sort();

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

/**
 * Pricing provenance for the ranked set, deduplicated by snapshot.
 *
 * Only pricing is collected here: it is the domain the ranking actually
 * consumed. Capability and lifecycle provenance travel on each candidate,
 * where they can be read next to the check they justified.
 */
function rankedProvenance(candidates: readonly OptimizerCandidate[]): ProvenanceView[] {
  const seen = new Set<string>();
  const views: ProvenanceView[] = [];
  for (const candidate of candidates) {
    const view = candidate.provenance.pricing;
    if (!view) continue;
    const key = `${view.snapshotId ?? ""}|${view.sourceUrl ?? ""}|${view.observedAt ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    views.push(view);
  }
  return views;
}

function insufficiencyOf(
  totalConsidered: number,
  eligibleCount: number,
  rankedCount: number,
): InsufficientEvidence | null {
  if (rankedCount > 0) return null;
  if (totalConsidered === 0) {
    return {
      code: "no_models",
      detail: "AI Radar holds no canonical models, so nothing could be evaluated.",
    };
  }
  if (eligibleCount === 0) {
    return {
      code: "no_eligible_models",
      detail:
        "No model satisfied every requirement on trusted evidence. Requirements that " +
        "depend on evidence AI Radar has not collected fail closed.",
    };
  }
  return {
    code: "no_comparable_pricing",
    detail:
      "Models met the requirements, but none carried a comparable published price " +
      "for this workload, so no cost ranking could be calculated.",
  };
}

/**
 * Ranks the trusted model catalog for one workload.
 *
 * Exclusions are reported for every model that failed a requirement, with all
 * of its failing checks rather than the first one, because "why not this
 * model" is usually a question about several constraints at once.
 */
export async function optimizeStack(
  request: StackOptimizerRequest,
  options: StackOptimizerOptions = {},
): Promise<StackOptimizerResult> {
  const port = options.port ?? createModelExplorerReadPort();
  const now = options.now?.() ?? new Date();
  const normalized = normalizeRequest(request);

  const explorer = await getModelExplorer({ port, now: () => now });
  const candidates = explorer.entries.map((entry) => buildCandidate(entry, normalized));

  const eligible: OptimizerCandidate[] = [];
  const excluded: ExcludedCandidate[] = [];
  for (const candidate of candidates) {
    if (isEligible(candidate.requirementChecks)) {
      eligible.push(candidate);
      continue;
    }
    excluded.push({
      canonicalModelId: candidate.canonicalModelId,
      modelName: candidate.modelName,
      provider: candidate.provider,
      reasons: failingChecks(candidate.requirementChecks),
    });
  }

  const ranked = rankCandidates(eligible, normalized.priority);
  const rankedIds = new Set(ranked.map((candidate) => candidate.canonicalModelId));
  const eligibleWithoutCost = eligible
    .filter((candidate) => !rankedIds.has(candidate.canonicalModelId))
    .sort(
      (left, right) =>
        left.provider.slug.localeCompare(right.provider.slug) ||
        left.modelName.localeCompare(right.modelName),
    );

  const limited =
    normalized.limit !== null ? ranked.slice(0, normalized.limit) : ranked;

  excluded.sort(
    (left, right) =>
      left.provider.slug.localeCompare(right.provider.slug) ||
      left.modelName.localeCompare(right.modelName),
  );

  return {
    request: normalized,
    generatedAt: now.toISOString(),
    totalModelsConsidered: candidates.length,
    eligibleCount: eligible.length,
    rankedCount: ranked.length,
    winner: limited.length > 0 ? limited[0] : null,
    ranked: limited,
    eligibleWithoutCost,
    excluded,
    explanation: buildExplanation(
      normalized,
      limited,
      eligibleWithoutCost,
      excluded.length,
      candidates.length,
    ),
    evidenceFreshness: freshnessOf(limited, now),
    provenance: rankedProvenance(limited),
    insufficientEvidence: insufficiencyOf(
      candidates.length,
      eligible.length,
      ranked.length,
    ),
  };
}

/**
 * The cheapest eligible model per provider, for side-by-side comparison.
 *
 * This is the same ranking read a second way, not a second algorithm: one
 * optimizer pass produces the order, and each provider's first appearance in
 * it is that provider's best choice. A provider with no rankable model is
 * reported with a null choice rather than omitted, so a comparison never hides
 * the fact that one side had no evidence.
 */
export interface ProviderChoice {
  provider: string;
  providerName: string | null;
  choice: OptimizerCandidate | null;
  /** Why this provider has no choice, when it has none. */
  reason: string | null;
}

export function bestPerProvider(
  result: StackOptimizerResult,
  providers: readonly string[],
): ProviderChoice[] {
  return providers.map((provider) => {
    const choice =
      result.ranked.find((candidate) =>
        providerMatches(candidate.provider.slug, [provider]),
      ) ?? null;
    if (choice) {
      return {
        provider,
        providerName: choice.provider.name,
        choice,
        reason: null,
      };
    }

    const eligibleUnpriced = result.eligibleWithoutCost.filter((candidate) =>
      providerMatches(candidate.provider.slug, [provider]),
    );
    const excludedHere = result.excluded.filter((candidate) =>
      providerMatches(candidate.provider.slug, [provider]),
    );

    return {
      provider,
      providerName: eligibleUnpriced[0]?.provider.name ?? excludedHere[0]?.provider.name ?? null,
      choice: null,
      reason:
        eligibleUnpriced.length > 0
          ? `${eligibleUnpriced.length} model(s) met the requirements but carry no comparable price.`
          : excludedHere.length > 0
            ? `All ${excludedHere.length} model(s) from this provider failed at least one requirement.`
            : "AI Radar holds no canonical models for this provider.",
    };
  });
}
