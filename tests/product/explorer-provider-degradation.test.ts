/**
 * Provider isolation for model freshness, exercised through the adapter.
 *
 * The contamination bug — one provider's degraded collection marking every
 * provider's models Degraded — was fixed by scoping degradation to the
 * providers whose own sources are degraded. `degradedProviderIds` is unit
 * tested elsewhere, but the pure helper is not where a regression would
 * reappear: it would reappear in the *wiring*, the moment someone collapses the
 * per-provider lookup back into a single boolean, e.g.
 *
 *     projectExplorerRow(entry, now, degraded.size > 0)
 *
 * That mistake leaves the helper's own tests green. So these tests drive the
 * real `createCanonicalExplorerAdapter` over the real read model, with a source
 * health fleet in which exactly one provider is degraded, and assert on the
 * projected rows every `/models` surface renders: the catalog, the detail page
 * and the compare table.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  compareModels,
  getModelDetail,
  getModelExplorer,
  InMemoryModelExplorerReadPort,
  type ModelExplorerFilters as CanonicalExplorerFilters,
} from "../../lib/explorer";
import { createCanonicalExplorerAdapter } from "../../lib/product/explorer-read-model";
import { DEFAULT_EXPLORER_FILTERS } from "../../lib/product/explorer";
import type { SourceHealthRow } from "../../lib/supabase/types";
import {
  ANTHROPIC,
  ANTHROPIC_CATALOG_SOURCE,
  ANTHROPIC_LIFECYCLE_SOURCE,
  ANTHROPIC_PRICING_SOURCE,
  explorerData,
  GEMINI_CATALOG_SOURCE,
  GEMINI_PRICING_SOURCE,
  GOOGLE,
  now,
  OPENAI,
  OPENAI_CATALOG_SOURCE,
  OPENAI_PRICING_SOURCE,
  XAI,
  XAI_CATALOG_SOURCE,
} from "../explorer/support/fixtures";

type RunStatus = SourceHealthRow["last_run_status"];

function health(
  source: { id: string; provider_id: string; kind: SourceHealthRow["kind"]; collector_id: string | null; source_url: string },
  status: RunStatus,
  isActive = true,
): SourceHealthRow {
  return {
    source_id: source.id,
    provider_id: source.provider_id,
    kind: source.kind,
    collector_id: source.collector_id,
    source_url: source.source_url,
    is_active: isActive,
    last_run_id: `run-${source.id}`,
    last_run_status: status,
    last_run_started_at: "2026-08-19T11:00:00.000Z",
    last_run_completed_at: "2026-08-19T11:01:00.000Z",
    records_seen: 10,
    records_accepted: status === "succeeded" ? 10 : 4,
    records_rejected: status === "succeeded" ? 0 : 6,
    error_message: null,
  };
}

/**
 * Production's actual shape at the time of the report: every provider healthy
 * except the Gemini catalog, whose run genuinely came back partial.
 */
const FLEET_WITH_GEMINI_DEGRADED: SourceHealthRow[] = [
  health(OPENAI_PRICING_SOURCE, "succeeded"),
  health(OPENAI_CATALOG_SOURCE, "succeeded"),
  health(ANTHROPIC_PRICING_SOURCE, "succeeded"),
  health(ANTHROPIC_CATALOG_SOURCE, "succeeded"),
  health(ANTHROPIC_LIFECYCLE_SOURCE, "succeeded"),
  health(GEMINI_PRICING_SOURCE, "succeeded"),
  health(GEMINI_CATALOG_SOURCE, "partial"),
  health(XAI_CATALOG_SOURCE, "succeeded"),
];

function adapter(sourceHealth: readonly SourceHealthRow[]) {
  const port = new InMemoryModelExplorerReadPort(explorerData());
  return createCanonicalExplorerAdapter({
    listExplorer: (filters?: CanonicalExplorerFilters) =>
      getModelExplorer({ port, now, filters }),
    getDetail: (modelId: string) => getModelDetail(modelId, { port, now }),
    compare: (modelIds: readonly string[]) => compareModels(modelIds, { port, now }),
    listSourceHealth: async () => [...sourceHealth],
    now,
  });
}

const PROVIDER_NAME_BY_SLUG: Record<string, string> = {
  [OPENAI.slug]: OPENAI.name,
  [ANTHROPIC.slug]: ANTHROPIC.name,
  [GOOGLE.slug]: GOOGLE.name,
  [XAI.slug]: XAI.name,
};

test("catalog: a degraded Gemini catalog degrades Gemini models and nothing else", async () => {
  const catalog = await adapter(FLEET_WITH_GEMINI_DEGRADED).listModels(
    DEFAULT_EXPLORER_FILTERS,
  );

  assert.ok(catalog.models.length > 0, "the fixture catalog should not be empty");

  const degradedSlugs = new Set(
    catalog.models
      .filter((model) => model.freshness.quality === "degraded")
      .map((model) => model.identity.providerSlug),
  );
  assert.deepEqual([...degradedSlugs], [GOOGLE.slug]);

  // Stated the other way round, so the assertion names the actual regression.
  for (const model of catalog.models) {
    if (model.identity.providerSlug === GOOGLE.slug) continue;
    assert.notEqual(
      model.freshness.quality,
      "degraded",
      `${PROVIDER_NAME_BY_SLUG[model.identity.providerSlug]} model `
        + `${model.identity.displayName} must not be degraded by another provider`,
    );
  }

  // Every Gemini model is degraded — the degradation is truthful, not dropped.
  const gemini = catalog.models.filter(
    (model) => model.identity.providerSlug === GOOGLE.slug,
  );
  assert.ok(gemini.length > 0, "the fixture should carry Gemini models");
  for (const model of gemini) {
    assert.equal(model.freshness.quality, "degraded");
  }
});

