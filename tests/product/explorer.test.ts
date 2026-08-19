import test from "node:test";
import assert from "node:assert/strict";

import {
  compareHref,
  compareIdsFromParams,
  explorerCanonicalId,
  explorerFiltersFromParams,
  explorerHref,
  explorerSearchParams,
  getModelExplorerAdapter,
  MAX_COMPARE_MODELS,
  observedBoolean,
  parseCompareIds,
  setModelExplorerAdapter,
  toggleCompareId,
  DEFAULT_EXPLORER_FILTERS,
  type ModelExplorerAdapter,
} from "../../lib/product/explorer";
import {
  CANONICAL_EXPLORER_ADAPTER_ID,
  canonicalFiltersFromExplorer,
  createCanonicalExplorerAdapter,
  freshnessFromObservation,
  projectExplorerRow,
  resolveCanonicalModelIds,
  STALE_AFTER_MS,
} from "../../lib/product/explorer-read-model";
import {
  compareModels,
  getModelDetail,
  getModelExplorer,
  InMemoryModelExplorerReadPort,
  type ModelExplorerFilters as CanonicalExplorerFilters,
} from "../../lib/explorer";
import {
  CLAUDE_3_OPUS,
  CLAUDE_SONNET_5,
  explorerData,
  GEMINI_IMAGEN,
  GPT_5,
  NOW,
  now,
} from "../explorer/support/fixtures";

test("observedBoolean: null is Unknown / not observed, never unsupported", () => {
  const unknown = observedBoolean(null);
  assert.equal(unknown.observed, null);
  assert.equal(unknown.label, "Unknown");
  assert.match(unknown.description, /not observed/i);
  assert.doesNotMatch(unknown.label, /unsupported/i);
  assert.doesNotMatch(unknown.description, /unsupported/i);

  const missing = observedBoolean(undefined);
  assert.equal(missing.observed, null);
  assert.equal(missing.label, "Unknown");

  const no = observedBoolean(false);
  assert.equal(no.observed, false);
  assert.equal(no.label, "Not supported");

  const yes = observedBoolean(true);
  assert.equal(yes.observed, true);
  assert.equal(yes.label, "Supported");
});

test("explorer filters round-trip through URL search params", () => {
  const filters = {
    provider: "openai",
    maxInputPrice: 5,
    maxOutputPrice: 15,
    minContext: 128000,
    visionRequired: true,
    toolCallingRequired: true,
    activeOnly: true,
    lifecycleState: "active" as const,
  };

  const params = explorerSearchParams(filters, ["openai:gpt-4o", "anthropic:claude-sonnet-4-5"]);
  assert.equal(params.get("provider"), "openai");
  assert.equal(params.get("maxInput"), "5");
  assert.equal(params.get("vision"), "1");
  assert.equal(params.get("ids"), "openai:gpt-4o,anthropic:claude-sonnet-4-5");

  const parsed = explorerFiltersFromParams(params);
  assert.deepEqual(parsed, filters);
  assert.deepEqual(compareIdsFromParams(params), [
    "openai:gpt-4o",
    "anthropic:claude-sonnet-4-5",
  ]);
});

test("compare URL state is shareable and capped", () => {
  const ids = parseCompareIds("OpenAI:GPT-4o, anthropic:claude-sonnet-4-5, openai:gpt-4o, extra");
  assert.deepEqual(ids, ["openai:gpt-4o", "anthropic:claude-sonnet-4-5"]);

  const many = Array.from({ length: 8 }, (_, i) => `p:model-${i}`);
  assert.equal(parseCompareIds(many.join(",")).length, MAX_COMPARE_MODELS);

  assert.equal(
    compareHref(["anthropic:claude-sonnet-4-5"]),
    "/models/compare?ids=anthropic%3Aclaude-sonnet-4-5",
  );
  assert.equal(
    explorerHref(DEFAULT_EXPLORER_FILTERS, ["openai:gpt-4o"]),
    "/models?ids=openai%3Agpt-4o",
  );
});

test("toggleCompareId uses canonical ids and refuses a sixth model", () => {
  let selected: string[] = [];
  selected = toggleCompareId(selected, "anthropic:claude-sonnet-4-5");
  selected = toggleCompareId(selected, "openai:gpt-4o");
  assert.deepEqual(selected, ["anthropic:claude-sonnet-4-5", "openai:gpt-4o"]);

  selected = toggleCompareId(selected, "ANTHROPIC:claude-sonnet-4-5");
  assert.deepEqual(selected, ["openai:gpt-4o"]);

  const full = ["a:1", "a:2", "a:3", "a:4", "a:5"];
  assert.deepEqual(toggleCompareId(full, "a:6"), full);
});

