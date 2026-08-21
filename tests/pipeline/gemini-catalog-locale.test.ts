/**
 * A translated page is not a second opinion.
 *
 * Google's model index occasionally links a locale-suffixed page. One did:
 * `gemini-2.5-flash-lite?hl=es-419` was collected in Spanish, so
 * `llamada_a_función` never matched the function-calling test and `texto` /
 * `imagen` never normalized to modalities. Gemini 2.5 Flash-Lite was admitted
 * with vision false, tool calling unobserved and half its inputs missing — and
 * that admission produced change events claiming the model had *lost* vision.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  createGeminiCatalogSourceHealthContract,
  evaluateSourceHealth,
  localeQueryParameter,
} from "../../lib/sentinel";

const BASE = "https://ai.google.dev/gemini-api/docs/models";

/** The English record the collector returns for this model. */
const ENGLISH = {
  model_id: "gemini-2.5-flash-lite",
  display_name: "Gemini 2.5 Flash-Lite",
  input_modalities: ["text", "image", "video", "audio"],
  output_modalities: ["text"],
  context_window_raw: 1_048_576,
  max_output_tokens_raw: 65_536,
  supports_vision: true,
  supported_features: ["caching", "function_calling"],
  source_url: `${BASE}/gemini-2.5-flash-lite`,
  input: { url: BASE },
};

/** The Spanish rendering of the same model, exactly as it was collected. */
const SPANISH = {
  ...ENGLISH,
  input_modalities: ["video", "audio"],
  output_modalities: [],
  supports_vision: false,
  supported_features: ["llamada_a_función", "salidas_estructuradas"],
  source_url: `${BASE}/gemini-2.5-flash-lite?hl=es-419`,
};

const SECOND_MODEL = { ...ENGLISH, model_id: "gemini-3.7-flash", source_url: `${BASE}/gemini-3.7-flash` };

function evaluate(records: unknown[]) {
  return evaluateSourceHealth(
    records,
    createGeminiCatalogSourceHealthContract("catalog-gemini"),
    null,
    { observedAt: new Date().toISOString() },
  );
}

test("localeQueryParameter names the language only when the URL does", () => {
  assert.equal(localeQueryParameter(`${BASE}/gemini-2.5-flash-lite?hl=es-419`), "es-419");
  assert.equal(localeQueryParameter(`${BASE}/gemini-2.5-flash-lite`), null);
  assert.equal(localeQueryParameter(undefined), null);
  assert.equal(localeQueryParameter("not a url"), null);
});

test("a localized record is refused rather than admitted as a capability loss", () => {
  const evaluation = evaluate([SPANISH, SECOND_MODEL]);
  assert.equal(evaluation.recordsInvalid, 1);
  assert.equal(evaluation.recordsValid, 1);
  assert.ok(
    evaluation.issues.some((issue) => /hl=es-419/.test(issue.message)),
    "the rejection must name the locale that caused it",
  );
});

test("the canonical English record passes untouched", () => {
  const evaluation = evaluate([ENGLISH, SECOND_MODEL]);
  assert.equal(evaluation.recordsInvalid, 0);
  assert.equal(evaluation.status, "healthy");
});

/**
 * The silent failure the invariant exists to stop: a batch that still returns
 * every model and simply stops carrying what the page publishes for each.
 */
test("a batch that loses every input modality is refused, not admitted", () => {
  const stripped = [ENGLISH, SECOND_MODEL].map((record) => ({
    ...record,
    input_modalities: [],
  }));
  const evaluation = evaluate(stripped);
  assert.equal(evaluation.shouldQuarantine, true);
  assert.ok(evaluation.reasonCodes.includes("SEMANTIC_INVARIANT_VIOLATION"));
});

test("a batch that loses every context window is refused, not admitted", () => {
  const stripped = [ENGLISH, SECOND_MODEL].map((record) => ({
    ...record,
    context_window_raw: null,
  }));
  const evaluation = evaluate(stripped);
  assert.equal(evaluation.shouldQuarantine, true);
  assert.ok(evaluation.reasonCodes.includes("CAPABILITY_TOKEN_LIMITS_MISSING"));
});

/** Unknown semantics unchanged: one model missing a field is still unobserved. */
test("a single model missing a field is still Unknown, not a violation", () => {
  const evaluation = evaluate([ENGLISH, { ...SECOND_MODEL, input_modalities: [] }]);
  assert.equal(evaluation.shouldQuarantine, false);
  assert.equal(evaluation.reasonCodes.includes("SEMANTIC_INVARIANT_VIOLATION"), false);
});
