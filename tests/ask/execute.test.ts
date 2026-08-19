import test from "node:test";
import assert from "node:assert/strict";

import { answerQuestion, planQuery, type GroundedAskResult } from "../../lib/ask";
import { InMemoryModelExplorerReadPort, type InMemoryExplorerData } from "../../lib/explorer";
import { getDemoTemporalEvidence } from "../../lib/intelligence/demo-evidence";
import {
  CLAUDE_SONNET_5,
  GEMINI_25_FLASH,
  GEMINI_25_FLASH_PREVIEW,
  GPT_5,
  explorerData,
  now,
} from "../explorer/support/fixtures";

const REF_DATE = "2026-08-19T12:00:00.000Z";

function options(data?: InMemoryExplorerData) {
  return {
    port: new InMemoryModelExplorerReadPort(data ?? explorerData()),
    now,
    referenceDate: REF_DATE,
    loadTemporalEvidence: async () => getDemoTemporalEvidence(),
  };
}

async function ask(question: string, data?: InMemoryExplorerData): Promise<GroundedAskResult> {
  return answerQuestion(question, options(data));
}

test("Ask: temporal questions reuse the temporal-intelligence engine", async () => {
  const result = await ask("What changed in Claude this month?");
  assert.equal(result.interpretedIntent, "temporal_change_query");
  assert.equal(result.structured.kind, "temporal_change_query");
  if (result.structured.kind === "temporal_change_query") {
    assert.ok(result.structured.bundle.totalEvents > 0);
    assert.ok(result.structured.bundle.events.every((event) => event.provider === "anthropic"));
  }
  assert.ok(
    result.answerSummary.includes("claude-3-5-sonnet") ||
      result.answerSummary.includes("Claude 3.5 Sonnet"),
  );
  assert.equal(result.groundedness.isGrounded, true);
  assert.ok(result.provenance.length > 0);
});

test("Ask: model-selection routing reaches the deterministic explorer/optimizer", async () => {
  const result = await ask(
    "What is the cheapest active model with at least 500K context and vision?",
  );
  assert.equal(result.interpretedIntent, "model_filter_query");
  assert.equal(result.plan.intent.kind, "model_filter_query");
  if (result.plan.intent.kind === "model_filter_query") {
    assert.equal(result.plan.intent.constraints.minContextWindow, 500_000);
    assert.equal(result.plan.intent.constraints.visionRequired, true);
    assert.equal(result.plan.intent.constraints.activeOnly, true);
  }
  assert.equal(result.structured.kind, "model_filter_query");
  if (result.structured.kind === "model_filter_query") {
    assert.equal(result.structured.unitPriceComparison, true);
    assert.equal(result.structured.optimizer?.request.minContextWindow, 500_000);
    assert.equal(result.structured.optimizer?.request.visionRequired, true);
    assert.equal(result.structured.optimizer?.winner?.canonicalModelId, GEMINI_25_FLASH.id);
  }
  assert.ok(result.answerSummary.includes("Gemini 2.5 Flash"));
  assert.equal(result.groundedness.isGrounded, true);
});

test("Ask: parsed vision+tools+context constraints reach the executor", async () => {
  const result = await ask("Which models support vision + tools with >=128K context?");
  assert.equal(result.interpretedIntent, "model_filter_query");
  if (result.structured.kind !== "model_filter_query" || !result.structured.optimizer) {
    assert.fail("expected a model filter result");
  }
  const ids = result.structured.optimizer.ranked.map((row) => row.canonicalModelId).sort();
  assert.deepEqual(ids.sort(), [GPT_5.id, GEMINI_25_FLASH.id].sort());
  assert.ok(!ids.includes(CLAUDE_SONNET_5.id), "null vision fails closed");
  assert.equal(result.structured.optimizer.request.visionRequired, true);
  assert.equal(result.structured.optimizer.request.toolCallingRequired, true);
  assert.equal(result.structured.optimizer.request.minContextWindow, 128_000);
});

test("Ask: optimizer routing uses deterministic price math for 100M/20M", async () => {
  const result = await ask("What is cheapest for 100M input and 20M output tokens?");
  assert.equal(result.interpretedIntent, "workload_optimizer_query");
  if (result.structured.kind !== "workload_optimizer_query") {
    assert.fail("expected an optimizer result");
  }
  assert.equal(result.structured.optimizer.winner?.canonicalModelId, GEMINI_25_FLASH_PREVIEW.id);
  assert.equal(result.structured.optimizer.winner?.cost.totalMonthlyCost, 27);
  assert.ok(result.calculations.length > 0);
  assert.ok(result.calculations[0]?.expression?.includes("/ 1000000"));
  assert.equal(result.groundedness.isGrounded, true);
  assert.ok(result.provenance.length > 0);
});

