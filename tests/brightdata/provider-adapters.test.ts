import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptAnthropicPricingRecord,
  adaptGeminiPricingRecord,
  adaptXaiPricingRecord,
} from "../../lib/brightdata";
import {
  normalizeBrightDataPricingRecord,
  pricingRecordIdentity,
  RawBrightDataPricingRecordSchema,
} from "../../lib/contracts";

test("Anthropic adapter normalizes units, annotations, cache writes, and transport metadata", () => {
  const normalized = normalizeBrightDataPricingRecord(adaptAnthropicPricingRecord({
    provider: "Anthropic", model_name: "Claude Sonnet 5 ( retired in source text )",
    pricing_mode: "standard", context_tier: "standard", input_price_per_1m_tokens: 2,
    cached_input_price_per_1m_tokens: 0.2, cache_write_price_per_1m_tokens: 2.5,
    output_price_per_1m_tokens: 10, pricing_unit: "per_1m_tokens",
    input: { url: "https://transport.example" },
  }, "https://platform.claude.com/docs/en/about-claude/pricing"));

  assert.equal(normalized.modelName, "Claude Sonnet 5");
  assert.equal(normalized.pricingUnit, "USD per 1M tokens");
  assert.equal(normalized.cacheWritePricePer1MTokens, 2.5);
  assert.equal("input" in normalized, false);
});

test("Gemini preserves standard, short, and long pricing identities", () => {
  const sourceUrl = "https://ai.google.dev/gemini-api/docs/pricing";
  const records = ["standard", "short", "long"].map((context_tier) => normalizeBrightDataPricingRecord(
    adaptGeminiPricingRecord({
      provider: "Google", model_name: "Gemini 2.5 Pro", pricing_mode: "standard", context_tier,
      input_price_per_1m_tokens: 1.25, cached_input_price_per_1m_tokens: 0.125,
      cache_write_price_per_1m_tokens: null, output_price_per_1m_tokens: 10,
      pricing_unit: "USD per 1M tokens",
    }, sourceUrl),
  ));
  assert.equal(new Set(records.map(pricingRecordIdentity)).size, 3);
  assert(records.every((record) => record.cacheWritePricePer1MTokens === null));
});

test("xAI preserves context tiers and normalizes absent cache writes to null", () => {
  const sourceUrl = "https://docs.x.ai/developers/pricing";
  const records = ["short", "long"].map((context_tier) => normalizeBrightDataPricingRecord(
    adaptXaiPricingRecord({
      provider: "xAI", model_name: "grok-4.6", pricing_mode: "standard", context_tier,
      input_price_per_1m_tokens: 2, cached_input_price_per_1m_tokens: 0.5,
      output_price_per_1m_tokens: 6, pricing_unit: "USD per 1M tokens", input: { url: sourceUrl },
    }, sourceUrl),
  ));
  assert.equal(new Set(records.map(pricingRecordIdentity)).size, 2);
  assert(records.every((record) => record.cacheWritePricePer1MTokens === null));
  assert(records.every((record) => !("input" in record)));
});

test("provider adapters do not repair malformed collector prices", () => {
  const malformed = adaptGeminiPricingRecord({
    provider: "Google", model_name: "Gemini", pricing_mode: "standard", context_tier: "short",
    input_price_per_1m_tokens: -1, output_price_per_1m_tokens: 1,
  }, "https://ai.google.dev/gemini-api/docs/pricing");
  assert.equal(RawBrightDataPricingRecordSchema.safeParse(malformed).success, false);
});
