import test from "node:test";
import assert from "node:assert/strict";

import {
  InMemoryModelExplorerReadPort,
  type InMemoryExplorerData,
} from "../../lib/explorer";
import {
  bestPerProvider,
  optimizeStack,
  type StackOptimizerResult,
} from "../../lib/optimizer";
import {
  CLAUDE_3_OPUS,
  CLAUDE_SONNET_5,
  GEMINI_25_FLASH,
  GEMINI_25_FLASH_PREVIEW,
  GEMINI_3_PRO,
  GPT_5,
  GROK_4,
  explorerData,
  now,
} from "../explorer/support/fixtures";

const WORKLOAD = {
  monthlyInputTokens: 100_000_000,
  monthlyOutputTokens: 20_000_000,
};

function port(data?: InMemoryExplorerData) {
  return new InMemoryModelExplorerReadPort(data ?? explorerData());
}

async function run(
  request: Parameters<typeof optimizeStack>[0],
  data?: InMemoryExplorerData,
): Promise<StackOptimizerResult> {
  return optimizeStack(request, { port: port(data), now });
}

function rankedIds(result: StackOptimizerResult): string[] {
  return result.ranked.map((candidate) => candidate.canonicalModelId);
}

test("Optimizer: 100M input + 20M output ranks by deterministic monthly cost", async () => {
  const result = await run({ workload: WORKLOAD });

  // Flash Preview 0.15/0.6 = $27, Flash 0.3/2.5 = $80, GPT-5 1.25/10 = $325,
  // Gemini 3 Pro 2/12 = $440, Sonnet 3/15 = $600, Opus 15/75 = $3000.
  assert.equal(result.winner?.canonicalModelId, GEMINI_25_FLASH_PREVIEW.id);
  assert.equal(result.winner?.cost.totalMonthlyCost, 27);
  assert.equal(result.ranked[1]?.canonicalModelId, GEMINI_25_FLASH.id);
  assert.equal(result.ranked[1]?.cost.totalMonthlyCost, 80);
  assert.equal(result.ranked[2]?.canonicalModelId, GPT_5.id);
  assert.equal(result.ranked[2]?.cost.totalMonthlyCost, 325);
  assert.ok(result.explanation.some((line) => line.includes("$27.00")));
  assert.equal(result.insufficientEvidence, null);
});

test("Optimizer: vision required admits only an explicit true and fails closed on null", async () => {
  const result = await run({ workload: WORKLOAD, visionRequired: true });

  assert.deepEqual(rankedIds(result).sort(), [GPT_5.id, GEMINI_25_FLASH.id].sort());
  assert.ok(!rankedIds(result).includes(CLAUDE_SONNET_5.id), "null vision fails closed");
  assert.ok(!rankedIds(result).includes(GROK_4.id), "false vision is ineligible");
  assert.ok(!rankedIds(result).includes(GEMINI_3_PRO.id), "unobserved capabilities fail closed");

  const sonnet = result.excluded.find((row) => row.canonicalModelId === CLAUDE_SONNET_5.id);
  assert.ok(sonnet);
  assert.ok(sonnet.reasons.some((reason) => reason.requirement === "vision" && reason.status === "unknown"));

  const grok = result.excluded.find((row) => row.canonicalModelId === GROK_4.id);
  assert.ok(grok);
  assert.ok(grok.reasons.some((reason) => reason.requirement === "vision" && reason.status === "unsatisfied"));
});

test("Optimizer: tool calling required admits only an explicit true", async () => {
  const result = await run({
    workload: WORKLOAD,
    toolCallingRequired: true,
  });

  assert.ok(rankedIds(result).includes(GPT_5.id));
  assert.ok(rankedIds(result).includes(CLAUDE_SONNET_5.id));
  assert.ok(rankedIds(result).includes(GEMINI_25_FLASH.id));
  assert.ok(!rankedIds(result).includes(GEMINI_25_FLASH_PREVIEW.id), "unobserved tools fail closed");
});

