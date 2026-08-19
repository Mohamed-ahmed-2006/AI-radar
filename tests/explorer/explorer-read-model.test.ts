import test from "node:test";
import assert from "node:assert/strict";

import {
  InMemoryModelExplorerReadPort,
  getModelExplorer,
} from "../../lib/explorer";
import {
  CLAUDE_3_OPUS,
  CLAUDE_SONNET_5,
  GEMINI_3_PRO,
  GEMINI_25_FLASH,
  GEMINI_25_FLASH_PREVIEW,
  GEMINI_IMAGEN,
  GPT_5,
  GROK_4,
  OPENAI_CATALOG_SOURCE,
  OPENAI_PRICING_SOURCE,
  capability,
  explorerData,
  minutesAgo,
  model,
  now,
  pricing,
  GOOGLE,
  GEMINI_PRICING_SOURCE,
} from "./support/fixtures";

function portWith(overrides: Partial<ReturnType<typeof explorerData>> = {}) {
  return new InMemoryModelExplorerReadPort({ ...explorerData(), ...overrides });
}

async function entries(port = portWith()) {
  const result = await getModelExplorer({ port, now });
  return result.entries;
}

function byId(list: Awaited<ReturnType<typeof entries>>, id: string) {
  const entry = list.find((candidate) => candidate.canonicalModelId === id);
  assert.ok(entry, `expected an entry for ${id}`);
  return entry;
}

test("Explorer: every canonical model across providers is listed, keyed by canonical id", async () => {
  const result = await getModelExplorer({ port: portWith(), now });

  assert.equal(result.totalCount, 8);
  assert.equal(result.filteredCount, 8);
  assert.deepEqual(
    [...new Set(result.entries.map((entry) => entry.provider.slug))].sort(),
    ["anthropic", "gemini", "openai", "xai"],
  );
  // Canonical id is the identity; nothing is keyed on a display name.
  assert.equal(new Set(result.entries.map((entry) => entry.canonicalModelId)).size, 8);

  const gpt5 = byId(result.entries, GPT_5.id);
  assert.equal(gpt5.provider.name, "OpenAI");
  assert.equal(gpt5.apiModelId, "gpt-5");
  assert.equal(gpt5.displayName, "GPT-5");
  assert.equal(gpt5.family, "gpt-5");
  assert.equal(gpt5.stage, "stable");
  assert.deepEqual(gpt5.evidenceDomains, ["pricing", "capability"]);
});

test("Explorer: the primary tier is the standard/default one, and every tier stays visible", async () => {
  const gpt5 = byId(await entries(), GPT_5.id);

  assert.equal(gpt5.pricing.primary?.pricingMode, "standard");
  assert.equal(gpt5.pricing.primary?.contextTier, "default");
  assert.equal(gpt5.pricing.primary?.inputPricePer1MTokens, 1.25);
  assert.equal(gpt5.pricing.primary?.outputPricePer1MTokens, 10);
  assert.equal(gpt5.pricing.primary?.cachedInputPricePer1MTokens, 0.125);
  assert.equal(gpt5.pricing.primary?.currency, "USD");
  assert.equal(gpt5.pricing.primary?.unit, "1M tokens");

  // The superseded observation is history, not current evidence.
  assert.equal(gpt5.pricing.tiers.length, 2);
  assert.deepEqual(
    gpt5.pricing.tiers.map((tier) => tier.contextTier).sort(),
    ["default", "long_context"],
  );
  assert.ok(!gpt5.pricing.tiers.some((tier) => tier.snapshotId === "price-gpt5-old"));
});

test("Explorer: capability evidence carries context, limits and modalities", async () => {
  const gpt5 = byId(await entries(), GPT_5.id);

  assert.equal(gpt5.capabilities.contextWindow, 400_000);
  assert.equal(gpt5.capabilities.maxOutputTokens, 128_000);
  assert.equal(gpt5.capabilities.supportsVision, true);
  assert.equal(gpt5.capabilities.supportsToolCalling, true);
  assert.deepEqual(gpt5.capabilities.inputModalities, ["text", "image"]);
  assert.deepEqual(gpt5.capabilities.outputModalities, ["text"]);
  assert.equal(gpt5.capabilities.conflicted, false);
});

