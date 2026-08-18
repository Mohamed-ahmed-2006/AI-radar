import test from "node:test";
import assert from "node:assert/strict";

import {
  EvidenceBundleSchema,
  EcosystemSignificanceSummarySchema,
  PriceDeltaSchema,
  ProviderComparisonResultSchema,
  TemporalEvidenceSchema,
  TemporalQuerySchema,
} from "../../lib/intelligence/contracts";

test("TemporalEvidenceSchema validates complete structured evidence", () => {
  const validEvidence = {
    id: "test-ev-1",
    provider: "anthropic",
    providerName: "Anthropic",
    model: "claude-3-5-sonnet-20241022",
    displayName: "Claude 3.5 Sonnet",
    changeType: "price_decreased",
    category: "pricing",
    field: "cachedInputPricePer1MTokens",
    pricingMode: "standard",
    contextTier: "default",
    previousValue: 3.0,
    currentValue: 0.3,
    priceDelta: {
      previousPrice: 3.0,
      currentPrice: 0.3,
      absoluteChange: -2.7,
      percentChange: -90.0,
      unit: "USD per 1M tokens",
      field: "cachedInputPricePer1MTokens",
    },
    observedAt: "2026-08-11T09:15:00.000Z",
    source: {
      url: "https://www.anthropic.com/pricing",
      collectorId: "c_msx3bqlyjtv2qustx",
      kind: "pricing",
      label: "Anthropic official API pricing",
    },
    provenance: {
      runId: "run-123",
      externalRunId: "ext-456",
      previousSnapshotId: "snap-1",
      currentSnapshotId: "snap-2",
    },
    authority: "authoritative",
    confidence: 1.0,
    significanceScore: 92,
    summary: "Prompt caching enabled for Claude 3.5 Sonnet: cached input price dropped 90.0%.",
    isDemo: false,
  };

  const parsed = TemporalEvidenceSchema.parse(validEvidence);
  assert.equal(parsed.id, "test-ev-1");
  assert.equal(parsed.provider, "anthropic");
  assert.equal(parsed.authority, "authoritative");
  assert.equal(parsed.priceDelta?.percentChange, -90.0);
});

test("TemporalQuerySchema validates default and custom query options", () => {
  const defaultQuery = TemporalQuerySchema.parse({});
  assert.equal(defaultQuery.range, "30d");
  assert.equal(defaultQuery.limit, 100);
  assert.equal(defaultQuery.sort, "desc");
  assert.equal(defaultQuery.significantOnly, false);

  const customQuery = TemporalQuerySchema.parse({
    provider: "anthropic",
    range: "7d",
    significantOnly: true,
    minSignificance: 85,
    sort: "asc",
    demo: true,
  });
  assert.equal(customQuery.provider, "anthropic");
  assert.equal(customQuery.range, "7d");
  assert.equal(customQuery.significantOnly, true);
  assert.equal(customQuery.minSignificance, 85);
  assert.equal(customQuery.demo, true);
});

test("PriceDeltaSchema validates exact delta structure", () => {
  const delta = PriceDeltaSchema.parse({
    previousPrice: 5.0,
    currentPrice: 2.5,
    absoluteChange: -2.5,
    percentChange: -50.0,
    unit: "USD per 1M tokens",
    field: "inputPricePer1MTokens",
  });
  assert.equal(delta.percentChange, -50.0);
  assert.equal(delta.absoluteChange, -2.5);
});

test("EvidenceBundleSchema validates complete bundle response", () => {
  const bundle = EvidenceBundleSchema.parse({
    query: { range: "30d" },
    generatedAt: "2026-08-18T12:00:00.000Z",
    totalEvents: 0,
    events: [],
    metrics: {
      totalEvents: 0,
      priceIncreases: 0,
      priceDecreases: 0,
      modelsAdded: 0,
      modelsRemoved: 0,
      lifecycleTransitions: 0,
      deprecationsScheduled: 0,
      retirementsScheduled: 0,
      replacementsAnnounced: 0,
      byProvider: {},
      byCategory: {},
    },
    timeline: [],
    deltaSummary: [],
    isDemoData: false,
  });
  assert.equal(bundle.totalEvents, 0);
  assert.equal(bundle.isDemoData, false);
});

test("ProviderComparisonResultSchema and EcosystemSignificanceSummarySchema validate structured schemas", () => {
  const comp = ProviderComparisonResultSchema.parse({
    range: "30d",
    timeframe: { since: "2026-08-01T00:00:00.000Z", until: "2026-08-18T00:00:00.000Z" },
    providers: {},
    comparisonHighlights: ["Highlights"],
    isDemoData: false,
  });
  assert.equal(comp.range, "30d");

  const sig = EcosystemSignificanceSummarySchema.parse({
    range: "30d",
    timeframe: { since: "2026-08-01T00:00:00.000Z", until: "2026-08-18T00:00:00.000Z" },
    topChanges: [],
    headline: "Ecosystem headline",
    isDemoData: false,
  });
  assert.equal(sig.headline, "Ecosystem headline");
});