test("Optimizer: a context floor never admits an unobserved window", async () => {
  const result = await run({
    workload: WORKLOAD,
    minContextWindow: 200_000,
  });

  assert.ok(rankedIds(result).includes(GPT_5.id));
  assert.ok(rankedIds(result).includes(CLAUDE_SONNET_5.id));
  assert.ok(rankedIds(result).includes(GEMINI_25_FLASH.id));
  assert.ok(!rankedIds(result).includes(GEMINI_3_PRO.id));
  assert.ok(!rankedIds(result).includes(GEMINI_25_FLASH_PREVIEW.id));
});

test("Optimizer: active-only drops observed deprecations and keeps unknown lifecycle", async () => {
  const result = await run({ workload: WORKLOAD, activeOnly: true });

  assert.ok(!rankedIds(result).includes(CLAUDE_3_OPUS.id));
  assert.ok(!rankedIds(result).includes(GEMINI_25_FLASH_PREVIEW.id));
  assert.ok(rankedIds(result).includes(GPT_5.id), "unobserved lifecycle is not retired");
  assert.equal(result.winner?.canonicalModelId, GEMINI_25_FLASH.id);
});

test("Optimizer: missing pricing never qualifies for cheapest-cost ranking", async () => {
  const result = await run({ workload: WORKLOAD });

  const grok = result.eligibleWithoutCost.find((row) => row.canonicalModelId === GROK_4.id);
  assert.ok(grok, "Grok meets unconstrained requirements");
  assert.equal(grok.rank, null);
  assert.equal(grok.cost.totalMonthlyCost, null);
  assert.equal(grok.costExclusion?.code, "no_pricing_evidence");
  assert.ok(!rankedIds(result).includes(GROK_4.id));
});

test("Optimizer: multi-provider ranking is a total order over comparable prices", async () => {
  const result = await run({
    workload: WORKLOAD,
    activeOnly: true,
    visionRequired: true,
    toolCallingRequired: true,
    minContextWindow: 128_000,
  });

  assert.deepEqual(rankedIds(result), [GEMINI_25_FLASH.id, GPT_5.id]);
  assert.equal(result.winner?.provider.slug, "gemini");
  assert.equal(result.ranked[1]?.provider.slug, "openai");

  const choices = bestPerProvider(result, ["openai", "anthropic", "google"]);
  assert.equal(choices[0]?.choice?.canonicalModelId, GPT_5.id);
  assert.equal(choices[1]?.choice, null, "Anthropic Sonnet vision is unobserved");
  assert.equal(choices[2]?.choice?.canonicalModelId, GEMINI_25_FLASH.id);
});

test("Optimizer: every ranked row carries pricing provenance and freshness", async () => {
  const result = await run({ workload: WORKLOAD, activeOnly: true });

  assert.ok(result.provenance.length > 0);
  assert.ok(result.evidenceFreshness.oldestObservedAt);
  assert.ok(result.evidenceFreshness.newestObservedAt);
  for (const candidate of result.ranked) {
    assert.ok(candidate.provenance.pricing, `${candidate.modelName} must carry pricing provenance`);
    assert.equal(candidate.rank, result.ranked.indexOf(candidate) + 1);
    assert.equal(candidate.requirementChecks.length, 8);
  }
});

test("Optimizer: an empty catalog is insufficient evidence, not a guessed winner", async () => {
  const result = await run({ workload: WORKLOAD }, { models: [] });

  assert.equal(result.winner, null);
  assert.equal(result.ranked.length, 0);
  assert.equal(result.insufficientEvidence?.code, "no_models");
});

test("Optimizer: when nothing is priced the result says so instead of ranking zeros", async () => {
  const data = explorerData();
  const unpriced = {
    ...data,
    pricingSnapshots: [],
  };
  const result = await run({ workload: WORKLOAD }, unpriced);

  assert.equal(result.winner, null);
  assert.equal(result.ranked.length, 0);
  assert.ok(result.eligibleCount > 0);
  assert.equal(result.insufficientEvidence?.code, "no_comparable_pricing");
});

test("Optimizer: unknown evidence cannot satisfy a requirement that depends on it", async () => {
  const result = await run({
    workload: WORKLOAD,
    visionRequired: true,
    providers: ["anthropic"],
  });

  assert.equal(result.winner, null);
  assert.equal(result.insufficientEvidence?.code, "no_eligible_models");
  assert.ok(
    result.excluded.every((row) =>
      row.reasons.some((reason) => reason.status === "unknown" || reason.status === "unsatisfied"),
    ),
  );
});
