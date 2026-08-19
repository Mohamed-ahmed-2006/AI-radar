/**
 * Deterministic monthly cost arithmetic.
 *
 * The whole calculation is one line of algebra per dimension:
 *
 *     cost = (tokens / 1_000_000) x pricePer1MTokens
 *
 * Everything else in this file exists to keep that line honest. Results are
 * rounded to six decimal places so that repeated runs on the same evidence
 * produce byte-identical numbers rather than float noise, and every component
 * records the formula that produced it.
 *
 * Two absences are not the same thing. Zero tokens on a dimension costs zero
 * whether or not a price was published — no evidence is needed to know that.
 * Non-zero tokens with no published price is a hole, and a hole is null, never
 * zero: pricing a model at nothing would hand it the cheapest slot it has no
 * evidence to claim.
 */

import type { ModelPricingTier } from "../explorer/types";
import type {
  CostComponent,
  CostExclusion,
  MonthlyCost,
  OptimizationPriority,
  WorkloadSpec,
} from "./types";

export const TOKENS_PER_PRICING_UNIT = 1_000_000;

/** Six decimals: finer than a millionth of a dollar is not evidence. */
export const COST_DECIMALS = 6;

const COST_SCALE = 10 ** COST_DECIMALS;

/** Rounds to `COST_DECIMALS`, so equal inputs always compare equal. */
export function roundCost(value: number): number {
  return Math.round((value + Number.EPSILON) * COST_SCALE) / COST_SCALE;
}

/** Renders a number without exponent notation, for formulas and summaries. */
function plain(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : String(roundCost(value));
}

/** `$12.34`. Two decimals everywhere, so groundedness checks can match it. */
export function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * One dimension of the bill.
 *
 * `tokens === 0` short-circuits to zero and reports `not_applicable`: the
 * caller asked for no tokens, so a missing price is irrelevant rather than
 * disqualifying.
 */
export function calculateComponentCost(
  tokens: number,
  pricePer1MTokens: number | null,
  label: string,
): CostComponent {
  if (tokens === 0) {
    return {
      tokens: 0,
      pricePer1MTokens,
      amount: 0,
      status: "not_applicable",
      formula: `0 ${label} tokens = 0`,
    };
  }

  if (pricePer1MTokens === null) {
    return {
      tokens,
      pricePer1MTokens: null,
      amount: null,
      status: "not_priced",
      formula: `${plain(tokens)} ${label} tokens x (no published ${label} price) = unknown`,
    };
  }

  const amount = roundCost((tokens / TOKENS_PER_PRICING_UNIT) * pricePer1MTokens);
  return {
    tokens,
    pricePer1MTokens,
    amount,
    status: "calculated",
    formula:
      `${plain(tokens)} / ${TOKENS_PER_PRICING_UNIT} x ${plain(pricePer1MTokens)} ` +
      `= ${plain(amount)}`,
  };
}

function unpricedComponent(tokens: number, label: string): CostComponent {
  if (tokens === 0) {
    return {
      tokens: 0,
      pricePer1MTokens: null,
      amount: 0,
      status: "not_applicable",
      formula: `0 ${label} tokens = 0`,
    };
  }
  return {
    tokens,
    pricePer1MTokens: null,
    amount: null,
    status: "not_priced",
    formula: `${plain(tokens)} ${label} tokens x (no comparable price) = unknown`,
  };
}

/** A total exists only when both halves do. There are no partial totals. */
function totalOf(input: CostComponent, output: CostComponent): number | null {
  if (input.amount === null || output.amount === null) return null;
  return roundCost(input.amount + output.amount);
}

/**
 * The monthly bill for one model under one workload.
 *
 * `tier` is the model's primary pricing tier as the explorer selected it —
 * deterministically, by pricing mode and context tier, never by price. Passing
 * null (no pricing evidence at all) yields an incomplete cost rather than an
 * error, because "no price was collected" is itself a reportable answer.
 *
 * A price published in a currency other than the requested one is not
 * converted. Conversion would need an exchange rate AI Radar does not collect,
 * so the tier is treated as not comparable and the cost stays null.
 */
