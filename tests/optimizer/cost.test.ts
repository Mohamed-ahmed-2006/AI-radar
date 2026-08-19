import test from "node:test";
import assert from "node:assert/strict";

import {
  TOKENS_PER_PRICING_UNIT,
  calculateComponentCost,
  calculateMonthlyCost,
  costExclusionFor,
  costMetric,
  formatMoney,
  roundCost,
} from "../../lib/optimizer";
import type { ModelPricingTier } from "../../lib/explorer";

const WORKLOAD_100M_20M = {
  monthlyInputTokens: 100_000_000,
  monthlyOutputTokens: 20_000_000,
};

function tier(
  overrides: Partial<ModelPricingTier> &
    Pick<ModelPricingTier, "inputPricePer1MTokens" | "outputPricePer1MTokens">,
): ModelPricingTier {
  return {
    pricingMode: "standard",
    contextTier: "default",
    cachedInputPricePer1MTokens: null,
    cacheWritePricePer1MTokens: null,
    currency: "USD",
    unit: "1M tokens",
    observedAt: "2026-08-19T12:00:00.000Z",
    snapshotId: "snap-test",
    ...overrides,
  };
}

test("Cost: (tokens / 1M) x price is the only arithmetic, and it is stable", () => {
  const input = calculateComponentCost(100_000_000, 1.25, "input");
  const output = calculateComponentCost(20_000_000, 10, "output");

  assert.equal(input.status, "calculated");
  assert.equal(input.amount, 125);
  assert.equal(output.amount, 200);
  assert.equal(input.formula, "100000000 / 1000000 x 1.25 = 125");
  assert.equal(output.formula, "20000000 / 1000000 x 10 = 200");
  assert.equal(roundCost(125 + 200), 325);
  assert.equal(TOKENS_PER_PRICING_UNIT, 1_000_000);
});

test("Cost: 100M input + 20M output at Flash prices is $80.00", () => {
  const cost = calculateMonthlyCost(
    tier({ inputPricePer1MTokens: 0.3, outputPricePer1MTokens: 2.5 }),
    WORKLOAD_100M_20M,
    "USD",
  );

  assert.equal(cost.complete, true);
  assert.equal(cost.totalMonthlyCost, 80);
  assert.equal(cost.input.amount, 30);
  assert.equal(cost.output.amount, 50);
  assert.equal(formatMoney(cost.totalMonthlyCost ?? 0), "$80.00");
  assert.equal(costExclusionFor(cost, tier({ inputPricePer1MTokens: 0.3, outputPricePer1MTokens: 2.5 }), "USD"), null);
});

test("Cost: a missing price is null, never zero, and cannot enter a ranking", () => {
  const missingInput = calculateMonthlyCost(
    tier({ inputPricePer1MTokens: null, outputPricePer1MTokens: 10 }),
    WORKLOAD_100M_20M,
    "USD",
  );
  assert.equal(missingInput.complete, false);
  assert.equal(missingInput.totalMonthlyCost, null);
  assert.equal(missingInput.input.amount, null);
  assert.equal(missingInput.output.amount, 200);
  assert.equal(costMetric(missingInput, "lowest_total_cost"), null);
  assert.equal(costExclusionFor(missingInput, tier({ inputPricePer1MTokens: null, outputPricePer1MTokens: 10 }), "USD")?.code, "input_price_unobserved");

  const noTier = calculateMonthlyCost(null, WORKLOAD_100M_20M, "USD");
  assert.equal(noTier.complete, false);
  assert.equal(noTier.totalMonthlyCost, null);
  assert.equal(costExclusionFor(noTier, null, "USD")?.code, "no_pricing_evidence");
});

test("Cost: zero tokens on a dimension costs zero even without a published price", () => {
  const cost = calculateMonthlyCost(
    tier({ inputPricePer1MTokens: null, outputPricePer1MTokens: null }),
    { monthlyInputTokens: 0, monthlyOutputTokens: 0 },
    "USD",
  );
  assert.equal(cost.complete, true);
  assert.equal(cost.totalMonthlyCost, 0);
  assert.equal(cost.input.status, "not_applicable");
  assert.equal(cost.output.status, "not_applicable");
});

test("Cost: a foreign currency is not converted and is not comparable", () => {
  const cost = calculateMonthlyCost(
    tier({ inputPricePer1MTokens: 1, outputPricePer1MTokens: 2, currency: "EUR" }),
    WORKLOAD_100M_20M,
    "USD",
  );
  assert.equal(cost.complete, false);
  assert.equal(cost.totalMonthlyCost, null);
  assert.equal(
    costExclusionFor(
      cost,
      tier({ inputPricePer1MTokens: 1, outputPricePer1MTokens: 2, currency: "EUR" }),
      "USD",
    )?.code,
    "currency_not_comparable",
  );
});

test("Cost: repeated runs on the same inputs are byte-identical", () => {
  const first = calculateMonthlyCost(
    tier({ inputPricePer1MTokens: 1.25, outputPricePer1MTokens: 10 }),
    WORKLOAD_100M_20M,
    "USD",
  );
  const second = calculateMonthlyCost(
    tier({ inputPricePer1MTokens: 1.25, outputPricePer1MTokens: 10 }),
    WORKLOAD_100M_20M,
    "USD",
  );
  assert.deepEqual(first, second);
  assert.equal(roundCost(0.1 + 0.2), roundCost(0.3));
});
