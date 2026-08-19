/**
 * Deterministic answer text. Every sentence is a restatement of structured
 * evidence — never a guess, never a pretrained fact.
 */

import { formatMoney } from "../optimizer/cost";
import type { ProviderChoice, StackOptimizerResult } from "../optimizer";
import type { ComparisonIntent, ModelFilterIntent, WorkloadOptimizerIntent } from "./intent";

function label(candidate: { modelName: string; displayName: string | null }): string {
  return candidate.displayName ?? candidate.modelName;
}

function tokens(value: number): string {
  return value.toLocaleString("en-US");
}

function names(optimizer: StackOptimizerResult, limit = 8): string {
  return [...optimizer.ranked, ...optimizer.eligibleWithoutCost]
    .slice(0, limit)
    .map((candidate) => label(candidate))
    .join(", ");
}

export function optimizerAnswer(
  intent: WorkloadOptimizerIntent,
  optimizer: StackOptimizerResult,
): string {
  const { monthlyInputTokens, monthlyOutputTokens } = intent.workload;
  const workload =
    `${tokens(monthlyInputTokens)} input tokens and ${tokens(monthlyOutputTokens)} ` +
    "output tokens per month";

  if (optimizer.winner && optimizer.winner.cost.totalMonthlyCost !== null) {
    const winner = optimizer.winner;
    const total = formatMoney(optimizer.winner.cost.totalMonthlyCost);
    const runnerUp = optimizer.ranked[1];
    const runner =
      runnerUp && runnerUp.cost.totalMonthlyCost !== null
        ? ` Next is ${label(runnerUp)} at ${formatMoney(runnerUp.cost.totalMonthlyCost)}.`
        : "";
    return (
      `${label(winner)} (${winner.provider.name}) is the cheapest eligible model ` +
      `at ${total} per month for ${workload}.${runner}`
    );
  }

  if (optimizer.insufficientEvidence) {
    return optimizer.insufficientEvidence.detail;
  }

  return `No eligible model could be ranked for ${workload} from trusted evidence.`;
}

export function filterAnswer(
  intent: ModelFilterIntent,
  optimizer: StackOptimizerResult | null,
  eligibleCount: number,
  totalConsidered: number,
): string {
  if (intent.superlative === "cheapest_unit_price" && optimizer) {
    if (optimizer.winner && optimizer.winner.cost.totalMonthlyCost !== null) {
      const winner = optimizer.winner;
      return (
        `${label(winner)} (${winner.provider.name}) has the lowest published ` +
        `combined unit price among models that meet the stated requirements, at ` +
        `${formatMoney(optimizer.winner.cost.totalMonthlyCost)} per 1 million input ` +
        `plus 1 million output tokens. No monthly workload was stated, so this is a ` +
        `unit-price ranking rather than a bill.`
      );
    }
    if (optimizer.insufficientEvidence) return optimizer.insufficientEvidence.detail;
  }

  if (eligibleCount === 0) {
    return (
      "No model in trusted evidence satisfied every stated requirement. Requirements " +
      "that depend on evidence AI Radar has not collected fail closed."
    );
  }

  const listed = optimizer ? names(optimizer) : "";
  const suffix = listed ? `: ${listed}` : "";
  return (
    `Trusted evidence currently lists ${eligibleCount} of ${totalConsidered} ` +
    `canonical model(s) that meet the stated requirements${suffix}.`
  );
}

export function comparisonAnswer(
  intent: ComparisonIntent,
  choices: readonly ProviderChoice[],
  optimizer: StackOptimizerResult,
): string {
  const parts = choices.map((choice) => {
    if (choice.choice && choice.choice.cost.totalMonthlyCost !== null) {
      return (
        `${choice.provider}: ${label(choice.choice)} at ` +
        `${formatMoney(choice.choice.cost.totalMonthlyCost)}`
      );
    }
    return `${choice.provider}: no comparable choice (${choice.reason ?? "insufficient evidence"})`;
  });

  const { monthlyInputTokens, monthlyOutputTokens } = intent.workload;
  const unit =
    monthlyInputTokens === 1_000_000 && monthlyOutputTokens === 1_000_000
      ? "Ranked by published prices per 1 million input and output tokens."
      : `Ranked for ${tokens(monthlyInputTokens)} input and ${tokens(monthlyOutputTokens)} output tokens per month.`;

  if (optimizer.ranked.length === 0) {
    return (
      `Trusted evidence could not name a cheapest eligible choice for ` +
      `${intent.compareProviders.join(", ")}. ${unit}`
    );
  }

  return `Cheapest eligible choices — ${parts.join("; ")}. ${unit}`;
}

export function optimizerCalculations(
  optimizer: StackOptimizerResult,
  note: string | null,
): Array<{ label: string; expression: string | null; result: string; note: string | null }> {
  return optimizer.ranked.slice(0, 10).map((candidate) => {
    const total = candidate.cost.totalMonthlyCost;
    return {
      label: `${label(candidate)} estimated cost`,
      expression: `${candidate.cost.input.formula} + ${candidate.cost.output.formula}`,
      result: total === null ? "unknown" : formatMoney(total),
      note,
    };
  });
}