test("canonical id prefers provider:apiModelId and falls back to the uuid", () => {
  assert.equal(
    explorerCanonicalId({
      providerSlug: "OpenAI",
      apiModelId: "gpt-4o",
      modelId: "uuid-1",
    }),
    "openai:gpt-4o",
  );
  assert.equal(
    explorerCanonicalId({
      providerSlug: "openai",
      apiModelId: null,
      modelId: "uuid-1",
    }),
    "id:uuid-1",
  );
});


// ---------------------------------------------------------------------------
// The canonical adapter, exercised against the real read model.
//
// These tests wire the adapter to `lib/explorer` over an in-memory port, so a
// filter assertion here proves the deterministic read model did the matching —
// not a second copy of the rules living in the adapter.
// ---------------------------------------------------------------------------

function canonicalAdapter(overrides: { configured?: boolean } = {}) {
  const port = new InMemoryModelExplorerReadPort(explorerData());
  return createCanonicalExplorerAdapter({
    listExplorer: (filters?: CanonicalExplorerFilters) =>
      getModelExplorer({ port, now, filters }),
    getDetail: (modelId: string) => getModelDetail(modelId, { port, now }),
    compare: (modelIds: readonly string[]) => compareModels(modelIds, { port, now }),
    listSourceHealth: async () => [],
    now,
    ...overrides,
  });
}

test("canonical adapter: filter controls are translated, never re-implemented", () => {
  assert.deepEqual(
    canonicalFiltersFromExplorer({
      provider: "openai",
      maxInputPrice: 3,
      maxOutputPrice: 15,
      minContext: 200_000,
      visionRequired: true,
      toolCallingRequired: true,
      activeOnly: true,
      lifecycleState: "active",
    }),
    {
      providers: ["openai"],
      maxInputPrice: 3,
      maxOutputPrice: 15,
      minContextWindow: 200_000,
      visionRequired: true,
      toolCallingRequired: true,
      activeOnly: true,
      lifecycleStates: ["active"],
    },
  );

  // A control that is off is not a constraint, so nothing is sent for it.
  assert.deepEqual(canonicalFiltersFromExplorer(DEFAULT_EXPLORER_FILTERS), {});
});

test("canonical adapter: the read model decides what matches", async () => {
  const adapter = canonicalAdapter();

  const all = await adapter.listModels(DEFAULT_EXPLORER_FILTERS);
  assert.equal(all.totalUnfiltered, 8);
  assert.equal(all.totalMatching, 8);

  const vision = await adapter.listModels({
    ...DEFAULT_EXPLORER_FILTERS,
    visionRequired: true,
  });
  assert.deepEqual(
    vision.models.map((row) => row.identity.canonicalId).sort(),
    ["gemini:gemini-2.5-flash", "openai:gpt-5"],
  );
  // Facets still describe the whole catalog, so the controls stay usable.
  assert.equal(vision.totalUnfiltered, 8);
  assert.equal(vision.totalMatching, 2);
  assert.deepEqual(
    vision.providerOptions.map((option) => [option.value, option.count]),
    [
      ["anthropic", 2],
      ["gemini", 4],
      ["openai", 1],
      ["xai", 1],
    ],
  );
  assert.deepEqual(
    vision.lifecycleOptions.map((option) => [option.value, option.count]),
    [
      ["active", 3],
      ["deprecated", 2],
    ],
  );
});

test("canonical adapter: unknown never satisfies a required capability", async () => {
  const adapter = canonicalAdapter();

  const tools = await adapter.listModels({
    ...DEFAULT_EXPLORER_FILTERS,
    toolCallingRequired: true,
  });
  const ids = tools.models.map((row) => row.identity.canonicalId);
  assert.ok(ids.includes("openai:gpt-5"));
  // Unknown tool calling is not a match.
  assert.ok(!ids.includes("gemini:gemini-2.5-flash-preview-09-2025"));

  const unfiltered = await adapter.listModels(DEFAULT_EXPLORER_FILTERS);
  const sonnet = unfiltered.models.find(
    (row) => row.identity.canonicalId === "anthropic:claude-sonnet-5",
  );
  assert.equal(sonnet?.vision.observed, null);
  assert.equal(sonnet?.vision.label, "Unknown");
  assert.doesNotMatch(sonnet?.vision.description ?? "", /unsupported/i);

  const grok = unfiltered.models.find(
    (row) => row.identity.canonicalId === "xai:grok-4",
  );
  assert.equal(grok?.vision.observed, false);
});

