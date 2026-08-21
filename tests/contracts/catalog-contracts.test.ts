import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptAnthropicCatalogRecord,
  adaptGeminiCatalogRecord,
  adaptOpenAiCatalogRecord,
  adaptXaiCatalogRecord,
} from "../../lib/brightdata";
import {
  catalogRecordIdentity,
  normalizeExactTokenCount,
  normalizeModalities,
  NormalizedCatalogRecordSchema,
  RawAnthropicCatalogRecordSchema,
  RawGeminiCatalogRecordSchema,
  RawOpenAiCatalogRecordSchema,
  RawXaiCatalogRecordSchema,
} from "../../lib/contracts";

test("normalizeExactTokenCount only parses exact positive integers", () => {
  assert.equal(normalizeExactTokenCount(128000), 128000);
  assert.equal(normalizeExactTokenCount("128,000"), 128000);
  assert.equal(normalizeExactTokenCount(" 200000 "), 200000);
  assert.equal(normalizeExactTokenCount("1000000"), 1000000);

  // Rejects fuzzy or non-exact strings
  assert.equal(normalizeExactTokenCount("approx 128k"), null);
  assert.equal(normalizeExactTokenCount("up to 2 million"), null);
  assert.equal(normalizeExactTokenCount(-500), null);
  assert.equal(normalizeExactTokenCount(0), null);
  assert.equal(normalizeExactTokenCount(null), null);
  assert.equal(normalizeExactTokenCount(undefined), null);
});

/**
 * Anthropic's comparison table publishes "1M tokens" and "128k tokens" where
 * OpenAI's publishes "128,000". Both are definite figures, and reading only the
 * second is what made every current Claude model report an unobserved context
 * window and max output on its model page.
 */
test("normalizeExactTokenCount reads the shorthand provider tables publish", () => {
  assert.equal(normalizeExactTokenCount("1M tokens "), 1_000_000);
  assert.equal(normalizeExactTokenCount("128k tokens"), 128_000);
  assert.equal(normalizeExactTokenCount("200k tokens "), 200_000);
  assert.equal(normalizeExactTokenCount("64k tokens"), 64_000);
  assert.equal(normalizeExactTokenCount("1M"), 1_000_000);
  assert.equal(normalizeExactTokenCount("200K"), 200_000);
  assert.equal(normalizeExactTokenCount("1.5M tokens"), 1_500_000);
  assert.equal(normalizeExactTokenCount("128000 tokens"), 128_000);
});

/**
 * Shorthand is not a licence to read hedges. A magnitude suffix is accepted
 * only when it is the whole of what the source said.
 */
test("normalizeExactTokenCount still refuses hedged or non-token shorthand", () => {
  assert.equal(normalizeExactTokenCount("~555k words"), null);
  assert.equal(normalizeExactTokenCount("up to 1M tokens"), null);
  assert.equal(normalizeExactTokenCount("about 128k"), null);
  assert.equal(normalizeExactTokenCount("1M-2M tokens"), null);
  assert.equal(normalizeExactTokenCount("2.5M unicode characters"), null);
  assert.equal(normalizeExactTokenCount("1.2345k tokens"), null);
  assert.equal(normalizeExactTokenCount("0k tokens"), null);
});

test("normalizeModalities extracts canonical lowercase modality names", () => {
  assert.deepEqual(normalizeModalities(["TEXT", "IMAGE"]), ["text", "image"]);
  assert.deepEqual(normalizeModalities(["text", "image", "audio", "video"]), [
    "text",
    "image",
    "audio",
    "video",
  ]);
  assert.deepEqual(normalizeModalities("text, image, audio"), [
    "text",
    "image",
    "audio",
  ]);
  assert.deepEqual(normalizeModalities(["unknown_modality", "text"]), ["text"]);
  assert.deepEqual(normalizeModalities(null), []);
});

