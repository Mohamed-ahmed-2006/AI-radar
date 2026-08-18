import assert from "node:assert/strict";
import test from "node:test";

import { ZodError } from "zod";

import {
  RawGeminiLifecycleRecordSchema,
  normalizeGeminiLifecycleRecord,
} from "../lib/contracts";
import fixture from "./brightdata/fixtures/gemini-lifecycle-fixture.json" with { type: "json" };

const observedAt = "2026-08-18T12:00:00.000Z";

test("Gemini raw contract accepts validated records and missing optional fields", () => {
  assert.equal(RawGeminiLifecycleRecordSchema.parse(fixture[0]).is_shutdown, false);
  const minimal = { ...fixture[1] } as Record<string, unknown>;
  delete minimal.release_date_raw;
  delete minimal.shutdown_not_before_date_raw;
  delete minimal.recommended_replacement;
  delete minimal.product_page_url;
  const parsed = RawGeminiLifecycleRecordSchema.parse(minimal);
  assert.equal(parsed.model_stage, "preview");
});

test("Gemini contract requires a real boolean shutdown signal and rejects malformed records", () => {
  for (const invalid of [
    { ...fixture[0], is_shutdown: "false" },
    { ...fixture[0], model_stage: "experimental" },
    { ...fixture[0], model_id: "Gemini 2.5 Pro" },
    { ...fixture[0], unexpected: true },
    { ...fixture[0], input: { url: "not a URL" } },
  ]) {
    assert.throws(() => RawGeminiLifecycleRecordSchema.parse(invalid), ZodError);
  }
});

test("scheduled non-shutdown maps to deprecated and a lower bound, never exact retirement", () => {
  const normalized = normalizeGeminiLifecycleRecord(fixture[0], { observedAt });
  assert.equal(normalized.lifecycleState, "deprecated");
  assert.equal(normalized.retirementNotBeforeDate, "2027-05-07");
  assert.equal(normalized.retirementDate, null);
  assert.equal(normalized.retirementNotBeforeObservation, "date");
  assert.equal(normalized.recommendedReplacement, "gemini-3-pro-preview");
});

test("no shutdown announced does not manufacture active and preserves replacement text", () => {
  const normalized = normalizeGeminiLifecycleRecord(fixture[1], { observedAt });
  assert.equal(normalized.lifecycleState, null);
  assert.equal(normalized.retirementNotBeforeDate, null);
  assert.equal(normalized.retirementNotBeforeObservation, "explicitly_unannounced");
  assert.equal(normalized.recommendedReplacement, "gemini-robotics-er-2-preview");
});

test("explicit shutdown wins even when the date text says no shutdown announced", () => {
  const normalized = normalizeGeminiLifecycleRecord(fixture[2], { observedAt });
  assert.equal(normalized.lifecycleState, "retired");
  assert.equal(normalized.sourceMetadata.modelStage, "stable");
});

test("Veo replacement stays the clean collector model ID without page prose", () => {
  const normalized = normalizeGeminiLifecycleRecord({
    ...fixture[0],
    model_id: "veo-2.0-generate-001",
    recommended_replacement: "veo-3.0-generate-preview",
    product_page_url: "https://ai.google.dev/gemini-api/docs/video",
  }, { observedAt });
  assert.equal(normalized.recommendedReplacement, "veo-3.0-generate-preview");
  assert.equal(
    normalized.sourceMetadata.productPageUrl,
    "https://ai.google.dev/gemini-api/docs/video",
  );
});

test("incomplete dates preserve raw precision without inventing a day", () => {
  const normalized = normalizeGeminiLifecycleRecord(fixture[1], { observedAt });
  assert.equal(normalized.sourceMetadata.releaseDate, null);
  assert.equal(normalized.sourceMetadata.releaseDateRaw, "August 2026");

  const impreciseShutdown = normalizeGeminiLifecycleRecord({
    ...fixture[0],
    shutdown_not_before_date_raw: "August 2026",
  }, { observedAt });
  assert.equal(impreciseShutdown.lifecycleState, "deprecated");
  assert.equal(impreciseShutdown.retirementNotBeforeDate, null);
  assert.equal(impreciseShutdown.retirementNotBeforeObservation, "imprecise_date");
});
