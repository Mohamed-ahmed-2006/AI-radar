import assert from "node:assert/strict";
import test from "node:test";

import { detectLifecycleChanges } from "../lib/change-detection";
import { normalizeAnthropicLifecycleRecord } from "../lib/contracts";
import fixture from "./brightdata/fixtures/anthropic-lifecycle-fixture.json" with { type: "json" };

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
