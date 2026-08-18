import test from "node:test";
import assert from "node:assert/strict";
import {
  createPricingSourceHealthContract,
  createAnthropicLifecycleSourceHealthContract,
  evaluateSourceHealth,
} from "../../lib/sentinel";

test("Sentinel Evaluator: healthy run passes cleanly with 100% valid records", () => {
  const contract = createPricingSourceHealthContract("openai");
  const rawRecords = [
    {
      provider: "OpenAI",
      model_name: "gpt-4o",
      pricing_mode: "standard",
      context_tier: "default",
      input_price_per_1m_tokens: 2.5,
      cached_input_price_per_1m_tokens: 1.25,
      cache_write_price_per_1m_tokens: null,
      output_price_per_1m_tokens: 10.0,
      pricing_unit: "USD per 1M tokens",
      source_url: "https://developers.openai.com/api/docs/pricing",
    },
    {
      provider: "OpenAI",
      model_name: "gpt-4o-mini",
      pricing_mode: "standard",
      context_tier: "default",
      input_price_per_1m_tokens: 0.15,
      cached_input_price_per_1m_tokens: 0.075,
      cache_write_price_per_1m_tokens: null,
      output_price_per_1m_tokens: 0.6,
      pricing_unit: "USD per 1M tokens",
      source_url: "https://developers.openai.com/api/docs/pricing",
    },
  ];

  const result = evaluateSourceHealth(rawRecords, contract);

  assert.equal(result.isHealthy, true);
  assert.equal(result.shouldQuarantine, false);
  assert.equal(result.status, "healthy");
  assert.equal(result.recordsSeen, 2);
  assert.equal(result.recordsValid, 2);
  assert.equal(result.recordsInvalid, 0);
  assert.equal(result.reasonCodes.length, 0);
});

test("Sentinel Evaluator: malformed enum value triggers ILLEGAL_ENUM_VALUE and quarantine", () => {
  const contract = createAnthropicLifecycleSourceHealthContract();
  const rawRecords = [
    {
      product_page_url: "https://platform.claude.com/docs/en/about-claude/pricing",
      api_model_name: "claude-3-5-sonnet-20241022",
      current_state: "INVALID_STATE_VALUE", // Illegal enum
    },
    {
      product_page_url: "https://platform.claude.com/docs/en/about-claude/pricing",
      api_model_name: "claude-3-opus-20240229",
      current_state: "Active",
    },
  ];

  const result = evaluateSourceHealth(rawRecords, contract);

  assert.equal(result.shouldQuarantine, true);
  assert.equal(result.status, "quarantined");
  assert.ok(result.reasonCodes.includes("ILLEGAL_ENUM_VALUE") || result.reasonCodes.includes("SCHEMA_VALIDATION_FAILURE"));
  assert.equal(result.recordsInvalid, 1);
  assert.equal(result.recordsValid, 1);
});

test("Sentinel Evaluator: record-count collapse (>40% drop vs LKG baseline) triggers RECORD_COUNT_COLLAPSE", () => {
  const contract = createPricingSourceHealthContract("openai");
  const baseline = {
    runId: "prev-run-123",
    recordCount: 10,
    observedAt: new Date(Date.now() - 3600_000).toISOString(),
  };

  // Only 3 records returned (70% collapse)
  const rawRecords = [
    {
      provider: "OpenAI",
      model_name: "gpt-4o",
      pricing_mode: "standard",
      context_tier: "default",
      input_price_per_1m_tokens: 2.5,
      output_price_per_1m_tokens: 10.0,
      pricing_unit: "USD per 1M tokens",
      source_url: "https://developers.openai.com/api/docs/pricing",
    },
    {
      provider: "OpenAI",
      model_name: "gpt-4o-mini",
      pricing_mode: "standard",
      context_tier: "default",
      input_price_per_1m_tokens: 0.15,
      output_price_per_1m_tokens: 0.6,
      pricing_unit: "USD per 1M tokens",
      source_url: "https://developers.openai.com/api/docs/pricing",
    },
    {
      provider: "OpenAI",
      model_name: "o1",
      pricing_mode: "standard",
      context_tier: "default",
      input_price_per_1m_tokens: 15.0,
      output_price_per_1m_tokens: 60.0,
      pricing_unit: "USD per 1M tokens",
      source_url: "https://developers.openai.com/api/docs/pricing",
    },
  ];

  const result = evaluateSourceHealth(rawRecords, contract, baseline);

  assert.equal(result.shouldQuarantine, true);
  assert.equal(result.status, "quarantined");
  assert.ok(result.reasonCodes.includes("RECORD_COUNT_COLLAPSE"));
  assert.equal(result.driftInfo?.driftType, "collapse");
});

