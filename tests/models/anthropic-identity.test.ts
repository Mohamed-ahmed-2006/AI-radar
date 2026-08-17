import assert from "node:assert/strict";
import test from "node:test";

import { planAnthropicModelMatches } from "../../lib/models/identity";
import type { ModelAliasRow, ModelRow } from "../../lib/supabase";

const timestamp = "2026-08-17T12:00:00.000Z";
const model = (id: string, model_name: string): ModelRow => ({
  id, provider_id: "provider-anthropic", model_name, display_name: null,
  metadata: {}, is_active: true, lifecycle_state: null, deprecated_on: null,
  retirement_date: null, retirement_not_before_date: null,
  lifecycle_source_id: null, lifecycle_observed_at: null,
  first_seen_at: timestamp, last_seen_at: timestamp, created_at: timestamp,
  updated_at: timestamp,
});

const alias = (id: string, value: string, model_id: string): ModelAliasRow => ({
  id, provider_id: "provider-anthropic", model_id, source_id: null,
  alias: value, alias_type: "api_model_id", first_seen_at: timestamp,
  last_seen_at: timestamp, created_at: timestamp, updated_at: timestamp,
});

test("uniquely matches an API model ID to an existing pricing display name", () => {
  const existing = model("model-1", "Claude Opus 4.1");
  const [plan] = planAnthropicModelMatches(
    ["claude-opus-4-1-20250805"],
    [existing],
    [],
  );
  assert.equal(plan.model?.id, existing.id);
  assert.equal(plan.reason, "unique_family");
  assert.equal(plan.createModelName, null);
});

test("refuses ambiguous family matches instead of creating accidental duplicates", () => {
  assert.throws(() => planAnthropicModelMatches(
    ["claude-opus-4-1-20250805"],
    [model("model-1", "Claude Opus 4.1"), model("model-2", "claude-opus-4-1")],
    [],
  ), /Ambiguous Anthropic model identity/);
});

test("a second dated sibling is created rather than colliding with an aliased one", () => {
  // Anthropic publishes several dated snapshots per family. Once the first is
  // pinned by its API-ID alias it must stop acting as a family candidate for
  // the next one, or lifecycle ingestion jams permanently on ambiguity.
  const existing = model("model-1", "claude-3-5-sonnet-20240620");
  const plans = planAnthropicModelMatches(
    ["claude-3-5-sonnet-20240620", "claude-3-5-sonnet-20241022"],
    [existing],
    [alias("alias-1", "claude-3-5-sonnet-20240620", existing.id)],
  );
  assert.deepEqual(plans.map((plan) => plan.reason), ["alias", "new"]);
  assert.equal(plans[0].model?.id, existing.id);
  assert.equal(plans[1].model, null);
  assert.equal(plans[1].createModelName, "claude-3-5-sonnet-20241022");
});

test("an exact match likewise stops standing in as another identifier's family", () => {
  const exact = model("model-1", "claude-opus-4-1-20250805");
  const plans = planAnthropicModelMatches(
    ["claude-opus-4-1-20250805", "claude-opus-4-1-20260101"],
    [exact],
    [],
  );
  assert.deepEqual(plans.map((plan) => plan.reason), ["exact", "new"]);
  assert.equal(plans[1].createModelName, "claude-opus-4-1-20260101");
});

test("authoritative resolution still refuses a genuinely ambiguous family", () => {
  assert.throws(() => planAnthropicModelMatches(
    ["Claude 3.5 Sonnet"],
    [model("model-1", "claude-3-5-sonnet-20240620"), model("model-2", "claude-3-5-sonnet-20241022")],
    [],
  ), /Ambiguous Anthropic model identity/);
});

test("a non-authoritative source degrades to its own row instead of aborting", () => {
  const plans = planAnthropicModelMatches(
    ["Claude 3.5 Sonnet"],
    [model("model-1", "claude-3-5-sonnet-20240620"), model("model-2", "claude-3-5-sonnet-20241022")],
    [],
    { onAmbiguity: "create" },
  );
  assert.equal(plans[0].reason, "new");
  assert.equal(plans[0].model, null);
  assert.equal(plans[0].createModelName, "Claude 3.5 Sonnet");
});

test("an unambiguous family match is still reused by a non-authoritative source", () => {
  const existing = model("model-1", "claude-opus-4-1-20250805");
  const [plan] = planAnthropicModelMatches(
    ["Claude Opus 4.1"],
    [existing],
    [],
    { onAmbiguity: "create" },
  );
  assert.equal(plan.reason, "unique_family");
  assert.equal(plan.model?.id, existing.id);
});