test("canonical adapter: a price ceiling never admits an unobserved price", async () => {
  const adapter = canonicalAdapter();

  const affordable = await adapter.listModels({
    ...DEFAULT_EXPLORER_FILTERS,
    maxInputPrice: 2,
  });
  const ids = affordable.models.map((row) => row.identity.canonicalId);

  assert.ok(ids.includes("openai:gpt-5"));
  // Grok has no observed price, so it is not under any ceiling.
  assert.ok(!ids.includes("xai:grok-4"));
});

test("canonical adapter: active-only drops observed end-of-life, keeps unknown", async () => {
  const adapter = canonicalAdapter();

  const active = await adapter.listModels({
    ...DEFAULT_EXPLORER_FILTERS,
    activeOnly: true,
  });
  const ids = active.models.map((row) => row.identity.canonicalId);

  assert.ok(!ids.includes(`id:${CLAUDE_3_OPUS.id}`), "deprecated is dropped");
  // GPT-5 has no lifecycle evidence at all; absence is not retirement.
  assert.ok(ids.includes("openai:gpt-5"));

  const gpt5 = active.models.find((row) => row.identity.canonicalId === "openai:gpt-5");
  assert.equal(gpt5?.lifecycle.state, null);
  assert.equal(gpt5?.lifecycle.isActive, null, "unknown lifecycle is not inactive");
  assert.equal(gpt5?.lifecycle.label, "Unknown");
});

test("canonical adapter: pricing absence does not retire, catalog absence does not deprecate", async () => {
  const adapter = canonicalAdapter();
  const catalog = await adapter.listModels(DEFAULT_EXPLORER_FILTERS);

  const grok = catalog.models.find((row) => row.identity.canonicalId === "xai:grok-4");
  assert.equal(grok?.inputPrice, null);
  assert.equal(grok?.lifecycle.state, null);
  assert.equal(grok?.lifecycle.isActive, null);

  // Opus is absent from every catalog page and keeps its lifecycle evidence.
  const opus = catalog.models.find(
    (row) => row.identity.canonicalId === `id:${CLAUDE_3_OPUS.id}`,
  );
  assert.equal(opus?.lifecycle.state, "deprecated");
  assert.equal(opus?.lifecycle.retirementDate, "2026-03-01");
  assert.equal(opus?.contextWindow, null);
});

test("canonical adapter: a conflicted identity fails closed on the row and in detail", async () => {
  const adapter = canonicalAdapter();
  const catalog = await adapter.listModels(DEFAULT_EXPLORER_FILTERS);

  const imagen = catalog.models.find(
    (row) => row.identity.canonicalId === `id:${GEMINI_IMAGEN.id}`,
  );
  assert.ok(imagen, "a conflicted model is still listed");
  // No compound id is minted from the two competing API ids.
  assert.equal(imagen.identity.apiModelId, null);
  assert.equal(imagen.contextWindow, null);
  assert.equal(imagen.vision.observed, null);
  // Its lifecycle is untouched by the capability conflict.
  assert.equal(imagen.lifecycle.state, "active");

  const detail = await adapter.getModelDetail(`id:${GEMINI_IMAGEN.id}`);
  assert.ok(detail);
  assert.equal(detail.capabilities.available, false);
  assert.match(
    detail.capabilities.available ? "" : detail.capabilities.reason,
    /different capability evidence/i,
  );
  assert.equal(detail.lifecycle.available, true);
});

test("canonical adapter: selection keys resolve to canonical ids and fail closed on ambiguity", async () => {
  const { entries } = await getModelExplorer({
    port: new InMemoryModelExplorerReadPort(explorerData()),
    now,
  });

  const resolved = resolveCanonicalModelIds(entries);
  assert.equal(resolved.get("openai:gpt-5"), GPT_5.id);
  assert.equal(resolved.get(`id:${CLAUDE_3_OPUS.id}`), CLAUDE_3_OPUS.id);

  // Two canonical models that would share one selection key resolve to neither.
  const gpt5 = entries.find((entry) => entry.canonicalModelId === GPT_5.id);
  assert.ok(gpt5);
  const duplicated = resolveCanonicalModelIds([
    gpt5,
    { ...gpt5, canonicalModelId: "another-model" },
  ]);
  assert.equal(duplicated.size, 0, "an ambiguous key resolves to nothing");
});

