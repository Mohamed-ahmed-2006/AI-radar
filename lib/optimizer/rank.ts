/**
 * Deterministic ranking and its explanation.
 *
 * Ranking is a total order, not a score. The primary key is the metric the
 * caller asked to minimise; every tie is broken by further evidence and,
 * ultimately, by canonical model id — which is unique — so two runs over the
 * same rows always produce the same sequence. No weighting, no heuristics and
 * no language model participate in the ordering.
 *
 * Only candidates whose metric is a real number are ranked. A model with no
 * comparable price is not last, it is absent: sorting it to the end would
 * still let a caller read it as "the most expensive option", which is a claim
 * the evidence does not support.
 */

import { costMetric, formatMoney, priorityLabel, roundCost } from "./cost";
import type {
  NormalizedStackOptimizerRequest,
  OptimizationPriority,
  OptimizerCandidate,
} from "./types";

/** Compares two nullable numbers, sorting unknown last in both directions. */
function byNumber(left: number | null, right: number | null, descending = false): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  if (left === right) return 0;
  return descending ? right - left : left - right;
}

/**
 * The full tiebreak chain, applied in order:
 *
 *   1. the requested metric
 *   2. total monthly cost
 *   3. input cost, then output cost
 *   4. the larger context window
 *   5. provider slug, model name, canonical id
 *
 * Steps 2–4 are still evidence: a caller minimising input cost who lands on a
 * tie is better served by the cheaper total than by alphabetical order. The
 * last step exists only to guarantee a total order.
 */
export function compareCandidates(
  left: OptimizerCandidate,
  right: OptimizerCandidate,
  priority: OptimizationPriority,
): number {
  const metric = byNumber(costMetric(left.cost, priority), costMetric(right.cost, priority));
  if (metric !== 0) return metric;

  const total = byNumber(left.cost.totalMonthlyCost, right.cost.totalMonthlyCost);
  if (total !== 0) return total;

  const input = byNumber(left.cost.input.amount, right.cost.input.amount);
  if (input !== 0) return input;

  const output = byNumber(left.cost.output.amount, right.cost.output.amount);
  if (output !== 0) return output;

  const context = byNumber(
    left.capabilities.contextWindow,
    right.capabilities.contextWindow,
    true,
  );
  if (context !== 0) return context;

  return (
    left.provider.slug.localeCompare(right.provider.slug) ||
    left.modelName.localeCompare(right.modelName) ||
    left.canonicalModelId.localeCompare(right.canonicalModelId)
  );
}

/**
 * Orders the rankable candidates and stamps each with its 1-based rank.
 *
 * Returns new objects; the inputs are left untouched so a caller can still
 * report the unranked set from the same array it passed in.
 */
export function rankCandidates(
  candidates: readonly OptimizerCandidate[],
  priority: OptimizationPriority,
): OptimizerCandidate[] {
  const rankable = candidates.filter(
    (candidate) => costMetric(candidate.cost, priority) !== null,
  );

  return [...rankable]
    .sort((left, right) => compareCandidates(left, right, priority))
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
      rankBasis: priorityLabel(priority),
    }));
}

function tokens(value: number): string {
  return value.toLocaleString("en-US");
}

function requirementSentence(request: NormalizedStackOptimizerRequest): string {
  const parts: string[] = [];
  if (request.minContextWindow !== null) {
    parts.push(`context window at least ${tokens(request.minContextWindow)}`);
  }
  if (request.minMaxOutputTokens !== null) {
    parts.push(`max output tokens at least ${tokens(request.minMaxOutputTokens)}`);
  }
  if (request.visionRequired) parts.push("vision required");
  if (request.toolCallingRequired) parts.push("tool calling required");
  if (request.activeOnly) parts.push("deprecated and retired models excluded");
  if (request.providers.length > 0) {
    parts.push(`providers limited to ${request.providers.join(", ")}`);
  }
  if (request.excludeProviders.length > 0) {
    parts.push(`providers excluded: ${request.excludeProviders.join(", ")}`);
  }
  if (request.excludeModelIds.length > 0) {
    parts.push(`${request.excludeModelIds.length} model(s) excluded by id`);
  }
  return parts.length > 0 ? parts.join("; ") : "no capability or lifecycle constraints";
}