test("catalog: an all-healthy fleet degrades nobody", async () => {
  const healthy = FLEET_WITH_GEMINI_DEGRADED.map((row) =>
    row.last_run_status === "partial" ? { ...row, last_run_status: "succeeded" as const } : row,
  );
  const catalog = await adapter(healthy).listModels(DEFAULT_EXPLORER_FILTERS);

  for (const model of catalog.models) {
    assert.notEqual(model.freshness.quality, "degraded");
  }
  assert.notEqual(catalog.evidenceQuality, "degraded");
});

test("catalog: the evidence banner reports degradation without flattening the rows", async () => {
  const catalog = await adapter(FLEET_WITH_GEMINI_DEGRADED).listModels(
    DEFAULT_EXPLORER_FILTERS,
  );

  // The banner is truthful: something on screen is degraded.
  assert.equal(catalog.evidenceQuality, "degraded");
  assert.match(catalog.evidenceNote ?? "", /degraded or failed state/i);

  // But it must not be the reason every row reads degraded.
  const current = catalog.models.filter(
    (model) => model.freshness.quality === "current",
  );
  assert.ok(
    current.length > 0,
    "a catalog-level degraded banner must not force every row to degraded",
  );
});

test("catalog: filtering to the healthy provider still reports that provider as current", async () => {
  // Guards the variant where degradation is computed once for the whole fleet
  // and then applied to a filtered result set.
  const anthropicOnly = await adapter(FLEET_WITH_GEMINI_DEGRADED).listModels({
    ...DEFAULT_EXPLORER_FILTERS,
    provider: ANTHROPIC.slug,
  });

  assert.ok(anthropicOnly.models.length > 0);
  for (const model of anthropicOnly.models) {
    assert.equal(model.identity.providerSlug, ANTHROPIC.slug);
    assert.notEqual(model.freshness.quality, "degraded");
  }
  assert.notEqual(anthropicOnly.evidenceQuality, "degraded");
});

test("detail: an Anthropic model detail is current while a Gemini one is degraded", async () => {
  const explorer = adapter(FLEET_WITH_GEMINI_DEGRADED);
  const catalog = await explorer.listModels(DEFAULT_EXPLORER_FILTERS);

  const anthropicId = catalog.models.find(
    (model) => model.identity.providerSlug === ANTHROPIC.slug,
  )?.identity.canonicalId;
  const geminiId = catalog.models.find(
    (model) => model.identity.providerSlug === GOOGLE.slug,
  )?.identity.canonicalId;
  assert.ok(anthropicId && geminiId, "fixture should carry both providers");

  const anthropicDetail = await explorer.getModelDetail(anthropicId);
  const geminiDetail = await explorer.getModelDetail(geminiId);

  assert.ok(anthropicDetail && geminiDetail);
  assert.notEqual(
    anthropicDetail.freshness.quality,
    "degraded",
    "an Anthropic detail page must not inherit Gemini's degradation",
  );
  assert.equal(geminiDetail.freshness.quality, "degraded");
});

test("compare: providers keep their own freshness side by side", async () => {
  const explorer = adapter(FLEET_WITH_GEMINI_DEGRADED);
  const catalog = await explorer.listModels(DEFAULT_EXPLORER_FILTERS);

  const anthropicId = catalog.models.find(
    (model) => model.identity.providerSlug === ANTHROPIC.slug,
  )!.identity.canonicalId;
  const geminiId = catalog.models.find(
    (model) => model.identity.providerSlug === GOOGLE.slug,
  )!.identity.canonicalId;

  const comparison = await explorer.compareModels([anthropicId, geminiId]);

  const byProvider = new Map(
    comparison.columns.map((column) => [column.identity.providerSlug, column]),
  );
  assert.notEqual(byProvider.get(ANTHROPIC.slug)?.freshness.quality, "degraded");
  assert.equal(byProvider.get(GOOGLE.slug)?.freshness.quality, "degraded");
});

test("a deactivated source's frozen failure never degrades the provider it belonged to", async () => {
  // A superseded source keeps its last failed run forever. That run is history,
  // and it must not put its provider's live models into a degraded state.
  const withRetiredAnthropicSource = [
    ...FLEET_WITH_GEMINI_DEGRADED,
    health(
      { ...ANTHROPIC_CATALOG_SOURCE, id: "src-anthropic-catalog-retired" },
      "failed",
      false,
    ),
  ];

  const catalog = await adapter(withRetiredAnthropicSource).listModels(
    DEFAULT_EXPLORER_FILTERS,
  );

  for (const model of catalog.models) {
    if (model.identity.providerSlug === GOOGLE.slug) continue;
    assert.notEqual(model.freshness.quality, "degraded");
  }
});

test("degradation does not turn an unobserved capability into unsupported", async () => {
  // The contamination fix must not disturb the invariant that unknown evidence
  // stays Unknown. Checked on the degraded provider, where it matters most.
  const catalog = await adapter(FLEET_WITH_GEMINI_DEGRADED).listModels(
    DEFAULT_EXPLORER_FILTERS,
  );

  for (const model of catalog.models) {
    for (const capability of [model.vision, model.toolCalling]) {
      if (capability.observed === null) {
        assert.equal(capability.label, "Unknown");
        assert.doesNotMatch(capability.label, /unsupported|not supported/i);
      }
    }
  }
});
