import assert from "node:assert/strict";
import test from "node:test";

import { detectPricingChanges } from "../lib/change-detection/detect-pricing-changes.ts";
import { normalizeBrightDataPricingRecord } from "../lib/contracts/pricing.ts";

const sourceUrl = "https://developers.openai.com/api/docs/pricing";

function pricingRecord(overrides = {}, collection = {}) {
  return normalizeBrightDataPricingRecord(
    {
      provider: "OpenAI",
      model_name: "gpt-5.6-sol",
      pricing_mode: "standard",
      context_tier: "short",
      input_price_per_1m_tokens: 5,
      cached_input_price_per_1m_tokens: 0.5,
      cache_write_price_per_1m_tokens: 6.25,
      output_price_per_1m_tokens: 30,
      pricing_unit: "USD per 1M tokens",
      source_url: sourceUrl,
      ...overrides,
    },
    collection,
  );
}

test("reports exact price increase and decrease fields", () => {
  const previous = pricingRecord();
  const current = pricingRecord({
    input_price_per_1m_tokens: 6,
    output_price_per_1m_tokens: 25,
  });

  assert.deepEqual(detectPricingChanges([previous], [current]), [
    {
      type: "price_decreased",
      provider: "OpenAI",
      modelName: "gpt-5.6-sol",
      pricingMode: "standard",
      contextTier: "short",
      field: "outputPricePer1MTokens",
      oldValue: 30,
      newValue: 25,
      source: { previous: sourceUrl, current: sourceUrl },
    },
    {
      type: "price_increased",
      provider: "OpenAI",
      modelName: "gpt-5.6-sol",
      pricingMode: "standard",
      contextTier: "short",
      field: "inputPricePer1MTokens",
      oldValue: 5,
      newValue: 6,
      source: { previous: sourceUrl, current: sourceUrl },
    },
  ]);
});

test("returns no events for unchanged semantic data", () => {
  const previous = pricingRecord({}, { collectedAt: "2026-08-17T08:00:00Z" });
  const current = pricingRecord({}, { collectedAt: "2026-08-17T09:00:00Z" });

  assert.deepEqual(detectPricingChanges([previous], [current]), []);
});

test("reports a newly added model or context tier", () => {
  const existing = pricingRecord();
  const longTier = pricingRecord({ context_tier: "long" });

  const events = detectPricingChanges([existing], [longTier, existing]);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "model_added");
  assert.equal(events[0].contextTier, "long");
  assert.equal(events[0].source.current, sourceUrl);
  assert.deepEqual(events[0].record, longTier);
});

test("emits one model_added event when a new model has short and long tiers", () => {
  const short = pricingRecord({ model_name: "gpt-new", context_tier: "short" });
  const long = pricingRecord({ model_name: "gpt-new", context_tier: "long" });
  const events = detectPricingChanges([], [short, long]);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "model_added");
  assert.equal(events[0].modelName, "gpt-new");
});

test("reports a removed model or context tier", () => {
  const existing = pricingRecord();
  const longTier = pricingRecord({ context_tier: "long" });

  const events = detectPricingChanges([existing, longTier], [existing]);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "model_removed");
  assert.equal(events[0].contextTier, "long");
  assert.equal(events[0].source.previous, sourceUrl);
  assert.deepEqual(events[0].record, longTier);
});

test("reports null price transitions and source changes as metadata", () => {
  const previous = pricingRecord({
    cached_input_price_per_1m_tokens: null,
  });
  const newSource = "https://example.ai/pricing";
  const current = pricingRecord({
    cached_input_price_per_1m_tokens: 0.25,
    source_url: newSource,
  });

  assert.deepEqual(detectPricingChanges([previous], [current]), [
    {
      type: "metadata_changed",
      provider: "OpenAI",
      modelName: "gpt-5.6-sol",
      pricingMode: "standard",
      contextTier: "short",
      field: "cachedInputPricePer1MTokens",
      oldValue: null,
      newValue: 0.25,
      source: { previous: sourceUrl, current: newSource },
    },
    {
      type: "metadata_changed",
      provider: "OpenAI",
      modelName: "gpt-5.6-sol",
      pricingMode: "standard",
      contextTier: "short",
      field: "sourceUrl",
      oldValue: sourceUrl,
      newValue: newSource,
      source: { previous: sourceUrl, current: newSource },
    },
  ]);
});

test("is deterministic regardless of snapshot input ordering", () => {
  const first = pricingRecord({ model_name: "gpt-a" });
  const second = pricingRecord({ model_name: "gpt-b" });

  const forward = detectPricingChanges([], [first, second]);
  const reversed = detectPricingChanges([], [second, first]);

  assert.deepEqual(forward, reversed);
});

test("rejects snapshots with duplicate provider/model/mode/tier identity", () => {
  const record = pricingRecord();

  assert.throws(() => detectPricingChanges([record, record], []));
});