export function calculateMonthlyCost(
  tier: ModelPricingTier | null,
  workload: WorkloadSpec,
  currency: string,
): MonthlyCost {
  if (!tier) {
    const input = unpricedComponent(workload.monthlyInputTokens, "input");
    const output = unpricedComponent(workload.monthlyOutputTokens, "output");
    return {
      input,
      output,
      totalMonthlyCost: totalOf(input, output),
      currency: null,
      complete: input.amount !== null && output.amount !== null,
      pricingMode: null,
      contextTier: null,
      pricingSnapshotId: null,
      pricingObservedAt: null,
    };
  }

  const comparableCurrency =
    tier.currency === null || tier.currency.toUpperCase() === currency.toUpperCase();

  const input = comparableCurrency
    ? calculateComponentCost(
        workload.monthlyInputTokens,
        tier.inputPricePer1MTokens,
        "input",
      )
    : unpricedComponent(workload.monthlyInputTokens, "input");
  const output = comparableCurrency
    ? calculateComponentCost(
        workload.monthlyOutputTokens,
        tier.outputPricePer1MTokens,
        "output",
      )
    : unpricedComponent(workload.monthlyOutputTokens, "output");

  return {
    input,
    output,
    totalMonthlyCost: totalOf(input, output),
    currency: tier.currency,
    complete: input.amount !== null && output.amount !== null,
    pricingMode: tier.pricingMode,
    contextTier: tier.contextTier,
    pricingSnapshotId: tier.snapshotId,
    pricingObservedAt: tier.observedAt,
  };
}

/**
 * Why this cost cannot enter a ranking, or null when it can.
 *
 * Ordered from the most complete explanation to the least: no evidence at all
 * beats naming a single missing field, and a currency mismatch is reported as
 * itself rather than as two missing prices.
 */
export function costExclusionFor(
  cost: MonthlyCost,
  tier: ModelPricingTier | null,
  currency: string,
): CostExclusion | null {
  if (cost.complete) return null;

  if (!tier) {
    return {
      code: "no_pricing_evidence",
      detail: "No pricing snapshot has been collected for this model.",
    };
  }

  if (tier.currency !== null && tier.currency.toUpperCase() !== currency.toUpperCase()) {
    return {
      code: "currency_not_comparable",
      detail:
        `Prices are published in ${tier.currency}, which is not comparable to ` +
        `${currency}. AI Radar does not collect exchange rates and will not convert.`,
    };
  }

  if (cost.input.status === "not_priced") {
    return {
      code: "input_price_unobserved",
      detail:
        `The workload sends ${plain(cost.input.tokens)} input tokens and no input ` +
        `price has been observed for the ${tier.pricingMode}/${tier.contextTier} tier.`,
    };
  }

  return {
    code: "output_price_unobserved",
    detail:
      `The workload sends ${plain(cost.output.tokens)} output tokens and no output ` +
      `price has been observed for the ${tier.pricingMode}/${tier.contextTier} tier.`,
  };
}

/** The number the ranking sorts on, or null when the model is not rankable. */
export function costMetric(
  cost: MonthlyCost,
  priority: OptimizationPriority,
): number | null {
  switch (priority) {
    case "lowest_input_cost":
      return cost.input.amount;
    case "lowest_output_cost":
      return cost.output.amount;
    case "lowest_total_cost":
    default:
      return cost.totalMonthlyCost;
  }
}

const PRIORITY_LABELS: Record<OptimizationPriority, string> = {
  lowest_total_cost: "lowest estimated total monthly cost",
  lowest_input_cost: "lowest estimated monthly input cost",
  lowest_output_cost: "lowest estimated monthly output cost",
};

export function priorityLabel(priority: OptimizationPriority): string {
  return PRIORITY_LABELS[priority];
}
