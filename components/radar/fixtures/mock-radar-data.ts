/**
 * MOCK FIXTURE — replace with live API / Supabase data at integration.
 *
 * Represents verified OpenAI collector output (Bright Data Scraper Studio).
 * Import only from dashboard page or data-fetch layer; never hardcode in components.
 */

import type { RadarDashboardData } from "../types";

const FIXTURE_TIMESTAMP = "2026-08-17T10:42:00.000Z";

export const MOCK_RADAR_DATA: RadarDashboardData = {
  isMock: true,
  fixtureVersion: "openai-collector-v0.3.1",

  ecosystem: {
    status: "healthy",
    modelsTracked: 3,
    providersTracked: 1,
    sourcesMonitored: 2,
    changesLast24h: 4,
    priceChangesLast7d: 2,
    lifecycleChangesLast7d: 1,
    activeAlerts: 0,
    lastGlobalRefreshAt: FIXTURE_TIMESTAMP,
  },
  sentinel: {
    available: false,
    unavailableReason: "Fixture dashboard is not connected to live Sentinel.",
    isDemo: true,
    totalSources: null,
    healthy: null,
    degraded: null,
    quarantined: null,
    recovered: null,
    healing: null,
    needsReview: null,
  },

  changes: [
    {
      id: "chg-001",
      type: "price_change",
      provider: "OpenAI",
      model: "gpt-5.6-luna",
      summary: "Output pricing reduced on long-context tier",
      detail: "Long output: $18.00 → $14.40 per 1M tokens (−20%)",
      detectedAt: "2026-08-17T09:15:00.000Z",
      sourceId: "openai-pricing-page",
      severity: "info",
    },
    {
      id: "chg-002",
      type: "model_launch",
      provider: "OpenAI",
      model: "gpt-5.6-sol",
      summary: "New model gpt-5.6-sol added to pricing page",
      detail: "Balanced tier with 256K context window",
      detectedAt: "2026-08-16T14:30:00.000Z",
      sourceId: "openai-pricing-page",
      severity: "info",
    },
    {
      id: "chg-003",
      type: "deprecation",
      provider: "OpenAI",
      model: "gpt-4.5-preview",
      summary: "gpt-4.5-preview scheduled for removal",
      detail: "Deprecation date: 2026-09-30. Not tracked in current matrix.",
      detectedAt: "2026-08-15T11:00:00.000Z",
      sourceId: "openai-pricing-page",
      severity: "warning",
    },
    {
      id: "chg-004",
      type: "source_refresh",
      provider: "OpenAI",
      summary: "Pricing page collection completed successfully",
      detectedAt: FIXTURE_TIMESTAMP,
      sourceId: "openai-pricing-page",
      severity: "info",
    },
    {
      id: "chg-005",
      type: "price_change",
      provider: "OpenAI",
      model: "gpt-5.6-terra",
      summary: "Short-context input pricing increased",
      detail: "Short input: $6.00 → $6.50 per 1M tokens (+8.3%)",
      detectedAt: "2026-08-12T08:45:00.000Z",
      sourceId: "openai-pricing-page",
      severity: "info",
    },
    {
      id: "chg-006",
      type: "schema_update",
      provider: "OpenAI",
      summary: "Collector schema v0.3.1 — added cached-input rate field",
      detectedAt: "2026-08-10T16:20:00.000Z",
      sourceId: "openai-pricing-page",
      severity: "info",
    },
  ],

  models: [
    {
      id: "mdl-sol",
      provider: "OpenAI",
      name: "GPT-5.6 Sol",
      slug: "gpt-5.6-sol",
      status: "active",
      contextWindow: 256_000,
      lastVerifiedAt: FIXTURE_TIMESTAMP,
      rates: [
        {
          tier: "short",
          inputPerMillion: 2.5,
          outputPerMillion: 10.0,
          cachedInputPerMillion: 1.25,
        },
        {
          tier: "long",
          inputPerMillion: 5.0,
          outputPerMillion: 20.0,
          cachedInputPerMillion: 2.5,
        },
      ],
    },
    {
      id: "mdl-terra",
      provider: "OpenAI",
      name: "GPT-5.6 Terra",
      slug: "gpt-5.6-terra",
      status: "active",
      contextWindow: 1_000_000,
      lastVerifiedAt: FIXTURE_TIMESTAMP,
      rates: [
        {
          tier: "short",
          inputPerMillion: 6.5,
          outputPerMillion: 26.0,
          cachedInputPerMillion: 3.25,
        },
        {
          tier: "long",
          inputPerMillion: 13.0,
          outputPerMillion: 52.0,
          cachedInputPerMillion: 6.5,
        },
      ],
    },
    {
      id: "mdl-luna",
      provider: "OpenAI",
      name: "GPT-5.6 Luna",
      slug: "gpt-5.6-luna",
      status: "active",
      contextWindow: 128_000,
      lastVerifiedAt: FIXTURE_TIMESTAMP,
      rates: [
        {
          tier: "short",
          inputPerMillion: 0.8,
          outputPerMillion: 3.2,
          cachedInputPerMillion: 0.4,
        },
        {
          tier: "long",
          inputPerMillion: 1.6,
          outputPerMillion: 14.4,
          cachedInputPerMillion: 0.8,
        },
      ],
    },
  ],

  providers: [
    {
      id: "prov-openai",
      name: "OpenAI",
      status: "healthy",
      modelsTracked: 3,
      lastCollectionAt: FIXTURE_TIMESTAMP,
      collectorId: "bd-openai-pricing-v3",
      errorRate24h: 0,
      latencyP95Ms: 1240,
    },
  ],

  sources: [
    {
      id: "src-openai-pricing",
      label: "OpenAI Pricing Page",
      provider: "OpenAI",
      collectorType: "Bright Data Scraper Studio",
      lastSuccessAt: FIXTURE_TIMESTAMP,
      lastAttemptAt: FIXTURE_TIMESTAMP,
      status: "healthy",
      stalenessMinutes: 48,
      expectedIntervalMinutes: 60,
    },
    {
      id: "src-openai-models",
      label: "OpenAI Models API",
      provider: "OpenAI",
      collectorType: "Bright Data Scraper Studio",
      lastSuccessAt: "2026-08-17T08:30:00.000Z",
      lastAttemptAt: "2026-08-17T09:00:00.000Z",
      status: "degraded",
      stalenessMinutes: 192,
      expectedIntervalMinutes: 120,
      // notes handled at provider level
    },
  ],

  provenance: [
    {
      sourceId: "openai-pricing-page",
      label: "platform.openai.com/docs/pricing",
      url: "https://platform.openai.com/docs/pricing",
      collector: "bd-openai-pricing-v3",
      datasetVersion: "2026-08-17T10:42:00Z",
      scrapedAt: FIXTURE_TIMESTAMP,
    },
  ],
};

/** Empty-state fixture for testing empty UI paths */
export const MOCK_RADAR_DATA_EMPTY: RadarDashboardData = {
  isMock: true,
  fixtureVersion: "empty",
  ecosystem: {
    status: "unknown",
    modelsTracked: 0,
    providersTracked: 0,
    sourcesMonitored: 0,
    changesLast24h: 0,
    priceChangesLast7d: 0,
    lifecycleChangesLast7d: 0,
    activeAlerts: 0,
    lastGlobalRefreshAt: "",
  },
  sentinel: {
    available: false,
    unavailableReason: "Fixture dashboard is not connected to live Sentinel.",
    isDemo: true,
    totalSources: null,
    healthy: null,
    degraded: null,
    quarantined: null,
    recovered: null,
    healing: null,
    needsReview: null,
  },
  changes: [],
  models: [],
  providers: [],
  sources: [],
  provenance: [],
};
