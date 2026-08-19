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
  CATALOG_EXPLORER_ADAPTER_ID,
  catalogFiltersFromExplorer,
  createCatalogExplorerAdapter,
  freshnessFromObservation,
  matchesRemainingExplorerFilters,
  pickComparablePricing,
  projectExplorerRow,
  STALE_AFTER_MS,
} from "../../lib/product/explorer-catalog";
import {
  capabilityView,
  catalogDetail,
  changeEvent,
  NOW,
  pricingRow,
} from "./support/explorer-fixtures";

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

test("catalog adapter: unknown vision stays unknown on the explorer row", () => {
  const row = projectExplorerRow({
    model: capabilityView({ supportsVision: null, supportsToolCalling: false }),
    pricing: [pricingRow()],
    lifecycle: null,
    now: NOW,
    sourceDegraded: false,
  });

  assert.equal(row.vision.observed, null);
  assert.equal(row.vision.label, "Unknown");
  assert.equal(row.toolCalling.observed, false);
  assert.equal(row.toolCalling.label, "Not supported");
  assert.equal(row.identity.canonicalId, "anthropic:claude-sonnet-4-5");
  assert.equal(row.inputPrice, 3);
});

test("catalog adapter: stale and degraded freshness are labelled, not invented", () => {
  const staleAt = new Date(NOW.getTime() - STALE_AFTER_MS - 1).toISOString();
  const stale = freshnessFromObservation(staleAt, NOW, false);
  assert.equal(stale.quality, "stale");
  assert.equal(stale.label, "Stale");

  const unknown = freshnessFromObservation(null, NOW, false);
  assert.equal(unknown.quality, "unknown");
  assert.match(unknown.description, /No observation time/);

  const degraded = freshnessFromObservation(staleAt, NOW, true);
  assert.equal(degraded.quality, "degraded");
  assert.equal(degraded.label, "Degraded");
});

test("catalog adapter: comparable price prefers standard / short / default tiers", () => {
  const long = pricingRow({ context_tier: "long", input_price_per_1m_tokens: 6 });
  const standard = pricingRow({ id: "price-std", context_tier: "standard", input_price_per_1m_tokens: 3 });
  const picked = pickComparablePricing([long, standard]);
  assert.equal(picked?.input_price_per_1m_tokens, 3);
  assert.equal(pickComparablePricing([]), null);
});

test("catalog adapter: remaining filters do not treat unknown prices as under a ceiling", () => {
  const priced = {
    inputPrice: 3,
    outputPrice: 15,
    lifecycle: {
      state: "active" as const,
      label: "Active",
      isActive: true,
      deprecatedOn: null,
      retirementDate: null,
      retirementNotBefore: null,
    },
  };
  const unknownPrice = { ...priced, inputPrice: null };

  assert.equal(
    matchesRemainingExplorerFilters(priced, { ...DEFAULT_EXPLORER_FILTERS, maxInputPrice: 5 }),
    true,
  );
  assert.equal(
    matchesRemainingExplorerFilters(priced, { ...DEFAULT_EXPLORER_FILTERS, maxInputPrice: 2 }),
    false,
  );
  assert.equal(
    matchesRemainingExplorerFilters(unknownPrice, {
      ...DEFAULT_EXPLORER_FILTERS,
      maxInputPrice: 5,
    }),
    false,
  );
  assert.equal(
    matchesRemainingExplorerFilters(priced, { ...DEFAULT_EXPLORER_FILTERS, activeOnly: true }),
    true,
  );
  assert.equal(
    matchesRemainingExplorerFilters(
      { ...priced, lifecycle: { ...priced.lifecycle, isActive: false, state: "retired" } },
      { ...DEFAULT_EXPLORER_FILTERS, activeOnly: true },
    ),
    false,
  );
});

test("catalog adapter: vision/tools/context are passed through to the catalog read model", () => {
  const mapped = catalogFiltersFromExplorer({
    ...DEFAULT_EXPLORER_FILTERS,
    provider: "openai",
    visionRequired: true,
    toolCallingRequired: true,
    minContext: 128000,
    maxInputPrice: 5,
  });
  assert.deepEqual(mapped, {
    providerSlug: "openai",
    supportsVision: true,
    supportsToolCalling: true,
    minContextWindow: 128000,
  });
});