test("adaptOpenAiCatalogRecord adapts OpenAI records with 3-state boolean semantics", () => {
  const raw = {
    model_id: "gpt-5.6-sol",
    display_name: "GPT-5.6 Sol",
    context_window_raw: "256,000",
    max_output_tokens_raw: 32768,
    supports_vision: true,
    supports_function_calling: true,
    input_modalities: ["text", "image"],
    output_modalities: ["text"],
    supported_features: ["function_calling", "vision"],
  };

  const adapted = adaptOpenAiCatalogRecord(
    raw,
    "https://developers.openai.com/api/docs/models.md",
    "c_openai_test",
    "2026-08-18T10:00:00.000Z",
  );

  assert.equal(adapted.provider, "OpenAI");
  assert.equal(adapted.providerSlug, "openai");
  assert.equal(adapted.apiModelId, "gpt-5.6-sol");
  assert.equal(adapted.displayName, "GPT-5.6 Sol");
  assert.equal(adapted.modelFamily, "GPT-5");
  assert.equal(adapted.modelStage, "ga");
  assert.equal(adapted.contextWindow, 256000);
  assert.equal(adapted.maxOutputTokens, 32768);
  assert.equal(adapted.supportsVision, true);
  assert.equal(adapted.supportsToolCalling, true);
  assert.deepEqual(adapted.inputModalities, ["text", "image"]);
  assert.deepEqual(adapted.outputModalities, ["text"]);

  // Validate that the adapted record satisfies the NormalizedCatalogRecordSchema
  const validated = NormalizedCatalogRecordSchema.parse(adapted);
  assert.equal(catalogRecordIdentity(validated), "openai::gpt-5.6-sol");
});


test("adaptAnthropicCatalogRecord adapts Anthropic records accurately", () => {
  const raw = {
    api_model_id: "claude-sonnet-4-5-20250929",
    display_name: "Claude Sonnet 4.5",
    model_family: "Claude Sonnet",
    context_window_raw: 200000,
    max_output_tokens_raw: 8192,
    supports_vision: true,
    supports_tool_use: true,
    input_modalities: ["text", "image"],
    output_modalities: ["text"],
  };

  const adapted = adaptAnthropicCatalogRecord(
    raw,
    "https://docs.anthropic.com/en/docs/about-claude/models/all-models",
  );

  assert.equal(adapted.provider, "Anthropic");
  assert.equal(adapted.providerSlug, "anthropic");
  assert.equal(adapted.apiModelId, "claude-sonnet-4-5-20250929");
  assert.equal(adapted.contextWindow, 200000);
  assert.equal(adapted.maxOutputTokens, 8192);
  assert.equal(adapted.supportsVision, true);
  assert.equal(adapted.supportsToolCalling, true);
});

test("adaptGeminiCatalogRecord adapts Google Gemini records accurately", () => {
  const raw = {
    model_id: "gemini-2.5-pro",
    display_name: "Gemini 2.5 Pro",
    model_group: "Gemini 2.5",
    context_window_raw: 1000000,
    max_output_tokens_raw: 65536,
    supports_vision: true,
    supports_function_calling: true,
    input_modalities: ["text", "image", "audio", "video"],
    output_modalities: ["text"],
  };

  const adapted = adaptGeminiCatalogRecord(
    raw,
    "https://ai.google.dev/gemini-api/docs/models/gemini",
  );

  assert.equal(adapted.provider, "Google");
  assert.equal(adapted.providerSlug, "gemini");
  assert.equal(adapted.apiModelId, "gemini-2.5-pro");
  assert.equal(adapted.contextWindow, 1000000);
  assert.equal(adapted.maxOutputTokens, 65536);
  assert.equal(adapted.supportsVision, true);
  assert.equal(adapted.supportsToolCalling, true);
  assert.deepEqual(adapted.inputModalities, ["text", "image", "audio", "video"]);
});

test("adaptXaiCatalogRecord adapts xAI records accurately", () => {
  const raw = {
    name: "grok-4.20-0309-reasoning",
    max_prompt_length: 1000000,
    input_modalities: ["text", "image"],
    output_modalities: ["text"],
    features: { functionCalling: true, structuredOutputs: true, reasoning: true },
  };

  const adapted = adaptXaiCatalogRecord(
    raw,
    "https://docs.x.ai/docs/models",
  );

  assert.equal(adapted.provider, "xAI");
  assert.equal(adapted.providerSlug, "xai");
  assert.equal(adapted.apiModelId, "grok-4.20-0309-reasoning");
  assert.equal(adapted.contextWindow, 1000000);
  assert.equal(adapted.maxOutputTokens, null); // xAI doesn't specify max output in this table
  assert.equal(adapted.supportsVision, true);
  assert.equal(adapted.supportsToolCalling, true);
});

test("raw schemas reject empty or malformed model identifiers", () => {
  assert.throws(() => RawOpenAiCatalogRecordSchema.parse({ model_id: "" }));
  assert.throws(() => RawAnthropicCatalogRecordSchema.parse({ api_model_id: "" }));
  assert.throws(() => RawGeminiCatalogRecordSchema.parse({ model_id: "" }));
  assert.throws(() => RawXaiCatalogRecordSchema.parse({ name: "" }));
});
