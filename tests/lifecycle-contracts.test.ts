import assert from "node:assert/strict";
import test from "node:test";

import { ZodError } from "zod";

import {
  RawAnthropicLifecycleRecordSchema,
  normalizeAnthropicLifecycleRecord,
  parseCompleteEnglishDate,
} from "../lib/contracts";
import fixture from "./brightdata/fixtures/anthropic-lifecycle-fixture.json" with { type: "json" };

const observedAt = "2026-08-17T12:00:00.000Z";

test("normalizes an Active row with an absent deprecated_date", () => {
  const normalized = normalizeAnthropicLifecycleRecord(fixture[0], {
    observedAt,
    collectorId: "c_msxj0fk3153bu9oz7l",
    externalRunId: "j_lifecycle_1",
    collectionRunId: "run-1",
  });

  assert.equal(normalized.provider, "Anthropic");
  assert.equal(normalized.lifecycleState, "active");
  assert.equal(normalized.deprecatedDate, null);
  assert.equal(normalized.retirementDate, null);
  assert.equal(normalized.retirementNotBeforeDate, "2026-09-29");
  assert.equal("input" in normalized, false);
});

test("preserves exact retired dates without treating them as lower bounds", () => {
  const normalized = normalizeAnthropicLifecycleRecord(fixture[1], { observedAt });
  assert.equal(normalized.lifecycleState, "retired");
  assert.equal(normalized.deprecatedDate, "2026-06-05");
  assert.equal(normalized.retirementDate, "2026-08-05");
  assert.equal(normalized.retirementNotBeforeDate, null);
});

test("normalizes every supported lifecycle state", () => {
  const states = ["Active", "Legacy", "Deprecated", "Retired"] as const;
  assert.deepEqual(states.map((current_state) => normalizeAnthropicLifecycleRecord({
    ...fixture[0], current_state,
  }, { observedAt }).lifecycleState), ["active", "legacy", "deprecated", "retired"]);
});

test("rejects unknown states, malformed dates, missing required fields, and extra fields", () => {
  const invalid = [
    { ...fixture[0], current_state: "Inactive" },
    { ...fixture[0], deprecated_date: "2026-06-05" },
    { ...fixture[0], deprecated_date: "February 30, 2026" },
    { ...fixture[0], api_model_name: undefined },
    { ...fixture[0], inferred_state: "active" },
  ];
  invalid.forEach((record) => assert.throws(
    () => RawAnthropicLifecycleRecordSchema.parse(record),
    ZodError,
  ));
});

test("parses complete English dates deterministically", () => {
  assert.equal(parseCompleteEnglishDate("January 2, 2027"), "2027-01-02");
});