test("Explorer: unknown capability stays null and is never reported as false", async () => {
  const list = await entries();

  // Nobody published vision support for Sonnet 5.
  const sonnet = byId(list, CLAUDE_SONNET_5.id);
  assert.equal(sonnet.capabilities.supportsVision, null);
  assert.equal(sonnet.capabilities.supportsToolCalling, true);

  // xAI published that Grok 4 has no vision: an observation, not an absence.
  const grok = byId(list, GROK_4.id);
  assert.equal(grok.capabilities.supportsVision, false);

  // Gemini 3 Pro has no catalog evidence at all.
  const geminiPro = byId(list, GEMINI_3_PRO.id);
  assert.equal(geminiPro.capabilities.supportsVision, null);
  assert.equal(geminiPro.capabilities.supportsToolCalling, null);
  assert.equal(geminiPro.capabilities.contextWindow, null);
  assert.equal(geminiPro.capabilities.maxOutputTokens, null);
  assert.deepEqual(geminiPro.capabilities.inputModalities, []);
});

test("Explorer: a model with prices but no catalog entry is listed with unknown capabilities", async () => {
  const geminiPro = byId(await entries(), GEMINI_3_PRO.id);

  assert.equal(geminiPro.pricing.primary?.inputPricePer1MTokens, 2);
  assert.equal(geminiPro.pricing.primary?.outputPricePer1MTokens, 12);
  assert.deepEqual(geminiPro.evidenceDomains, ["pricing"]);
  assert.equal(geminiPro.capabilities.observedAt, null);
  assert.equal(geminiPro.provenance.capability, null);
  assert.ok(geminiPro.provenance.pricing);
});

test("Explorer: a model with catalog evidence but no price is listed with unknown pricing", async () => {
  const grok = byId(await entries(), GROK_4.id);

  assert.equal(grok.pricing.primary, null);
  assert.deepEqual(grok.pricing.tiers, []);
  assert.equal(grok.provenance.pricing, null);
  assert.deepEqual(grok.evidenceDomains, ["capability"]);
  assert.equal(grok.capabilities.contextWindow, 256_000);
});

test("Explorer: catalog absence never changes lifecycle", async () => {
  const data = explorerData();
  const list = await entries();

  // Claude 3 Opus is absent from every catalog page and still deprecated,
  // with the dates and replacement its lifecycle source published.
  assert.ok(
    !data.capabilitySnapshots.some((row) => row.model_id === CLAUDE_3_OPUS.id),
    "fixture must keep Opus out of the catalog",
  );
  const opus = byId(list, CLAUDE_3_OPUS.id);
  assert.equal(opus.lifecycle.state, "deprecated");
  assert.equal(opus.lifecycle.deprecationDate, "2026-01-21");
  assert.equal(opus.lifecycle.retirementDate, "2026-03-01");
  assert.equal(opus.lifecycle.recommendedReplacement, "claude-sonnet-5");
  assert.equal(opus.lifecycle.recommendedReplacementModelId, CLAUDE_SONNET_5.id);
  assert.equal(opus.lifecycle.endOfLife, true);
  assert.equal(opus.capabilities.contextWindow, null);

  // And a model that only a catalog page describes is not thereby active.
  const grok = byId(list, GROK_4.id);
  assert.equal(grok.lifecycle.state, null);
  assert.equal(grok.lifecycle.endOfLife, false);
  assert.equal(grok.lifecycle.provenance, null);
});

test("Explorer: dropping a model from the catalog leaves its lifecycle untouched", async () => {
  const data = explorerData();
  const withoutCatalog = portWith({
    capabilitySnapshots: data.capabilitySnapshots.filter(
      (row) => row.model_id !== GEMINI_25_FLASH.id,
    ),
  });

  const flash = byId(await entries(withoutCatalog), GEMINI_25_FLASH.id);
  assert.equal(flash.lifecycle.state, "active");
  assert.equal(flash.capabilities.contextWindow, null);
  assert.equal(flash.capabilities.conflicted, false);
  assert.deepEqual(flash.evidenceDomains, ["pricing"]);
});

test("Explorer: preview and stable variants stay separate models", async () => {
  const list = await entries();

  const stable = byId(list, GEMINI_25_FLASH.id);
  const preview = byId(list, GEMINI_25_FLASH_PREVIEW.id);

  assert.notEqual(stable.canonicalModelId, preview.canonicalModelId);
  assert.equal(stable.apiModelId, "gemini-2.5-flash");
  assert.equal(preview.apiModelId, "gemini-2.5-flash-preview-09-2025");
  assert.equal(stable.stage, "stable");
  assert.equal(preview.stage, "preview");
  // They share a family but never share evidence.
  assert.equal(stable.family, preview.family);
  assert.equal(stable.capabilities.contextWindow, 1_000_000);
  assert.equal(preview.capabilities.contextWindow, 32_768);
  assert.equal(stable.lifecycle.state, "active");
  assert.equal(preview.lifecycle.state, "deprecated");
  assert.equal(preview.lifecycle.retirementNotBeforeDate, "2026-09-30");
  assert.equal(preview.lifecycle.retirementNotBeforeObservation, "date");
});

