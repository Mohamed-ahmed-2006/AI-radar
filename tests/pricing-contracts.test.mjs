import assert from "node:assert/strict";
import test from "node:test";

import { ZodError } from "zod";

import {
  normalizeBrightDataPricingRecord,
  RawBrightDataPricingRecordSchema,
} from "../lib/contracts/pricing.ts";

const knownOpenAiRecord = {
  input: {},
  provider: "OpenAI",
  model_name: "gpt-5.6-sol",
  pricing_mode: "standard",
  context_tier: "short",
  input_price_per_1m_tokens: 5,
  cached_input_price_per_1m_tokens: 0.5,
  cache_write_price_per_1m_tokens: 6.25,
  output_price_per_1m_tokens: 30,
  pricing_unit: "USD per 1M tokens",
  source_url: "https://developers.openai.com/api/docs/pricing",
};

test("normalizes the verified OpenAI Bright Data record", () => {
  const normalized = normalizeBrightDataPricingRecord(knownOpenAiRecord, {
    collectorId: "c_msx3bqlyjtv2qustx",
    collectedAt: "2026-08-17T09:30:00+02:00",
  });

  assert.deepEqual(normalized, {
    provider: "OpenAI",
    modelName: "gpt-5.6-sol",
    pricingMode: "standard",
    contextTier: "short",
    inputPricePer1MTokens: 5,
    cachedInputPricePer1MTokens: 0.5,
    cacheWritePricePer1MTokens: 6.25,
    outputPricePer1MTokens: 30,
    pricingUnit: "USD per 1M tokens",
    provenance: {
      sourceUrl: "https://developers.openai.com/api/docs/pricing",
      collectorId: "c_msx3bqlyjtv2qustx",
      collectedAt: "2026-08-17T09:30:00+02:00",
    },
  });
  assert.equal("input" in normalized, false);
});

test("normalizes missing and explicit-null optional prices to null", () => {
  const normalized = normalizeBrightDataPricingRecord({
    ...knownOpenAiRecord,
    cached_input_price_per_1m_tokens: null,
    cache_write_price_per_1m_tokens: undefined,
  });

  assert.equal(normalized.cachedInputPricePer1MTokens, null);
  assert.equal(normalized.cacheWritePricePer1MTokens, null);
  assert.equal(normalized.provenance.collectorId, null);
  assert.equal(normalized.provenance.collectedAt, null);
});

test("rejects malformed identifiers, URLs, and prices without coercion", () => {
  const invalidRecords = [
    { ...knownOpenAiRecord, provider: " OpenAI" },
    { ...knownOpenAiRecord, model_name: "gpt@model" },
    { ...knownOpenAiRecord, pricing_mode: "Standard" },
    { ...knownOpenAiRecord, context_tier: "short tier" },
    { ...knownOpenAiRecord, source_url: "javascript:alert(1)" },
    { ...knownOpenAiRecord, input_price_per_1m_tokens: "5" },
    { ...knownOpenAiRecord, input_price_per_1m_tokens: Number.NaN },
    { ...knownOpenAiRecord, input_price_per_1m_tokens: -1 },
  ];

  for (const record of invalidRecords) {
    assert.throws(
      () => normalizeBrightDataPricingRecord(record),
      ZodError,
    );
  }
});

test("accepts transport metadata without making it canonical pricing data", () => {
  const parsed = RawBrightDataPricingRecordSchema.parse({
    ...knownOpenAiRecord,
    input: { run_id: "transport-only" },
  });
  const normalized = normalizeBrightDataPricingRecord(parsed);

  assert.deepEqual(parsed.input, { run_id: "transport-only" });
  assert.equal("input" in normalized, false);
});
