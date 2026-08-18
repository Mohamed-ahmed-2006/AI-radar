import assert from "node:assert/strict";
import test from "node:test";

import { detectLifecycleChanges } from "../lib/change-detection";
import {
  normalizeAnthropicLifecycleRecord,
  normalizeGeminiLifecycleRecord,
} from "../lib/contracts";
import fixture from "./brightdata/fixtures/anthropic-lifecycle-fixture.json" with { type: "json" };
import geminiFixture from "./brightdata/fixtures/gemini-lifecycle-fixture.json" with { type: "json" };

const observedAt = "2026-08-17T12:00:00.000Z";
const record = (overrides: Record<string, unknown> = {}) =>
  normalizeAnthropicLifecycleRecord({ ...fixture[0], ...overrides }, { observedAt });

test("identical repeated lifecycle collections emit no duplicate changes", () => {
  const previous = record();
  const current = record();
  assert.deepEqual(detectLifecycleChanges([previous], [current]), []);
});

test("an authoritative transition and date appearance produce deterministic events", () => {
  const previous = record();
  const current = record({
    current_state: "Deprecated",
    deprecated_date: "August 17, 2026",
  });
  assert.deepEqual(detectLifecycleChanges([previous], [current]).map((event) => ({
    type: event.type,
    field: event.field,
    oldValue: event.oldValue,
    newValue: event.newValue,
  })), [
    { type: "lifecycle_changed", field: "lifecycleState", oldValue: "active", newValue: "deprecated" },
    { type: "lifecycle_changed", field: "deprecatedDate", oldValue: null, newValue: "2026-08-17" },
  ]);
});

test("missing rows do not infer retirement or removal", () => {
  assert.deepEqual(detectLifecycleChanges([record()], []), []);
});

test("a changed retirement lower bound remains distinct from an exact date", () => {
  const events = detectLifecycleChanges([record()], [record({
    tentative_retirement_date: "Not sooner than October 15, 2026",
  })]);
  assert.deepEqual(events.map((event) => ({
    field: event.field,
    oldValue: event.oldValue,
    newValue: event.newValue,
  })), [{
    field: "retirementNotBeforeDate",
    oldValue: "2026-09-29",
    newValue: "2026-10-15",
  }]);
});

test("Gemini schedule withdrawal and replacement changes are deterministic", () => {
  const previous = normalizeGeminiLifecycleRecord(geminiFixture[0], { observedAt });
  const current = normalizeGeminiLifecycleRecord({
    ...geminiFixture[0],
    shutdown_not_before_date_raw: "No shutdown date announced",
    recommended_replacement: "gemini-3.1-pro-preview",
  }, { observedAt });
  assert.deepEqual(detectLifecycleChanges([previous], [current]).map((event) => ({
    field: event.field,
    oldValue: event.oldValue,
    newValue: event.newValue,
  })), [
    {
      field: "retirementNotBeforeDate",
      oldValue: "2027-05-07",
      newValue: null,
    },
    {
      field: "recommendedReplacement",
      oldValue: "gemini-3-pro-preview",
      newValue: "gemini-3.1-pro-preview",
    },
  ]);
});

test("Gemini missing source fields and no-shutdown text do not manufacture state events", () => {
  const previous = normalizeGeminiLifecycleRecord(geminiFixture[0], { observedAt });
  const missing = { ...geminiFixture[0] } as Record<string, unknown>;
  delete missing.shutdown_not_before_date_raw;
  delete missing.recommended_replacement;
  const current = normalizeGeminiLifecycleRecord(missing, { observedAt });
  assert.deepEqual(detectLifecycleChanges([previous], [current]), []);

  const noShutdown = normalizeGeminiLifecycleRecord({
    ...geminiFixture[0],
    shutdown_not_before_date_raw: "No shutdown date announced",
  }, { observedAt });
  assert.equal(
    detectLifecycleChanges([previous], [noShutdown])
      .some((event) => event.field === "lifecycleState"),
    false,
  );
});

test("first Gemini observation and missing rows emit no fake lifecycle event", () => {
  const current = normalizeGeminiLifecycleRecord(geminiFixture[0], { observedAt });
  assert.deepEqual(detectLifecycleChanges([], [current]), []);
  assert.deepEqual(detectLifecycleChanges([current], []), []);
});

test("Gemini scheduled to explicitly shutdown emits a retired transition only from source evidence", () => {
  const previous = normalizeGeminiLifecycleRecord(geminiFixture[0], { observedAt });
  const current = normalizeGeminiLifecycleRecord({
    ...geminiFixture[0],
    is_shutdown: true,
  }, { observedAt });
  assert.deepEqual(detectLifecycleChanges([previous], [current]).map((event) => ({
    field: event.field,
    oldValue: event.oldValue,
    newValue: event.newValue,
  })), [{ field: "lifecycleState", oldValue: "deprecated", newValue: "retired" }]);
});