test("canonical adapter: detail exposes every evidence domain and its history", async () => {
  const adapter = canonicalAdapter();
  const detail = await adapter.getModelDetail("openai:gpt-5");
  assert.ok(detail);

  assert.equal(detail.identity.modelId, GPT_5.id);
  assert.equal(detail.pricing.available, true);
  assert.equal(detail.pricing.available ? detail.pricing.data.length : 0, 2);
  assert.equal(detail.limits.available, true);
  assert.equal(
    detail.limits.available ? detail.limits.data.contextWindow : null,
    400_000,
  );

  assert.equal(detail.pricingHistory.available, true);
  assert.equal(
    detail.pricingHistory.available ? detail.pricingHistory.data.length : 0,
    3,
    "a superseded price stays in history",
  );
  assert.equal(detail.history.available, true);
  assert.equal(detail.recentChanges.available, true);
  assert.equal(
    detail.recentChanges.available ? detail.recentChanges.data[0].changeType : null,
    "price_decreased",
  );
  assert.deepEqual(
    detail.apiModelIds.available ? detail.apiModelIds.data : [],
    ["gpt-5", "gpt-5-2026-01-15"],
  );

  // Provenance is per domain, and a domain with no evidence claims no source.
  assert.equal(detail.provenanceByDomain.pricing?.sourceKind, "pricing");
  assert.equal(detail.provenanceByDomain.capability?.sourceKind, "models");
  assert.equal(detail.provenanceByDomain.lifecycle, null);
  assert.equal(detail.freshness.quality, "current");
});

test("canonical adapter: an unavailable section says why instead of showing nothing", async () => {
  const adapter = canonicalAdapter();
  const detail = await adapter.getModelDetail("xai:grok-4");
  assert.ok(detail);

  assert.equal(detail.pricing.available, false);
  assert.match(
    detail.pricing.available ? "" : detail.pricing.reason,
    /no pricing observation/i,
  );
  assert.equal(detail.pricingHistory.available, false);
  assert.equal(detail.lifecycleHistory.available, false);
  assert.equal(detail.lifecycle.available, false);
  assert.equal(detail.replacement.available, false);
  assert.equal(detail.apiModelIds.available, false);
});

test("canonical adapter: lifecycle history and replacement come from lifecycle evidence", async () => {
  const adapter = canonicalAdapter();
  const detail = await adapter.getModelDetail(`id:${CLAUDE_3_OPUS.id}`);
  assert.ok(detail);

  assert.equal(detail.lifecycleHistory.available, true);
  const history = detail.lifecycleHistory.available ? detail.lifecycleHistory.data : [];
  assert.equal(history[0].state, "deprecated");
  assert.equal(history[0].retirementDate, "2026-03-01");
  assert.equal(history[0].recommendedReplacement, "claude-sonnet-5");

  assert.equal(detail.replacement.available, true);
  assert.equal(
    detail.replacement.available ? detail.replacement.data.replacementModelId : null,
    CLAUDE_SONNET_5.id,
  );
  assert.equal(detail.provenanceByDomain.lifecycle?.sourceKind, "lifecycle");
});

test("canonical adapter: an unknown selection key is reported, never resolved to a near miss", async () => {
  const adapter = canonicalAdapter();

  assert.equal(await adapter.getModelDetail("openai:gpt-6"), null);

  const comparison = await adapter.compareModels([
    "openai:gpt-5",
    "openai:gpt-6",
    "xai:grok-4",
  ]);
  assert.deepEqual(
    comparison.columns.map((column) => column.identity.canonicalId),
    ["openai:gpt-5", "xai:grok-4"],
  );
  assert.deepEqual(comparison.missingIds, ["openai:gpt-6"]);
});

test("canonical adapter: compare aligns columns, keeps unknown unknown, and ranks nothing", async () => {
  const adapter = canonicalAdapter();
  const comparison = await adapter.compareModels([
    "openai:gpt-5",
    "anthropic:claude-sonnet-5",
    "xai:grok-4",
  ]);

  assert.deepEqual(
    comparison.columns.map((column) => column.identity.canonicalId),
    ["openai:gpt-5", "anthropic:claude-sonnet-5", "xai:grok-4"],
    "requested order is preserved",
  );
  assert.deepEqual(
    comparison.columns.map((column) => column.inputPrice),
    [1.25, 3, null],
  );
  assert.deepEqual(
    comparison.columns.map((column) => column.vision.observed),
    [true, null, false],
  );
  assert.deepEqual(
    comparison.columns.map((column) => column.contextWindow),
    [400_000, 200_000, 256_000],
  );

  // Provenance stays per domain, and a missing domain claims no source.
  assert.equal(comparison.columns[0].provenanceByDomain.pricing?.sourceKind, "pricing");
  assert.equal(comparison.columns[2].provenanceByDomain.pricing, null);

  const serialized = JSON.stringify(comparison);
  for (const word of ["winner", "rank", "score", "best"]) {
    assert.ok(!serialized.toLowerCase().includes(word), `must not report a ${word}`);
  }
});

