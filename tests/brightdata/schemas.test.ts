import test from "node:test";
import assert from "node:assert/strict";
import {
  OpenAIPricingRecordSchema,
  parseOpenAIPricingRecord,
  parseOpenAIPricingRecords,
  BrightDataParseError,
} from "../../lib/brightdata";
import fixtureData from "./fixtures/openai-pricing-fixture.json" with { type: "json" };

test("OpenAIPricingRecordSchema validates verified collector output fixture", () => {
  const single = OpenAIPricingRecordSchema.parse(fixtureData[0]);
  assert.equal(single.provider, "OpenAI");
  assert.equal(single.model_name, "gpt-5.6-sol");

  const parsed = parseOpenAIPricingRecords(fixtureData);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].provider, "OpenAI");
  assert.equal(parsed[0].model_name, "gpt-5.6-sol");
  assert.equal(parsed[0].input_price_per_1m_tokens, 5);
  assert.equal(parsed[0].cached_input_price_per_1m_tokens, 0.5);
  assert.equal(parsed[0].cache_write_price_per_1m_tokens, 6.25);
  assert.equal(parsed[0].output_price_per_1m_tokens, 30);
  assert.equal(parsed[0].pricing_unit, "USD per 1M tokens");
  assert.equal(parsed[0].source_url, "https://developers.openai.com/api/docs/pricing");
});

test("parseOpenAIPricingRecord preserves strict canonical validation", () => {
  const raw = {
    provider: "OpenAI",
    model_name: "gpt-4o",
    input_price_per_1m_tokens: "2.5",
    output_price_per_1m_tokens: "10.0",
    source_url: "https://developers.openai.com/api/docs/pricing",
  };

  assert.throws(() => parseOpenAIPricingRecord(raw), BrightDataParseError);
});

test("parseOpenAIPricingRecord throws BrightDataParseError on missing required fields", () => {
  const invalidRaw = {
    provider: "OpenAI",
    // missing model_name and prices
  };

  assert.throws(
    () => parseOpenAIPricingRecord(invalidRaw),
    (err: unknown) => {
      assert(err instanceof BrightDataParseError);
      assert.match(err.message, /failed schema validation/);
      return true;
    }
  );
});

test("parseOpenAIPricingRecord throws BrightDataParseError on negative prices", () => {
  const invalidRaw = {
    provider: "OpenAI",
    model_name: "test-model",
    input_price_per_1m_tokens: -5,
    output_price_per_1m_tokens: 10,
  };

  assert.throws(
    () => parseOpenAIPricingRecord(invalidRaw),
    (err: unknown) => {
      assert(err instanceof BrightDataParseError);
      return true;
    }
  );
});

test("parseOpenAIPricingRecords throws BrightDataParseError when given non-array", () => {
  assert.throws(
    () => parseOpenAIPricingRecords({ not: "an array" }),
    (err: unknown) => {
      assert(err instanceof BrightDataParseError);
      assert.match(err.message, /Expected an array/);
      return true;
    }
  );
});
