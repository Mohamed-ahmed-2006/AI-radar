import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RadarDashboard } from "../../components/radar/dashboard/RadarDashboard";
import type { RadarDashboardData } from "../../components/radar/types";

test("dashboard renders live pricing intelligence from multiple providers", () => {
  const data: RadarDashboardData = {
    isMock: false, fixtureVersion: "live-supabase",
    ecosystem: {
      status: "healthy",
      modelsTracked: 2,
      providersTracked: 2,
      sourcesMonitored: 0,
      changesLast24h: 0,
      priceChangesLast7d: 0,
      lifecycleChangesLast7d: 0,
      activeAlerts: 0,
      lastGlobalRefreshAt: "2026-08-17T10:00:00Z",
    },
    sentinel: {
      available: false,
      unavailableReason: "Sentinel was not attached in this test.",
      isDemo: false,
      totalSources: null,
      healthy: null,
      degraded: null,
      quarantined: null,
      recovered: null,
      healing: null,
      needsReview: null,
    },
    changes: [],
    models: [
      { id: "anthropic-model", provider: "Anthropic", name: "Claude Sonnet 5", slug: "Claude Sonnet 5", status: "active", contextWindow: null, lastVerifiedAt: "2026-08-17T10:00:00Z", rates: [{ tier: "standard", inputPerMillion: 2, outputPerMillion: 10 }] },
      { id: "xai-model", provider: "xAI", name: "grok-4.6", slug: "grok-4.6", status: "active", contextWindow: null, lastVerifiedAt: "2026-08-17T10:00:00Z", rates: [{ tier: "short", inputPerMillion: 2, outputPerMillion: 6 }] },
    ],
    providers: [
      { id: "anthropic", name: "Anthropic", status: "healthy", modelsTracked: 1, lastCollectionAt: null, collectorId: "collector-a", errorRate24h: null, latencyP95Ms: null },
      { id: "xai", name: "xAI", status: "healthy", modelsTracked: 1, lastCollectionAt: null, collectorId: "collector-x", errorRate24h: null, latencyP95Ms: null },
    ],
    sources: [], provenance: [],
  };
  const html = renderToStaticMarkup(createElement(RadarDashboard, { data }));
  assert.match(html, /Anthropic/);
  assert.match(html, /xAI/);
  assert.match(html, /Claude Sonnet 5/);
  assert.doesNotMatch(html, /Displaying fixture data/);
});