test("Sentinel Evaluator: duplicate record identities trigger DUPLICATE_IDENTIFIERS", () => {
  const contract = createPricingSourceHealthContract("openai");
  const rawRecords = [
    {
      provider: "OpenAI",
      model_name: "gpt-4o",
      pricing_mode: "standard",
      context_tier: "default",
      input_price_per_1m_tokens: 2.5,
      output_price_per_1m_tokens: 10.0,
      pricing_unit: "USD per 1M tokens",
      source_url: "https://developers.openai.com/api/docs/pricing",
    },
    {
      provider: "OpenAI",
      model_name: "gpt-4o", // Duplicate identity
      pricing_mode: "standard",
      context_tier: "default",
      input_price_per_1m_tokens: 3.0,
      output_price_per_1m_tokens: 12.0,
      pricing_unit: "USD per 1M tokens",
      source_url: "https://developers.openai.com/api/docs/pricing",
    },
  ];

  const result = evaluateSourceHealth(rawRecords, contract);

  assert.ok(result.reasonCodes.includes("DUPLICATE_IDENTIFIERS"));
  assert.equal(result.recordsValid, 1);
  assert.equal(result.recordsInvalid, 1);
});

test("Sentinel Evaluator: zero records triggers ZERO_RECORDS and quarantine", () => {
  const contract = createPricingSourceHealthContract("anthropic");
  const result = evaluateSourceHealth([], contract);

  assert.equal(result.shouldQuarantine, true);
  assert.equal(result.status, "quarantined");
  assert.ok(result.reasonCodes.includes("ZERO_RECORDS"));
});

test("Sentinel Evaluator: all prices null triggers ALL_PRICES_NULL semantic invariant", () => {
  const contract = createPricingSourceHealthContract("openai");
  const rawRecords = [
    {
      provider: "OpenAI",
      model_name: "gpt-4o",
      pricing_mode: "standard",
      context_tier: "default",
      input_price_per_1m_tokens: null,
      cached_input_price_per_1m_tokens: null,
      cache_write_price_per_1m_tokens: null,
      output_price_per_1m_tokens: null,
      pricing_unit: "USD per 1M tokens",
      source_url: "https://developers.openai.com/api/docs/pricing",
    },
  ];

  const result = evaluateSourceHealth(rawRecords, contract);

  assert.equal(result.shouldQuarantine, true);
  assert.ok(result.reasonCodes.includes("ALL_PRICES_NULL") || result.reasonCodes.includes("SCHEMA_VALIDATION_FAILURE"));
});

test("Sentinel Evaluator: repeated identical healthy runs are idempotent with zero incidents", () => {
  const contract = createPricingSourceHealthContract("openai");
  const record = {
    provider: "OpenAI",
    model_name: "gpt-4o",
    pricing_mode: "standard",
    context_tier: "default",
    input_price_per_1m_tokens: 2.5,
    output_price_per_1m_tokens: 10.0,
    pricing_unit: "USD per 1M tokens",
    source_url: "https://developers.openai.com/api/docs/pricing",
  };

  const baseline = {
    runId: "prev-1",
    recordCount: 1,
    observedAt: new Date().toISOString(),
  };

  const result1 = evaluateSourceHealth([record], contract, baseline);
  const result2 = evaluateSourceHealth([record], contract, baseline);

  assert.equal(result1.status, "healthy");
  assert.equal(result2.status, "healthy");
  assert.equal(result1.reasonCodes.length, 0);
  assert.equal(result2.reasonCodes.length, 0);
});
