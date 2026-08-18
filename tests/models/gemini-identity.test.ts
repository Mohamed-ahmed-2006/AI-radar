import assert from "node:assert/strict";
import test from "node:test";

import { planGeminiModelMatches } from "../../lib/models/identity";
import type { ModelAliasRow, ModelRow } from "../../lib/supabase";

const timestamp = "2026-08-18T12:00:00.000Z";
const model = (id: string, model_name: string): ModelRow => ({
  id, provider_id: "provider-gemini", model_name, display_name: null,
  metadata: {}, is_active: true, lifecycle_state: null, deprecated_on: null,
  retirement_date: null, retirement_not_before_date: null,
  lifecycle_source_id: null, lifecycle_observed_at: null,
  first_seen_at: timestamp, last_seen_at: timestamp, created_at: timestamp,
  updated_at: timestamp,
});
const alias = (value: string, model_id: string): ModelAliasRow => ({
  id: `alias-${model_id}`, provider_id: "provider-gemini", model_id,
  source_id: null, alias: value, alias_type: "api_model_id",
  first_seen_at: timestamp, last_seen_at: timestamp, created_at: timestamp,
  updated_at: timestamp,
});

test("Gemini stable API IDs reuse safely normalized pricing display names", () => {
  const existing = model("model-1", "Gemini 2.5 Pro");
  const [plan] = planGeminiModelMatches(["gemini-2.5-pro"], [existing], []);
  assert.equal(plan.reason, "exact");
  assert.equal(plan.model?.id, existing.id);
});

test("Gemini numbered stable revisions use only an unambiguous family fallback", () => {
  const existing = model("model-1", "Gemini 1.5 Pro");
  const [plan] = planGeminiModelMatches(["gemini-1.5-pro-002"], [existing], []);
  assert.equal(plan.reason, "unique_family");
  assert.equal(plan.model?.id, existing.id);
});

test("preview versions remain distinct and are never collapsed as a family", () => {
  const existing = model("model-1", "gemini-2.5-pro-preview-03-25");
  const plans = planGeminiModelMatches(
    ["gemini-2.5-pro-preview-03-25", "gemini-2.5-pro-preview-05-06"],
    [existing],
    [alias("gemini-2.5-pro-preview-03-25", existing.id)],
  );
  assert.deepEqual(plans.map((plan) => plan.reason), ["alias", "new"]);
  assert.equal(plans[1].createModelName, "gemini-2.5-pro-preview-05-06");
});

test("genuine Gemini ambiguity fails closed", () => {
  assert.throws(() => planGeminiModelMatches(
    ["gemini-1.5-pro-002"],
    [model("model-1", "Gemini 1.5 Pro"), model("model-2", "gemini-1-5-pro")],
    [],
  ), /Ambiguous Gemini model identity/);
});

test("robotics and experimental IDs retain their authoritative identities", () => {
  const plans = planGeminiModelMatches(
    ["gemini-robotics-er-1.6-preview", "lyria-realtime-exp"],
    [],
    [],
  );
  assert.deepEqual(plans.map((plan) => plan.createModelName), [
    "gemini-robotics-er-1.6-preview",
    "lyria-realtime-exp",
  ]);
});
