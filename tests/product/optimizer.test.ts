import test from "node:test";
import assert from "node:assert/strict";

import {
  appliedConstraintsFromInput,
  compareEligibleHref,
  DEFAULT_OPTIMIZER_INPUT,
  getOptimizerAdapter,
  optimizerEligibilityLabel,
  optimizerHref,
  optimizerInputFromParams,
  optimizerInputWithDefaults,
  optimizerSearchParams,
  setOptimizerAdapter,
  toggleOptimizerProvider,
  type OptimizerAdapter,
  type OptimizerInput,
} from "../../lib/product/optimizer";
import {
  createFixtureOptimizerAdapter,
  fixtureOptimizerModels,
  FIXTURE_OPTIMIZER_ADAPTER_ID,
} from "../../lib/product/optimizer-fixture";
import { observedBoolean } from "../../lib/product/explorer";

test("optimizer input round-trips through URL search params", () => {
  const input: OptimizerInput = {
    monthlyInputTokens: 20_000_000,
    monthlyOutputTokens: 2_000_000,
    minContext: 500_000,
    minMaxOutput: 8192,
    visionRequired: true,
    toolCallingRequired: true,
    providers: ["anthropic", "openai"],
    activeOnly: true,
    priority: "highest_context",
  };

  const params = optimizerSearchParams(input);
  assert.equal(params.get("inTokens"), "20000000");
  assert.equal(params.get("outTokens"), "2000000");
  assert.equal(params.get("minContext"), "500000");
  assert.equal(params.get("minMaxOutput"), "8192");
  assert.equal(params.get("vision"), "1");
  assert.equal(params.get("tools"), "1");
  assert.equal(params.get("providers"), "anthropic,openai");
  assert.equal(params.get("active"), "1");
  assert.equal(params.get("priority"), "highest_context");

  assert.deepEqual(optimizerInputFromParams(params), input);
  assert.match(optimizerHref(input), /^\/optimizer\?/);
});

test("bare optimizer URL keeps default workload, explicit empty numeric fields stay empty", () => {
  const empty = optimizerInputFromParams(new URLSearchParams());
  const withDefaults = optimizerInputWithDefaults(empty, new URLSearchParams());
  assert.equal(withDefaults.monthlyInputTokens, DEFAULT_OPTIMIZER_INPUT.monthlyInputTokens);
  assert.equal(withDefaults.activeOnly, true);

  const explicit = new URLSearchParams("inTokens=0&active=0");
  const parsed = optimizerInputWithDefaults(optimizerInputFromParams(explicit), explicit);
  assert.equal(parsed.monthlyInputTokens, 0);
  assert.equal(parsed.activeOnly, false);
});

test("applied constraints echo presentation state and do not rank", () => {
  const constraints = appliedConstraintsFromInput({
    ...DEFAULT_OPTIMIZER_INPUT,
    visionRequired: true,
    providers: ["google"],
  });
  const labels = constraints.map((item) => item.label);
  assert.ok(labels.includes("Monthly input tokens"));
  assert.ok(labels.includes("Vision"));
  assert.ok(labels.includes("Providers"));
  assert.equal(constraints.find((item) => item.id === "providers")?.value, "Google");
  assert.doesNotMatch(constraints.map((item) => item.value).join(" "), /rank/i);
});

test("toggleOptimizerProvider is presentation-state only", () => {
  let selected: string[] = [];
  selected = toggleOptimizerProvider(selected, "anthropic");
  selected = toggleOptimizerProvider(selected, "OpenAI");
  assert.deepEqual(selected, ["anthropic", "openai"]);
  selected = toggleOptimizerProvider(selected, "anthropic");
  assert.deepEqual(selected, ["openai"]);
});

test("fixture optimizer returns ranked eligible models without UI-side ranking", async () => {
  const adapter = createFixtureOptimizerAdapter();
  const result = await adapter.optimize(DEFAULT_OPTIMIZER_INPUT);

  assert.equal(adapter.id, FIXTURE_OPTIMIZER_ADAPTER_ID);
  assert.ok(result.bestFit);
  assert.equal(result.bestFit?.eligibility, "eligible");
  assert.equal(result.bestFit?.rank, 1);
  assert.ok(result.ranked.length >= 2);
  assert.deepEqual(
    result.ranked.map((model) => model.rank),
    result.ranked.map((_, index) => index + 1),
  );
  assert.equal(result.input.monthlyInputTokens, DEFAULT_OPTIMIZER_INPUT.monthlyInputTokens);
});

test("fixture optimizer distinguishes excluded, unknown evidence and unavailable pricing", async () => {
  const models = fixtureOptimizerModels();
  const byEligibility = Object.fromEntries(models.map((model) => [model.eligibility, model]));

  assert.equal(byEligibility.excluded.eligibilityLabel, optimizerEligibilityLabel("excluded"));
  assert.match(byEligibility.excluded.exclusionReason ?? "", /minimum context/i);

  assert.equal(byEligibility.unknown_evidence.vision.observed, null);
  assert.equal(byEligibility.unknown_evidence.vision.label, "Unknown");
  const visionCheck = byEligibility.unknown_evidence.requirementChecks.find((check) => check.id === "vision");
  assert.equal(visionCheck?.status, "unknown");
  assert.match(visionCheck?.detail ?? "", /not the same as unsupported/i);
  assert.doesNotMatch(visionCheck?.detail ?? "", /unsupported$/i);

  assert.equal(byEligibility.unavailable_pricing.inputPrice, null);
  assert.equal(byEligibility.unavailable_pricing.estimatedMonthlyCost, null);
  assert.equal(byEligibility.unavailable_pricing.estimatedMonthlyCostLabel, "Unavailable");
  const pricingCheck = byEligibility.unavailable_pricing.requirementChecks.find((check) => check.id === "pricing");
  assert.equal(pricingCheck?.status, "unavailable");
});

test("observedBoolean unknown never becomes unsupported in optimizer rows", () => {
  const unknown = observedBoolean(null);
  assert.equal(unknown.label, "Unknown");
  assert.doesNotMatch(unknown.description, /unsupported/i);
});

test("compareEligibleHref only includes eligible canonical ids", () => {
  const href = compareEligibleHref(fixtureOptimizerModels());
  assert.match(href, /\/models\/compare\?ids=/);
  assert.match(href, /anthropic%3Aclaude-sonnet-4-5/);
  assert.doesNotMatch(href, /grok-4/);
  assert.doesNotMatch(href, /o3/);
});

test("setOptimizerAdapter replaces the installed seam without changing call shape", async () => {
  const previous = getOptimizerAdapter();
  const stub: OptimizerAdapter = {
    id: "test-optimizer",
    label: "Test",
    async optimize(input) {
      return {
        input,
        appliedConstraints: appliedConstraintsFromInput(input),
        bestFit: null,
        ranked: [],
        other: [],
        providerOptions: [],
        generatedAt: "2026-08-19T12:00:00.000Z",
        isDemo: false,
        evidenceQuality: "unknown",
        evidenceNote: null,
        emptyReason: "Stub returned no models.",
      };
    },
  };

  setOptimizerAdapter(stub);
  try {
    const result = await getOptimizerAdapter().optimize(DEFAULT_OPTIMIZER_INPUT);
    assert.equal(getOptimizerAdapter().id, "test-optimizer");
    assert.equal(result.emptyReason, "Stub returned no models.");
    assert.equal(result.ranked.length, 0);
  } finally {
    setOptimizerAdapter(previous);
  }
});
