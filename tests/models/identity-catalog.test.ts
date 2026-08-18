import assert from "node:assert/strict";
import test from "node:test";

import {
  openAiModelFamilyKey,
  openAiModelIdentityKey,
  planCatalogModelMatches,
  planOpenAiModelMatches,
  planXaiModelMatches,
  xaiModelFamilyKey,
  xaiModelIdentityKey,
} from "../../lib/models/identity";
import type { ModelAliasRow, ModelRow } from "../../lib/supabase";

function mockModel(id: string, name: string): ModelRow {
  return {
    id,
    provider_id: "provider-1",
    model_name: name,
    display_name: name,
    metadata: {},
    is_active: true,
    lifecycle_state: null,
    deprecated_on: null,
    retirement_date: null,
    retirement_not_before_date: null,
    lifecycle_source_id: null,
    lifecycle_observed_at: null,
    first_seen_at: "2026-08-18T00:00:00.000Z",
    last_seen_at: "2026-08-18T00:00:00.000Z",
    created_at: "2026-08-18T00:00:00.000Z",
    updated_at: "2026-08-18T00:00:00.000Z",
  };
}

function mockAlias(alias: string, modelId: string): ModelAliasRow {
  return {
    id: `alias-${alias}`,
    provider_id: "provider-1",
    model_id: modelId,
    source_id: "source-1",
    alias,
    alias_type: "api_model_id",
    first_seen_at: "2026-08-18T00:00:00.000Z",
    last_seen_at: "2026-08-18T00:00:00.000Z",
    created_at: "2026-08-18T00:00:00.000Z",
    updated_at: "2026-08-18T00:00:00.000Z",
  };
}

test("OpenAI identity key normalization and family resolution", () => {
  assert.equal(openAiModelIdentityKey("GPT-4o-2024-08-06"), "gpt-4o-2024-08-06");
  assert.equal(openAiModelFamilyKey("gpt-4o-2024-08-06"), "gpt-4o");
  assert.equal(openAiModelFamilyKey("gpt-4o-mini-2024-07-18"), "gpt-4o-mini");
  assert.equal(openAiModelFamilyKey("o3-mini"), "o3-mini");
});

test("xAI identity key normalization and family resolution", () => {
  assert.equal(xaiModelIdentityKey("Grok-4.20-0309-reasoning"), "grok-4-20-0309-reasoning");
  assert.equal(xaiModelFamilyKey("grok-4.20-0309"), "grok-4-20");
});

test("OpenAI matching resolves exact matches and aliases first", () => {
  const existingModels = [mockModel("m1", "gpt-4o"), mockModel("m2", "o1-preview")];
  const aliases = [mockAlias("gpt-4o-latest", "m1")];

  const plan = planOpenAiModelMatches(
    ["gpt-4o", "gpt-4o-latest", "gpt-5-turbo"],
    existingModels,
    aliases,
  );

  assert.equal(plan[0].reason, "exact");
  assert.equal(plan[0].model?.id, "m1");

  assert.equal(plan[1].reason, "alias");
  assert.equal(plan[1].model?.id, "m1");

  assert.equal(plan[2].reason, "new");
  assert.equal(plan[2].createModelName, "gpt-5-turbo");
});

test("OpenAI matching matches dated snapshot to unique canonical model family", () => {
  const existingModels = [mockModel("m1", "gpt-4o")];
  const aliases: ModelAliasRow[] = [];

  const plan = planOpenAiModelMatches(
    ["gpt-4o-2024-08-06"],
    existingModels,
    aliases,
  );

  assert.equal(plan[0].reason, "unique_family");
  assert.equal(plan[0].model?.id, "m1");
});

test("Ambiguous matches throw on strict mode to prevent unsafe collapsing", () => {
  const existingModels = [mockModel("m1", "gpt-4o"), mockModel("m2", "gpt-4o")];
  const aliases: ModelAliasRow[] = [];

  assert.throws(
    () => planOpenAiModelMatches(["gpt-4o-2024-08-06"], existingModels, aliases, { onAmbiguity: "throw" }),
    /Ambiguous OpenAI model identity/,
  );
});

test("planXaiModelMatches matches exact names and aliases", () => {
  const existingModels = [mockModel("m1", "grok-4.6")];
  const aliases = [mockAlias("grok-latest", "m1")];

  const plan = planXaiModelMatches(
    ["grok-4.6", "grok-latest", "grok-imagine"],
    existingModels,
    aliases,
  );

  assert.equal(plan[0].reason, "exact");
  assert.equal(plan[0].model?.id, "m1");
  assert.equal(plan[1].reason, "alias");
  assert.equal(plan[1].model?.id, "m1");
  assert.equal(plan[2].reason, "new");
  assert.equal(plan[2].createModelName, "grok-imagine");
});

test("planCatalogModelMatches dispatches to the correct provider planner", () => {
  const existingModels = [mockModel("m1", "grok-4.6")];
  const aliases: ModelAliasRow[] = [];

  const plan = planCatalogModelMatches(
    "xai",
    ["grok-4.6", "grok-imagine"],
    existingModels,
    aliases,
  );

  assert.equal(plan[0].reason, "exact");
  assert.equal(plan[0].model?.id, "m1");
  assert.equal(plan[1].reason, "new");
});