test("Ask: comparison routing returns one choice per named provider", async () => {
  const result = await ask(
    "Compare the cheapest eligible OpenAI, Anthropic and Gemini choices for 100M input and 20M output tokens.",
  );
  assert.equal(result.interpretedIntent, "comparison_query");
  if (result.structured.kind !== "comparison_query") {
    assert.fail("expected a comparison result");
  }
  const byProvider = Object.fromEntries(
    result.structured.choices.map((choice) => [choice.provider, choice.choice?.canonicalModelId ?? null]),
  );
  assert.equal(byProvider.openai, GPT_5.id);
  assert.equal(byProvider.anthropic, CLAUDE_SONNET_5.id);
  assert.equal(byProvider.google, GEMINI_25_FLASH_PREVIEW.id);
  assert.ok(result.answerSummary.includes("GPT-5"));
  assert.ok(result.answerSummary.includes("Claude Sonnet 5"));
  assert.ok(result.answerSummary.includes("Gemini 2.5 Flash Preview"));
});

test("Ask: provider constraints from the question reach the optimizer", async () => {
  const result = await ask("What is cheapest OpenAI model for 100M input and 20M output tokens?");
  assert.equal(result.interpretedIntent, "workload_optimizer_query");
  if (result.structured.kind !== "workload_optimizer_query") {
    assert.fail("expected an optimizer result");
  }
  assert.deepEqual(result.structured.optimizer.request.providers, ["openai"]);
  assert.equal(result.structured.optimizer.winner?.canonicalModelId, GPT_5.id);
});

test("Ask: unsupported questions do not fall back to model memory", async () => {
  const result = await ask("Who is the CEO of OpenAI?");
  assert.equal(result.interpretedIntent, "unsupported");
  assert.equal(result.structured.kind, "unsupported");
  assert.equal(result.provenance.length, 0);
  assert.equal(result.calculations.length, 0);
  const text = result.answerSummary.toLowerCase();
  assert.ok(!text.includes("sam altman"));
  assert.ok(!text.includes("dario"));
  assert.ok(text.includes("evidence") || text.includes("collected"));
});

test("Ask: groundedness rejects a summary that invents a price", async () => {
  const result = await ask("What is cheapest for 100M input and 20M output tokens?");
  assert.equal(result.groundedness.isGrounded, true);
  assert.ok(!result.answerSummary.includes("$88.88"));
  assert.ok(result.answerSummary.includes("$27.00"));
});

test("Ask: the answer changes when the DB fixture changes", async () => {
  const baseline = await ask(
    "What is cheapest for 100M input and 20M output tokens?",
  );
  if (baseline.structured.kind !== "workload_optimizer_query") {
    assert.fail("expected an optimizer result");
  }
  assert.equal(baseline.structured.optimizer.winner?.canonicalModelId, GEMINI_25_FLASH_PREVIEW.id);

  const mutated = explorerData();
  mutated.pricingSnapshots = mutated.pricingSnapshots.map((row) =>
    row.model_id === GEMINI_25_FLASH_PREVIEW.id
      ? { ...row, input_price_per_1m_tokens: 80, output_price_per_1m_tokens: 80 }
      : row,
  );

  const updated = await ask(
    "What is cheapest for 100M input and 20M output tokens?",
    mutated,
  );
  if (updated.structured.kind !== "workload_optimizer_query") {
    assert.fail("expected an optimizer result");
  }
  assert.equal(updated.structured.optimizer.winner?.canonicalModelId, GEMINI_25_FLASH.id);
  assert.notEqual(
    updated.structured.optimizer.winner?.canonicalModelId,
    baseline.structured.optimizer.winner?.canonicalModelId,
  );
});

test("Ask: parsed constraints are the same object the executor runs", async () => {
  const question = "What is the cheapest active model with at least 500K context and vision?";
  const plan = planQuery(question);
  const result = await ask(question);
  assert.deepEqual(result.plan.intent, plan.intent);
  assert.equal(result.interpreter, plan.interpreter);
  if (result.structured.kind !== "model_filter_query" || !result.structured.optimizer) {
    assert.fail("expected a model filter result");
  }
  if (plan.intent.kind !== "model_filter_query") {
    assert.fail("expected a filter plan");
  }
  assert.equal(
    result.structured.optimizer.request.minContextWindow,
    plan.intent.constraints.minContextWindow,
  );
  assert.equal(
    result.structured.optimizer.request.visionRequired,
    plan.intent.constraints.visionRequired,
  );
  assert.equal(
    result.structured.optimizer.request.activeOnly,
    plan.intent.constraints.activeOnly,
  );
});