test("canonical adapter: compare respects the five-model UI selection cap", async () => {
  const adapter = canonicalAdapter();
  const ids = parseCompareIds(
    [
      "openai:gpt-5",
      "anthropic:claude-sonnet-5",
      "xai:grok-4",
      "gemini:gemini-2.5-flash",
      "gemini:gemini-2.5-flash-preview-09-2025",
      // A sixth selection is dropped by the UI cap before it ever reaches here.
      `id:${CLAUDE_3_OPUS.id}`,
    ].join(","),
  );

  assert.equal(ids.length, MAX_COMPARE_MODELS);
  const comparison = await adapter.compareModels(ids);
  assert.equal(comparison.columns.length, MAX_COMPARE_MODELS);
  assert.deepEqual(comparison.missingIds, []);
});

test("canonical adapter: freshness is labelled from the observation, never invented", () => {
  const fresh = freshnessFromObservation(
    new Date(NOW.getTime() - 60_000).toISOString(),
    NOW,
    false,
  );
  assert.equal(fresh.quality, "current");

  const stale = freshnessFromObservation(
    new Date(NOW.getTime() - STALE_AFTER_MS - 60_000).toISOString(),
    NOW,
    false,
  );
  assert.equal(stale.quality, "stale");

  const unknown = freshnessFromObservation(null, NOW, false);
  assert.equal(unknown.quality, "unknown");
  assert.equal(unknown.observedAt, null);

  const degraded = freshnessFromObservation(NOW.toISOString(), NOW, true);
  assert.equal(degraded.quality, "degraded");
});

test("canonical adapter: an unconfigured environment returns nothing rather than fixtures", async () => {
  const adapter = createCanonicalExplorerAdapter({
    configured: false,
    now,
    listExplorer: async () => {
      throw new Error("should not read");
    },
    getDetail: async () => {
      throw new Error("should not read");
    },
    compare: async () => {
      throw new Error("should not read");
    },
  });

  const catalog = await adapter.listModels();
  assert.equal(catalog.models.length, 0);
  assert.match(catalog.evidenceNote ?? "", /not configured/i);
  assert.equal(await adapter.getModelDetail("openai:gpt-5"), null);
  assert.deepEqual((await adapter.compareModels(["openai:gpt-5"])).missingIds, [
    "openai:gpt-5",
  ]);
});

test("explorer seam: the canonical adapter is installed and stays swappable", async () => {
  const canonical = canonicalAdapter();

  setModelExplorerAdapter(canonical);
  assert.equal(getModelExplorerAdapter().id, CANONICAL_EXPLORER_ADAPTER_ID);

  const other: ModelExplorerAdapter = {
    id: "another-explorer-read-model",
    label: "Another explorer read model",
    capabilities: canonical.capabilities,
    listModels: canonical.listModels,
    getModelDetail: canonical.getModelDetail,
    compareModels: canonical.compareModels,
  };

  setModelExplorerAdapter(other);
  assert.equal(getModelExplorerAdapter().id, "another-explorer-read-model");
  const listed = await getModelExplorerAdapter().listModels();
  assert.ok(listed.models.some((row) => row.identity.canonicalId === "openai:gpt-5"));

  setModelExplorerAdapter(null);
});

test("canonical adapter: projectExplorerRow keeps tri-state capabilities intact", async () => {
  const { entries } = await getModelExplorer({
    port: new InMemoryModelExplorerReadPort(explorerData()),
    now,
  });
  const sonnet = entries.find((entry) => entry.canonicalModelId === CLAUDE_SONNET_5.id);
  assert.ok(sonnet);

  const row = projectExplorerRow(sonnet, NOW, false);
  assert.equal(row.vision.observed, null);
  assert.equal(row.toolCalling.observed, true);
  assert.equal(row.identity.canonicalId, "anthropic:claude-sonnet-5");
  assert.equal(row.lifecycle.isActive, true);
});