/**
 * The ranking, written out.
 *
 * Every line restates a number that appears in the structured result, so the
 * explanation can be checked against the data rather than trusted. The
 * closing lines account for models that met the requirements but carried no
 * comparable price, and for models the requirements dropped — both are part
 * of the answer, not a footnote.
 */
export function buildExplanation(
  request: NormalizedStackOptimizerRequest,
  ranked: readonly OptimizerCandidate[],
  eligibleWithoutCost: readonly OptimizerCandidate[],
  excludedCount: number,
  totalConsidered: number,
): string[] {
  const lines: string[] = [];
  const { monthlyInputTokens, monthlyOutputTokens } = request.workload;

  lines.push(
    `Evaluated ${totalConsidered} canonical model(s) against a monthly workload of ` +
      `${tokens(monthlyInputTokens)} input tokens and ${tokens(monthlyOutputTokens)} ` +
      `output tokens, with ${requirementSentence(request)}.`,
  );
  lines.push(
    `Cost per model is (input tokens / 1000000) x input price plus ` +
      `(output tokens / 1000000) x output price, using the primary published ` +
      `pricing tier in ${request.currency}.`,
  );

  if (ranked.length === 0) {
    lines.push(
      "No model carried both the required evidence and a comparable price, so no " +
        "ranking was produced and no winner was selected.",
    );
  } else {
    lines.push(
      `Ranked ${ranked.length} model(s) by ${priorityLabel(request.priority)}; ` +
        "ties broken by total cost, then input cost, then output cost, then the " +
        "larger context window, then provider and model name.",
    );

    for (const candidate of ranked) {
      const cost = candidate.cost;
      const total = cost.totalMonthlyCost;
      const inputAmount = cost.input.amount;
      const outputAmount = cost.output.amount;
      lines.push(
        `${candidate.rank}. ${candidate.modelName} (${candidate.provider.name}) — ` +
          `${total === null ? "total unknown" : `${formatMoney(total)} per month`} = ` +
          `${inputAmount === null ? "unknown" : formatMoney(inputAmount)} input + ` +
          `${outputAmount === null ? "unknown" : formatMoney(outputAmount)} output.`,
      );
    }

    const [winner, runnerUp] = ranked;
    if (runnerUp) {
      const winnerMetric = costMetric(winner.cost, request.priority);
      const runnerMetric = costMetric(runnerUp.cost, request.priority);
      if (winnerMetric !== null && runnerMetric !== null) {
        const gap = roundCost(runnerMetric - winnerMetric);
        lines.push(
          gap === 0
            ? `${winner.modelName} and ${runnerUp.modelName} tie on ` +
              `${priorityLabel(request.priority)}; ${winner.modelName} ranks first on ` +
              "the tiebreak chain."
            : `${winner.modelName} costs ${formatMoney(gap)} per month less than ` +
              `${runnerUp.modelName} on ${priorityLabel(request.priority)}.`,
        );
      }
    } else {
      lines.push(
        `${winner.modelName} is the only model with both the required evidence and a ` +
          "comparable price, so it wins by default rather than by margin.",
      );
    }
  }

  if (eligibleWithoutCost.length > 0) {
    lines.push(
      `${eligibleWithoutCost.length} model(s) met every requirement but carry no ` +
        `comparable price and were not ranked: ` +
        `${eligibleWithoutCost.map((candidate) => candidate.modelName).join(", ")}.`,
    );
  }

  if (excludedCount > 0) {
    lines.push(
      `${excludedCount} model(s) failed at least one requirement and were excluded; ` +
        "each excluded model lists every failing check, including checks that failed " +
        "because the evidence was never collected.",
    );
  }

  return lines;
}