test("Explorer: a conflicted Gemini identity withholds capability evidence entirely", async () => {
  const imagen = byId(await entries(), GEMINI_IMAGEN.id);

  // Two API ids claim this canonical model with different evidence. Neither is
  // chosen, and nothing is merged into a compound identity.
  assert.equal(imagen.capabilities.conflicted, true);
  assert.equal(imagen.capabilities.apiModelId, null);
  assert.equal(imagen.apiModelId, null);
  assert.equal(imagen.capabilities.contextWindow, null);
  assert.equal(imagen.capabilities.supportsVision, null);
  assert.deepEqual(imagen.capabilities.outputModalities, []);
  assert.equal(imagen.capabilities.provenance, null);
  assert.ok(!imagen.evidenceDomains.includes("capability"));

  // The conflict is confined to capabilities; lifecycle is untouched.
  assert.equal(imagen.lifecycle.state, "active");
});

test("Explorer: repeated evidence for one model collapses instead of conflicting", async () => {
  const data = explorerData();
  const duplicated = portWith({
    capabilitySnapshots: [
      ...data.capabilitySnapshots.filter((row) => row.model_id !== GPT_5.id),
      ...data.capabilitySnapshots
        .filter((row) => row.model_id === GPT_5.id)
        .flatMap((row) => [
          row,
          // Same evidence, published again under the dated snapshot id.
          capability({
            ...row,
            id: "cap-gpt5-dated",
            api_model_id: "gpt-5-2026-01-15",
            observed_at: minutesAgo(44),
          }),
        ]),
    ],
  });

  const gpt5 = byId(await entries(duplicated), GPT_5.id);
  assert.equal(gpt5.capabilities.conflicted, false);
  assert.equal(gpt5.capabilities.contextWindow, 400_000);
  assert.equal(gpt5.apiModelId, "gpt-5-2026-01-15");
});

test("Explorer: evidence from a failed run is not current truth", async () => {
  const data = explorerData();
  const failed = portWith({
    runStatuses: { [`run-${OPENAI_CATALOG_SOURCE.id}`]: "failed" },
  });
  assert.ok(
    data.capabilitySnapshots.some((row) => row.source_id === OPENAI_CATALOG_SOURCE.id),
    "fixture must have catalog rows from that run",
  );

  const gpt5 = byId(await entries(failed), GPT_5.id);
  assert.equal(gpt5.capabilities.contextWindow, null);
  assert.equal(gpt5.capabilities.conflicted, false);
  // Pricing came from a different run and is unaffected.
  assert.equal(gpt5.pricing.primary?.inputPricePer1MTokens, 1.25);
});

test("Explorer: every evidence domain carries its own provenance and freshness", async () => {
  const list = await entries();

  const gpt5 = byId(list, GPT_5.id);
  const pricingProvenance = gpt5.provenance.pricing;
  assert.ok(pricingProvenance);
  assert.equal(pricingProvenance.sourceLabel, "OpenAI pricing page");
  assert.equal(pricingProvenance.sourceUrl, OPENAI_PRICING_SOURCE.source_url);
  assert.equal(pricingProvenance.sourceKind, "pricing");
  assert.equal(pricingProvenance.collectorId, "c_openai_pricing");
  assert.equal(pricingProvenance.snapshotId, "price-gpt5");
  assert.equal(pricingProvenance.externalRunId, "bd_openai_pricing_run");
  assert.equal(pricingProvenance.observedAt, minutesAgo(60));
  // A pricing page is validated, but it is not an authority on model inventory.
  assert.equal(pricingProvenance.authority, "verified_scrape");
  assert.equal(pricingProvenance.trust, "verified");

  const capabilityProvenance = gpt5.provenance.capability;
  assert.ok(capabilityProvenance);
  assert.equal(capabilityProvenance.sourceKind, "models");
  assert.equal(capabilityProvenance.snapshotId, "cap-gpt5");
  assert.equal(capabilityProvenance.sourceUrl, "https://platform.openai.com/docs/models/gpt-5");
  assert.equal(capabilityProvenance.authority, "authoritative");
  assert.equal(capabilityProvenance.trust, "official");

  // Freshness is the newest observation across domains, per domain as well.
  assert.equal(gpt5.freshness.lastVerifiedAt, minutesAgo(45));
  assert.equal(gpt5.freshness.ageMinutes, 45);
  assert.deepEqual(gpt5.freshness.byDomain, {
    pricing: minutesAgo(60),
    capability: minutesAgo(45),
    lifecycle: null,
  });

  const opus = byId(list, CLAUDE_3_OPUS.id);
  const lifecycleProvenance = opus.provenance.lifecycle;
  assert.ok(lifecycleProvenance);
  assert.equal(lifecycleProvenance.sourceKind, "lifecycle");
  assert.equal(lifecycleProvenance.authority, "authoritative");
  assert.equal(lifecycleProvenance.externalRunId, "bd_anthropic_lifecycle_run");
  assert.equal(lifecycleProvenance.snapshotId, "life-opus3");
});

