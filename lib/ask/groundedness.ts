/**
 * Groundedness for Ask answers that are not temporal-intelligence summaries.
 *
 * Temporal answers reuse `verifySummaryGroundedness`. Decision answers are
 * checked the same way against the optimizer/filter result: every `$…` amount
 * and every ISO date in the published text must appear in the structured
 * evidence. Model names are not guessed; they are taken from the ranked and
 * excluded rows the executor already returned.
 *
 * An ungrounded draft is never published. The caller swaps in a fallback
 * assembled only from those rows.
 */

import type { GroundednessVerificationResult } from "../intelligence/summarizer";
import { formatMoney } from "../optimizer/cost";
import type { OptimizerCandidate, StackOptimizerResult } from "../optimizer";
import type { AskGroundedness } from "./types";

function pushUnique(values: number[], value: number | null | undefined): void {
  if (value === null || value === undefined) return;
  if (!Number.isFinite(value)) return;
  if (values.some((existing) => Math.abs(existing - value) < 0.001)) return;
  values.push(value);
}

/** Every dollar figure a decision answer is allowed to mention. */
export function collectKnownAmounts(optimizer: StackOptimizerResult | null): number[] {
  if (!optimizer) return [];
  const amounts: number[] = [];
  const consider = (candidate: OptimizerCandidate) => {
    pushUnique(amounts, candidate.cost.totalMonthlyCost);
    pushUnique(amounts, candidate.cost.input.amount);
    pushUnique(amounts, candidate.cost.output.amount);
    pushUnique(amounts, candidate.cost.input.pricePer1MTokens);
    pushUnique(amounts, candidate.cost.output.pricePer1MTokens);
  };
  for (const candidate of optimizer.ranked) consider(candidate);
  for (const candidate of optimizer.eligibleWithoutCost) consider(candidate);
  if (optimizer.winner) consider(optimizer.winner);
  return amounts;
}

export function collectKnownDates(optimizer: StackOptimizerResult | null): string[] {
  if (!optimizer) return [];
  const dates = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (!value) return;
    dates.add(value.slice(0, 10));
  };
  add(optimizer.generatedAt);
  add(optimizer.evidenceFreshness.oldestObservedAt);
  add(optimizer.evidenceFreshness.newestObservedAt);
  for (const candidate of optimizer.ranked) {
    add(candidate.freshness.lastVerifiedAt);
    add(candidate.cost.pricingObservedAt);
  }
  return [...dates];
}

export function verifyDecisionText(
  text: string,
  knownAmounts: readonly number[],
  knownDates: readonly string[],
): AskGroundedness {
  const violations: string[] = [];
  const unsupportedPrices: string[] = [];
  const unsupportedDates: string[] = [];

  const priceMatches = text.match(/\$(\d+(?:\.\d+)?)/g) ?? [];
  for (const match of priceMatches) {
    const num = Number(match.slice(1));
    const matched = knownAmounts.some((value) => Math.abs(value - num) < 0.001);
    if (!matched) {
      unsupportedPrices.push(match);
      violations.push(`Price ${match} is not present in the deterministic evidence set.`);
    }
  }

  const dateMatches = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  for (const dateStr of dateMatches) {
    if (!knownDates.includes(dateStr)) {
      unsupportedDates.push(dateStr);
      violations.push(`Date ${dateStr} does not match any evidence observation or event date.`);
    }
  }

  return {
    isGrounded: violations.length === 0,
    violations,
    unsupportedPrices,
    unsupportedDates,
    groundedFactsCount: knownAmounts.length + knownDates.length,
    sanitized: false,
  };
}

export function groundednessFromTemporal(
  result: GroundednessVerificationResult,
): AskGroundedness {
  return {
    isGrounded: result.isGrounded,
    violations: result.violations,
    unsupportedPrices: result.unsupportedPrices,
    unsupportedDates: result.unsupportedDates,
    groundedFactsCount: result.groundedFactsCount,
    sanitized: !result.isGrounded,
  };
}

export function groundedFallbackFromOptimizer(
  optimizer: StackOptimizerResult,
): string {
  const winner = optimizer.winner;
  if (!winner || winner.cost.totalMonthlyCost === null) {
    return (
      optimizer.insufficientEvidence?.detail ??
      "Trusted evidence is insufficient to rank a model for this question."
    );
  }
  return (
    `${winner.displayName ?? winner.modelName} (${winner.provider.name}) is the cheapest eligible model ` +
    `at ${formatMoney(winner.cost.totalMonthlyCost)} per month.`
  );
}
