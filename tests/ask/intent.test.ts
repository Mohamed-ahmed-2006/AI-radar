import test from "node:test";
import assert from "node:assert/strict";

import { planQuery } from "../../lib/ask";

test("Planner: temporal questions compile to temporal_change_query", () => {
  const claude = planQuery("What changed in Claude this month?");
  assert.equal(claude.intent.kind, "temporal_change_query");
  if (claude.intent.kind === "temporal_change_query") {
    assert.equal(claude.intent.provider, "anthropic");
    assert.equal(claude.intent.family, "claude");
    assert.equal(claude.intent.range, "30d");
  }

  const week = planQuery("What important AI model changes happened this week?");
  assert.equal(week.intent.kind, "temporal_change_query");
  if (week.intent.kind === "temporal_change_query") {
    assert.equal(week.intent.range, "7d");
  }

  const pricing = planQuery("Did Anthropic pricing change recently?");
  assert.equal(pricing.intent.kind, "temporal_change_query");
  if (pricing.intent.kind === "temporal_change_query") {
    assert.equal(pricing.intent.provider, "anthropic");
    assert.ok(pricing.intent.categories.includes("pricing"));
  }

  const deprecated = planQuery("Which models were deprecated this month?");
  assert.equal(deprecated.intent.kind, "temporal_change_query");
  if (deprecated.intent.kind === "temporal_change_query") {
    assert.ok(deprecated.intent.categories.includes("deprecations"));
    assert.equal(deprecated.intent.range, "30d");
  }
});

test("Planner: model-selection questions compile to model_filter_query", () => {
  const cheapest = planQuery(
    "What is the cheapest active model with at least 500K context and vision?",
  );
  assert.equal(cheapest.intent.kind, "model_filter_query");
  if (cheapest.intent.kind === "model_filter_query") {
    assert.equal(cheapest.intent.superlative, "cheapest_unit_price");
    assert.equal(cheapest.intent.constraints.minContextWindow, 500_000);
    assert.equal(cheapest.intent.constraints.visionRequired, true);
    assert.equal(cheapest.intent.constraints.activeOnly, true);
  }

  const list = planQuery("Which models support vision + tools with >=128K context?");
  assert.equal(list.intent.kind, "model_filter_query");
  if (list.intent.kind === "model_filter_query") {
    assert.equal(list.intent.superlative, null);
    assert.equal(list.intent.constraints.visionRequired, true);
    assert.equal(list.intent.constraints.toolCallingRequired, true);
    assert.equal(list.intent.constraints.minContextWindow, 128_000);
  }
});

test("Planner: a stated workload compiles to workload_optimizer_query", () => {
  const plan = planQuery("What is cheapest for 100M input and 20M output tokens?");
  assert.equal(plan.intent.kind, "workload_optimizer_query");
  if (plan.intent.kind === "workload_optimizer_query") {
    assert.equal(plan.intent.workload.monthlyInputTokens, 100_000_000);
    assert.equal(plan.intent.workload.monthlyOutputTokens, 20_000_000);
    assert.equal(plan.intent.priority, "lowest_total_cost");
  }

  const input = plan.constraints.find((row) => row.field === "monthlyInputTokens");
  const output = plan.constraints.find((row) => row.field === "monthlyOutputTokens");
  assert.equal(input?.source, "question");
  assert.equal(output?.source, "question");
});

test("Planner: named providers plus compare compile to comparison_query", () => {
  const withVolume = planQuery(
    "Compare the cheapest eligible OpenAI, Anthropic and Gemini choices for 100M input and 20M output tokens.",
  );
  assert.equal(withVolume.intent.kind, "comparison_query");
  if (withVolume.intent.kind === "comparison_query") {
    assert.deepEqual(withVolume.intent.compareProviders, ["openai", "anthropic", "google"]);
    assert.equal(withVolume.intent.workload.monthlyInputTokens, 100_000_000);
    assert.equal(withVolume.intent.workload.monthlyOutputTokens, 20_000_000);
  }

  const unit = planQuery("Compare the cheapest eligible OpenAI, Anthropic and Gemini choices.");
  assert.equal(unit.intent.kind, "comparison_query");
  if (unit.intent.kind === "comparison_query") {
    assert.deepEqual(unit.intent.compareProviders, ["openai", "anthropic", "google"]);
    assert.equal(unit.intent.workload.monthlyInputTokens, 1_000_000);
    assert.equal(unit.intent.workload.monthlyOutputTokens, 1_000_000);
    assert.ok(unit.constraints.some((row) => row.field === "monthlyInputTokens" && row.source === "default"));
  }
});

test("Planner: provider constraints are a closed alias table, not free text", () => {
  const plan = planQuery("Which OpenAI models support vision?");
  assert.equal(plan.intent.kind, "model_filter_query");
  if (plan.intent.kind === "model_filter_query") {
    assert.deepEqual(plan.intent.constraints.providers, ["openai"]);
    assert.equal(plan.intent.constraints.visionRequired, true);
  }
});

test("Planner: unsupported questions stay unsupported instead of becoming SQL", () => {
  const plan = planQuery("Who is the CEO of OpenAI?");
  assert.equal(plan.intent.kind, "unsupported");
  if (plan.intent.kind === "unsupported") {
    assert.equal(plan.intent.reason, "no_recognized_intent");
  }
  assert.ok(!JSON.stringify(plan).toLowerCase().includes("select "));
});
