/**
 * A generic price quotes the ordinary request, not the surcharge.
 *
 * `selectPrimaryPricingTier` looked for a `default` context tier and, finding
 * none, sorted tier names alphabetically. Every provider that publishes
 * `short`/`long` therefore had its long-context surcharge quoted as the model's
 * headline price — GPT-5.6 Luna at 0.40/1.80 instead of 0.20/1.20, grok-4.6 at
 * 4/12 instead of 2/6 — on Explorer, Model Detail, Compare, the Optimizer and
 * Ask Decision alike, because all five read this one selection.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  isLongContextTier,
  selectPrimaryPricingTier,
} from "../../lib/explorer/evidence";
import type { ModelPricingTier } from "../../lib/explorer";

function tier(
  contextTier: string,
  input: number,
  output: number,
  pricingMode = "standard",
): ModelPricingTier {
  return {
    pricingMode,
    contextTier,
    inputPricePer1MTokens: input,
    cachedInputPricePer1MTokens: null,
    cacheWritePricePer1MTokens: null,
    outputPricePer1MTokens: output,
    currency: "USD",
    unit: "1M tokens",
    observedAt: "2026-08-21T00:00:00.000Z",
    snapshotId: `snap-${pricingMode}-${contextTier}`,
  };
}

/** The two tiers the live database holds for GPT-5.6 Luna. */
const LUNA = [tier("long", 0.4, 1.8), tier("short", 0.2, 1.2)];

/** The two tiers the live database holds for grok-4.6. */
const GROK = [tier("long", 4, 12), tier("short", 2, 6)];

test("GPT-5.6 Luna quotes the standard short-context tier, not the surcharge", () => {
  const primary = selectPrimaryPricingTier(LUNA);
  assert.equal(primary?.contextTier, "short");
  assert.equal(primary?.inputPricePer1MTokens, 0.2);
  assert.equal(primary?.outputPricePer1MTokens, 1.2);
});

test("grok-4.6 quotes the standard short-context tier, not the surcharge", () => {
  const primary = selectPrimaryPricingTier(GROK);
  assert.equal(primary?.contextTier, "short");
  assert.equal(primary?.inputPricePer1MTokens, 2);
  assert.equal(primary?.outputPricePer1MTokens, 6);
});

/** Tier order must not decide the answer: the rule is about meaning, not arrival. */
test("selection is independent of the order the tiers arrive in", () => {
  assert.equal(selectPrimaryPricingTier([...LUNA].reverse())?.contextTier, "short");
  assert.equal(selectPrimaryPricingTier([...GROK].reverse())?.contextTier, "short");
});

test("an explicit default tier still wins where a provider publishes one", () => {
  const tiers = [tier("long", 9, 9), tier("default", 1, 2), tier("short", 3, 4)];
  assert.equal(selectPrimaryPricingTier(tiers)?.contextTier, "default");
});

test("a non-standard pricing mode never outranks the standard one", () => {
  const tiers = [tier("short", 2, 6, "batch"), tier("short", 4, 12, "standard")];
  assert.equal(selectPrimaryPricingTier(tiers)?.pricingMode, "standard");
});

/** The long tier is a real published price and stays reachable — just not first. */
test("the long tier remains accessible, it is only not the default", () => {
  const primary = selectPrimaryPricingTier(LUNA);
  assert.notEqual(primary?.contextTier, "long");
  const long = LUNA.find((candidate) => isLongContextTier(candidate.contextTier));
  assert.ok(long);
  assert.equal(long.inputPricePer1MTokens, 0.4);
});

test("long-context tier names are recognised, ordinary ones are not", () => {
  assert.equal(isLongContextTier("long"), true);
  assert.equal(isLongContextTier("extended"), true);
  assert.equal(isLongContextTier("short"), false);
  assert.equal(isLongContextTier("default"), false);
});

/**
 * A tier vocabulary AI Radar has not seen must not be able to displace a known
 * ordinary tier — the failure mode that produced this bug in the first place.
 */
test("an unknown tier name ranks behind a known ordinary tier", () => {
  const tiers = [tier("aardvark", 9, 9), tier("short", 1, 2)];
  assert.equal(selectPrimaryPricingTier(tiers)?.contextTier, "short");
});

/**
 * The Optimizer reads `pricing.primary`, so the fix above reaches it for free.
 * What must also hold is that a *requirement* never becomes evidence: asking
 * for a model that can hold 500K tokens says nothing about how large any one
 * request is, and only per-request context decides whether a surcharge applies.
 */
test("a minimum context requirement never selects the long-context tier", async () => {
  const { optimizeStack, LONG_CONTEXT_SURCHARGE_CAVEAT } = await import(
    "../../lib/optimizer"
  );
  const { InMemoryModelExplorerReadPort } = await import("../../lib/explorer");
  const { explorerData, now } = await import("./support/fixtures");

  const port = new InMemoryModelExplorerReadPort(explorerData());
  const result = await optimizeStack(
    {
      workload: { monthlyInputTokens: 10_000_000, monthlyOutputTokens: 2_000_000 },
      minContextWindow: 300_000,
    },
    { port, now },
  );

  for (const candidate of result.ranked) {
    assert.notEqual(candidate.cost.contextTier, "long");
  }

  // Where a surcharge tier exists at all, the limitation is stated rather than
  // silently assumed away.
  const hasLongTier = result.ranked.some((candidate) =>
    (port.data.pricingSnapshots ?? []).some(
      (row) => row.model_id === candidate.canonicalModelId && row.context_tier === "long",
    ),
  );
  if (hasLongTier) {
    assert.ok(result.explanation.includes(LONG_CONTEXT_SURCHARGE_CAVEAT));
  }
});
