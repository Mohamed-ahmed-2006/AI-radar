import test from "node:test";
import assert from "node:assert/strict";

import { InMemoryModelExplorerReadPort } from "../../lib/explorer";
import {
  CANONICAL_OPTIMIZER_ADAPTER_ID,
  createCanonicalOptimizerAdapter,
  DEFAULT_OPTIMIZER_INPUT,
  getOptimizerAdapter,
  FIXTURE_OPTIMIZER_ADAPTER_ID,
} from "../../lib/product";
import {
  GEMINI_25_FLASH,
  GEMINI_25_FLASH_PREVIEW,
  GPT_5,
  GROK_4,
  explorerData,
  now,
} from "../explorer/support/fixtures";

function adapter() {
  return createCanonicalOptimizerAdapter({
    port: new InMemoryModelExplorerReadPort(explorerData()),
    now,
    configured: true,
  });
}

test("canonical optimizer adapter is the installed default, not the fixture", () => {
  assert.equal(getOptimizerAdapter().id, CANONICAL_OPTIMIZER_ADAPTER_ID);
  assert.notEqual(getOptimizerAdapter().id, FIXTURE_OPTIMIZER_ADAPTER_ID);
});

test("canonical optimizer ranks from trusted evidence and does not use fixtures", async () => {
  const result = await adapter().optimize({
    ...DEFAULT_OPTIMIZER_INPUT,
    monthlyInputTokens: 100_000_000,
    monthlyOutputTokens: 20_000_000,
    minContext: null,
    visionRequired: false,
    toolCallingRequired: false,
    providers: [],
    activeOnly: false,
    priority: "lowest_monthly_cost",
  });

  assert.equal(result.isDemo, false);
  assert.equal(result.bestFit?.identity.modelId, GEMINI_25_FLASH_PREVIEW.id);
  assert.equal(result.bestFit?.estimatedMonthlyCost, 27);
  assert.equal(result.bestFit?.rank, 1);
  assert.ok(result.ranked.every((row) => row.eligibility === "eligible"));
  assert.ok(result.other.some((row) => row.identity.modelId === GROK_4.id && row.eligibility === "unavailable_pricing"));
});

test("canonical optimizer fails closed on unknown vision and does not rank missing prices", async () => {
  const result = await adapter().optimize({
    ...DEFAULT_OPTIMIZER_INPUT,
    monthlyInputTokens: 100_000_000,
    monthlyOutputTokens: 20_000_000,
    minContext: 128_000,
    visionRequired: true,
    toolCallingRequired: true,
    activeOnly: true,
    priority: "lowest_monthly_cost",
  });

  assert.deepEqual(
    result.ranked.map((row) => row.identity.modelId),
    [GEMINI_25_FLASH.id, GPT_5.id],
  );
  assert.ok(result.other.some((row) => row.eligibility === "unknown_evidence"));
  assert.ok(!result.ranked.some((row) => row.identity.modelId === GROK_4.id));
});

test("unconfigured optimizer returns empty evidence, not a fixture ranking", async () => {
  const result = await createCanonicalOptimizerAdapter({ configured: false, now }).optimize(
    DEFAULT_OPTIMIZER_INPUT,
  );
  assert.equal(result.bestFit, null);
  assert.equal(result.ranked.length, 0);
  assert.equal(result.isDemo, false);
  assert.match(result.emptyReason ?? "", /not configured/i);
});
