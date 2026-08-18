import assert from "node:assert/strict";
import test from "node:test";

import {
  getCanonicalModelsWithCapabilities,
} from "../../lib/radar";
import type { LatestCapabilitySnapshotRow, SupabaseServerClient } from "../../lib/supabase";

function mockCapabilitySnapshot(overrides: Partial<LatestCapabilitySnapshotRow>): LatestCapabilitySnapshotRow {
  return {
    id: "cap-1",
    run_id: "run-1",
    source_id: "src-1",
    provider_id: "p1",
    model_id: "m1",
    api_model_id: "gpt-5.6-sol",
    display_name: "GPT-5.6 Sol",
    model_family: "GPT-5",
    model_stage: "ga",
    context_window: 256000,
    max_output_tokens: 32768,
    supports_vision: true,
    supports_tool_calling: true,
    input_modalities: ["text", "image"],
    output_modalities: ["text"],
    supported_features: ["function_calling"],
    source_url: "https://developers.openai.com/api/docs/models.md",
    extra: {},
    raw: {},
    observed_at: "2026-08-18T10:00:00.000Z",
    created_at: "2026-08-18T10:00:00.000Z",
    content_hash: "hash",
    model_name: "gpt-5.6-sol",
    provider_slug: "openai",
    provider_name: "OpenAI",
    ...overrides,
  };
}

interface MockBuilder {
  select: () => MockBuilder;
  order: () => MockBuilder;
  limit: () => MockBuilder;
  eq: (col: string, val: unknown) => MockBuilder;
  in: (col: string, vals: readonly unknown[]) => MockBuilder;
  then: (resolve: (res: { data: unknown[]; error: null }) => void) => void;
}

test("getCanonicalModelsWithCapabilities filters by provider, vision, and context window", async () => {
  const snapshots: LatestCapabilitySnapshotRow[] = [
    mockCapabilitySnapshot({
      model_id: "m1",
      api_model_id: "gpt-5.6-sol",
      model_name: "gpt-5.6-sol",
      provider_slug: "openai",
      context_window: 256000,
      supports_vision: true,
      supports_tool_calling: true,
    }),
    mockCapabilitySnapshot({
      model_id: "m2",
      api_model_id: "claude-sonnet-4-5",
      model_name: "claude-sonnet-4-5",
      provider_slug: "anthropic",
      provider_name: "Anthropic",
      context_window: 200000,
      supports_vision: true,
      supports_tool_calling: true,
    }),
    mockCapabilitySnapshot({
      model_id: "m3",
      api_model_id: "grok-4.20-reasoning",
      model_name: "grok-4.20-reasoning",
      provider_slug: "xai",
      provider_name: "xAI",
      context_window: 1000000,
      supports_vision: false,
      supports_tool_calling: true,
    }),
  ];

  function createQuery(data: readonly Record<string, unknown>[]): MockBuilder {
    let filtered = [...data];
    const builder: MockBuilder = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      eq: (col: string, val: unknown) => {
        filtered = filtered.filter((row) => row[col] === val);
        return builder;
      },
      in: (col: string, vals: readonly unknown[]) => {
        filtered = filtered.filter((row) => vals.includes(row[col]));
        return builder;
      },
      then: (resolve) => resolve({ data: filtered, error: null }),
    };
    return builder;
  }

  const mockDb = {
    from: (table: string) => {
      if (table === "latest_capability_snapshots") return createQuery(snapshots as unknown as Record<string, unknown>[]);
      return createQuery([]);
    },
  } as unknown as SupabaseServerClient;

  // Filter by provider
  const openaiOnly = await getCanonicalModelsWithCapabilities({
    client: mockDb,
    filters: { providerSlug: "openai" },
  });
  assert.equal(openaiOnly.length, 1);
  assert.equal(openaiOnly[0].apiModelId, "gpt-5.6-sol");

  // Filter by minContextWindow >= 250k
  const largeContext = await getCanonicalModelsWithCapabilities({
    client: mockDb,
    filters: { minContextWindow: 250000 },
  });
  assert.equal(largeContext.length, 2);
  assert.ok(largeContext.some((m) => m.apiModelId === "gpt-5.6-sol"));
  assert.ok(largeContext.some((m) => m.apiModelId === "grok-4.20-reasoning"));

  // Filter by search query
  const searchResults = await getCanonicalModelsWithCapabilities({
    client: mockDb,
    filters: { search: "Claude" },
  });
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].providerSlug, "anthropic");
});