test("Explorer: a model with no evidence at all is still listed, with nothing invented", async () => {
  const data = explorerData();
  const bare = model({
    id: "model-bare",
    provider_id: GOOGLE.id,
    model_name: "gemini-experimental",
  });
  const port = portWith({ models: [...data.models, bare] });

  const entry = byId(await entries(port), bare.id);
  assert.equal(entry.pricing.primary, null);
  assert.equal(entry.capabilities.supportsVision, null);
  assert.equal(entry.lifecycle.state, null);
  assert.deepEqual(entry.evidenceDomains, []);
  assert.equal(entry.freshness.lastVerifiedAt, null);
  assert.equal(entry.freshness.ageMinutes, null);
});

test("Explorer: facets count the unfiltered set", async () => {
  const result = await getModelExplorer({
    port: portWith(),
    now,
    filters: { providers: ["openai"] },
  });

  assert.equal(result.entries.length, 1);
  assert.equal(result.filteredCount, 1);
  assert.equal(result.totalCount, 8);
  assert.deepEqual(
    result.facets.providers.map((facet) => [facet.slug, facet.count]),
    [
      ["anthropic", 2],
      ["gemini", 4],
      ["openai", 1],
      ["xai", 1],
    ],
  );
  assert.deepEqual(
    result.facets.lifecycleStates.map((facet) => [facet.state, facet.count]),
    [
      ["active", 3],
      ["deprecated", 2],
    ],
  );
});

test("Explorer: sorting puts unknown values last in either direction", async () => {
  const ascending = await getModelExplorer({
    port: portWith(),
    now,
    sort: "input_price",
  });
  const prices = ascending.entries.map(
    (entry) => entry.pricing.primary?.inputPricePer1MTokens ?? null,
  );
  assert.deepEqual(prices, [0.15, 0.3, 1.25, 2, 3, 15, null, null]);

  const byContext = await getModelExplorer({
    port: portWith(),
    now,
    sort: "context_window",
  });
  const contexts = byContext.entries.map((entry) => entry.capabilities.contextWindow);
  assert.deepEqual(contexts, [1_000_000, 400_000, 256_000, 200_000, 32_768, null, null, null]);
});

test("Explorer: limit trims the page without distorting the counts", async () => {
  const result = await getModelExplorer({ port: portWith(), now, limit: 3 });

  assert.equal(result.entries.length, 3);
  assert.equal(result.filteredCount, 8);
  assert.equal(result.totalCount, 8);
  assert.equal(result.generatedAt, "2026-08-19T12:00:00.000Z");
});

test("Explorer: a newer price observation supersedes an older one", async () => {
  const data = explorerData();
  const port = portWith({
    pricingSnapshots: [
      ...data.pricingSnapshots,
      pricing({
        id: "price-gemini3pro-newer",
        model_id: GEMINI_3_PRO.id,
        provider_id: GOOGLE.id,
        source_id: GEMINI_PRICING_SOURCE.id,
        input_price_per_1m_tokens: 1.75,
        output_price_per_1m_tokens: 10,
        observed_at: minutesAgo(5),
      }),
    ],
  });

  const geminiPro = byId(await entries(port), GEMINI_3_PRO.id);
  assert.equal(geminiPro.pricing.primary?.inputPricePer1MTokens, 1.75);
  assert.equal(geminiPro.pricing.tiers.length, 1);
  assert.equal(geminiPro.freshness.byDomain.pricing, minutesAgo(5));
});