test("catalog adapter: lists, details, compares, and leaves missing ids unnamed", async () => {
  const unknownVision = capabilityView({
    modelId: "m-text",
    apiModelId: "claude-haiku",
    modelName: "claude-haiku",
    displayName: "Claude Haiku",
    supportsVision: null,
    supportsToolCalling: false,
    contextWindow: 200000,
  });
  const expensive = capabilityView({
    modelId: "m-opus",
    apiModelId: "claude-opus",
    modelName: "claude-opus",
    displayName: "Claude Opus",
    supportsVision: true,
  });

  const adapter = createCatalogExplorerAdapter({
    configured: true,
    now: () => NOW,
    listCapabilities: async (filters) => {
      const all = [capabilityView(), unknownVision, expensive];
      return all.filter((model) => {
        if (filters?.supportsVision === true && model.supportsVision !== true) return false;
        return true;
      });
    },
    listPricing: async () => [
      pricingRow(),
      pricingRow({
        model_id: "m-text",
        input_price_per_1m_tokens: 0.8,
        output_price_per_1m_tokens: 4,
      }),
      pricingRow({
        model_id: "m-opus",
        input_price_per_1m_tokens: 15,
        output_price_per_1m_tokens: 75,
      }),
    ],
    getDetail: async (modelId) => {
      const model = [capabilityView(), unknownVision, expensive].find((item) => item.modelId === modelId);
      if (!model) return null;
      return catalogDetail(model, {
        recentChangeEvents: modelId === "m-sonnet" ? [changeEvent()] : [],
        capabilityHistory: [],
      });
    },
  });

  const listed = await adapter.listModels(DEFAULT_EXPLORER_FILTERS);
  assert.equal(listed.models.length, 3);
  const unknown = listed.models.find((row) => row.identity.canonicalId === "anthropic:claude-haiku");
  assert.equal(unknown?.vision.label, "Unknown");
  assert.equal(unknown?.toolCalling.label, "Not supported");

  const capped = await adapter.listModels({ ...DEFAULT_EXPLORER_FILTERS, maxInputPrice: 5 });
  assert.equal(capped.models.length, 2);
  assert.ok(capped.models.every((row) => row.inputPrice !== null && row.inputPrice <= 5));

  const visionOnly = await adapter.listModels({
    ...DEFAULT_EXPLORER_FILTERS,
    visionRequired: true,
  });
  assert.ok(visionOnly.models.every((row) => row.vision.observed === true));
  assert.equal(
    visionOnly.models.some((row) => row.identity.canonicalId === "anthropic:claude-haiku"),
    false,
  );

  const detail = await adapter.getModelDetail("anthropic:claude-sonnet-4-5");
  assert(detail);
  assert.equal(detail.identity.canonicalId, "anthropic:claude-sonnet-4-5");
  assert(detail.pricing.available);
  assert.equal(detail.replacement.available, false);
  if (!detail.replacement.available) {
    assert.match(detail.replacement.reason, /No replacement has been observed/);
  }
  assert(detail.recentChanges.available);
  assert.equal(detail.recentChanges.data[0].changeType, "price_decreased");
  assert.equal(detail.history.available, false);

  const comparison = await adapter.compareModels([
    "anthropic:claude-sonnet-4-5",
    "missing:model",
  ]);
  assert.equal(comparison.columns.length, 1);
  assert.deepEqual(comparison.missingIds, ["missing:model"]);
  assert.equal(comparison.columns[0].identity.canonicalId, "anthropic:claude-sonnet-4-5");
});

test("catalog adapter: unconfigured environments return an empty catalog rather than fixtures", async () => {
  const adapter = createCatalogExplorerAdapter({
    configured: false,
    listCapabilities: async () => {
      throw new Error("should not load");
    },
    listPricing: async () => [],
    getDetail: async () => null,
  });

  const catalog = await adapter.listModels();
  assert.equal(catalog.models.length, 0);
  assert.match(catalog.evidenceNote ?? "", /not configured/i);
  assert.equal(await adapter.getModelDetail("anthropic:claude-sonnet-4-5"), null);
});

test("explorer seam: a richer adapter can replace the catalog one wholesale", async () => {
  const catalog = createCatalogExplorerAdapter({
    configured: true,
    now: () => NOW,
    listCapabilities: async () => [capabilityView()],
    listPricing: async () => [pricingRow()],
    getDetail: async () => catalogDetail(),
  });

  setModelExplorerAdapter(catalog);
  assert.equal(getModelExplorerAdapter().id, CATALOG_EXPLORER_ADAPTER_ID);

  const richer: ModelExplorerAdapter = {
    id: "richer-explorer-read-model",
    label: "Richer explorer read model",
    capabilities: catalog.capabilities,
    listModels: catalog.listModels,
    getModelDetail: catalog.getModelDetail,
    compareModels: catalog.compareModels,
  };

  setModelExplorerAdapter(richer);
  assert.equal(getModelExplorerAdapter().id, "richer-explorer-read-model");
  const listed = await getModelExplorerAdapter().listModels();
  assert.equal(listed.models[0]?.identity.canonicalId, "anthropic:claude-sonnet-4-5");

  setModelExplorerAdapter(null);
});
