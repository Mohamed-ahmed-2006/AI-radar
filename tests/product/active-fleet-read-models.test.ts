/**
 * Regression tests for the production presentation defects found on the live
 * judge-facing site.
 *
 * Each test pins one semantic that was wrong in production:
 *
 *   * a superseded source stayed in the active fleet views and counts
 *   * a provider with no snapshots rendered as its raw UUID
 *   * the isolated demo source dragged the whole AI ecosystem to Down
 *   * configured sources reported "interval not configured"
 *   * official provider pages reported Unverified provenance
 *   * one provider's degraded catalog marked every provider's models degraded
 *   * a completed live recovery read as though the feature had never run
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildRadarDashboardData } from "../../lib/radar/read-model";
import { buildDemoHealingHistory } from "../../lib/demo-healing/read-model";
import { degradedProviderIds } from "../../lib/product/explorer-read-model";
import { InMemorySentinelRepository } from "../../lib/sentinel/demo-simulator";
import { getSentinelDashboardReadModel } from "../../lib/sentinel/read-model";
import { InMemorySourceReadPort } from "../../lib/sources/in-memory-port";
import { getSourceCatalog } from "../../lib/sources/read-model";
import {
  CATALOG_PROVIDERS,
  resolveCatalogProviderConfiguration,
} from "../../lib/pipeline/providers";
import type {
  ProviderRow,
  SentinelHealingAttemptRow,
  SentinelIncidentRow,
  SourceHealthRow,
  SourceRow,
} from "../../lib/supabase/types";
import { incident, sentinelHealth } from "../sources/support/fixtures";

const NOW = Date.parse("2026-08-20T12:00:00.000Z");

function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

// The catalog collector and URL the registry actually resolves, so the category
// and cadence lookups under test run the same way they run in production.
const ANTHROPIC_CATALOG = resolveCatalogProviderConfiguration(CATALOG_PROVIDERS.anthropic);

const ANTHROPIC: ProviderRow = {
  id: "prov-anthropic",
  slug: "anthropic",
  name: "Anthropic",
  homepage_url: "https://www.anthropic.com",
  created_at: minutesAgo(100_000),
  updated_at: minutesAgo(100_000),
};

const GEMINI: ProviderRow = { ...ANTHROPIC, id: "prov-gemini", slug: "gemini", name: "Google" };

/**
 * The demo provider as production actually holds it: a real provider row with a
 * name, and no pricing, lifecycle or capability snapshot anywhere.
 */
const DEMO_PROVIDER: ProviderRow = {
  ...ANTHROPIC,
  id: "ecbea8d0-5b34-4592-a415-29228b0e2148",
  slug: "sentinel-demo",
  name: "Sentinel Demo",
};

function health(overrides: Partial<SourceHealthRow> & { source_id: string }): SourceHealthRow {
  return {
    provider_id: ANTHROPIC.id,
    kind: "pricing",
    collector_id: "c_anthropic_pricing",
    source_url: "https://platform.claude.com/docs/en/about-claude/pricing",
    is_active: true,
    last_run_id: "run-1",
    last_run_status: "succeeded",
    last_run_started_at: minutesAgo(60),
    last_run_completed_at: minutesAgo(59),
    records_seen: 12,
    records_accepted: 12,
    records_rejected: 0,
    error_message: null,
    ...overrides,
  };
}

const ANTHROPIC_PRICING = health({ source_id: "src-anthropic-pricing" });

const ANTHROPIC_CATALOG_SOURCE = health({
  source_id: "src-anthropic-catalog",
  kind: "models",
  collector_id: ANTHROPIC_CATALOG.collectorId,
  source_url: ANTHROPIC_CATALOG.sourceUrl,
});

/** Truthfully degraded: the Gemini catalog run really did come back partial. */
const GEMINI_CATALOG = health({
  source_id: "src-gemini-catalog",
  provider_id: GEMINI.id,
  kind: "models",
  collector_id: "c_gemini_catalog",
  source_url: "https://ai.google.dev/gemini-api/docs/models",
  last_run_status: "partial",
});

/** The demo source that is current: enabled, and its last run succeeded. */
const DEMO_CURRENT = health({
  source_id: "src-demo-current",
  provider_id: DEMO_PROVIDER.id,
  kind: "other",
  collector_id: "c_demo",
  source_url: "https://ai-radar-orpin.vercel.app/demo-source/healthy",
});

/** The superseded demo source: disabled, with a failed run frozen on it. */
const DEMO_SUPERSEDED = health({
  source_id: "src-demo-superseded",
  provider_id: DEMO_PROVIDER.id,
  kind: "other",
  collector_id: "c_demo",
  source_url: "https://quotes.toscrape.com/",
  is_active: false,
  last_run_status: "failed",
});

function dashboard(sourceHealth: readonly SourceHealthRow[]) {
  return buildRadarDashboardData(
    {
      providers: [ANTHROPIC, GEMINI, DEMO_PROVIDER],
      snapshots: [],
      lifecycle: [],
      capabilities: [],
      sourceHealth,
      recentEvents: [],
      recentEvents24h: [],
      priceEvents7d: [],
      lifecycleEvents7d: [],
    },
    NOW,
  );
}

const FLEET = [
  ANTHROPIC_PRICING,
  ANTHROPIC_CATALOG_SOURCE,
  GEMINI_CATALOG,
  DEMO_CURRENT,
  DEMO_SUPERSEDED,
];

test("Dashboard: a deactivated source leaves the fleet counts, providers and provenance", () => {
  const data = dashboard(FLEET);

  assert.equal(data.ecosystem.sourcesMonitored, 4, "the superseded source must not be counted");
  assert.equal(
    data.sources.some((source) => source.id === DEMO_SUPERSEDED.source_id),
    false,
  );
  assert.equal(
    data.provenance.some((record) => record.sourceId === DEMO_SUPERSEDED.source_id),
    false,
  );

  // Its failed run must not raise an alert either — that run is history.
  assert.equal(data.ecosystem.activeAlerts, 0);
});

test("Dashboard: a provider with no snapshots renders its name, never its UUID", () => {
  const data = dashboard(FLEET);

  const demo = data.providers.find((provider) => provider.id === DEMO_PROVIDER.id);
  assert.ok(demo, "the demo provider should appear in provider health");
  assert.equal(demo.name, "Sentinel Demo");
  assert.equal(demo.status, "healthy");

  for (const provider of data.providers) {
    assert.notEqual(provider.name, provider.id, "no provider may render as its raw id");
  }
  for (const source of data.sources) {
    assert.notEqual(source.provider, source.id);
  }
});

test("Ecosystem: the isolated demo source cannot make the AI ecosystem Down", () => {
  // Gemini's catalog is genuinely partial, so degraded is the truthful verdict.
  assert.equal(dashboard(FLEET).ecosystem.status, "degraded");

  // Even a demo source that is currently failing is reported on its own.
  const brokenDemo = dashboard([
    ANTHROPIC_PRICING,
    ANTHROPIC_CATALOG_SOURCE,
    { ...DEMO_CURRENT, last_run_status: "failed" as const },
  ]);
  assert.equal(brokenDemo.ecosystem.status, "healthy");
  assert.equal(brokenDemo.ecosystem.activeAlerts, 0);
  assert.equal(
    brokenDemo.sources.find((source) => source.id === DEMO_CURRENT.source_id)?.status,
    "down",
    "the demo source still reports its own true state",
  );
});

test("Ecosystem: a real provider failing still takes the ecosystem down", () => {
  const data = dashboard([
    { ...ANTHROPIC_PRICING, last_run_status: "failed" as const },
    DEMO_CURRENT,
  ]);
  assert.equal(data.ecosystem.status, "down");
  assert.equal(data.ecosystem.activeAlerts, 1);
});

test("Freshness: a configured source carries its registry cadence, an on-demand one carries none", () => {
  const data = dashboard(FLEET);
  const by = (id: string) => data.sources.find((source) => source.id === id);

  assert.equal(by(ANTHROPIC_PRICING.source_id)?.expectedIntervalMinutes, 360);
  assert.equal(by(ANTHROPIC_CATALOG_SOURCE.source_id)?.expectedIntervalMinutes, 720);
  assert.equal(by(GEMINI_CATALOG.source_id)?.expectedIntervalMinutes, 720);

  // The demo source is run by hand. Null is the truthful answer, and the panel
  // omits the percentage rather than reporting a false configured window.
  assert.equal(by(DEMO_CURRENT.source_id)?.expectedIntervalMinutes, null);
});

test("Provenance: trust comes from the source contract, not from the page loading", () => {
  const data = dashboard(FLEET);
  const by = (id: string) => data.provenance.find((record) => record.sourceId === id);

  // Pricing is scraped and validated, never authoritative for model inventory.
  assert.equal(by(ANTHROPIC_PRICING.source_id)?.authority, "verified_scrape");
  // The catalog page is the provider's own published inventory.
  assert.equal(by(ANTHROPIC_CATALOG_SOURCE.source_id)?.authority, "authoritative");
  // The demo sandbox has no registered contract, so it stays unverified.
  assert.equal(by(DEMO_CURRENT.source_id)?.authority, null);
});

test("Sentinel fleet: a deactivated source leaves the counts and its incident closes off the board", async () => {
  const repo = new InMemorySentinelRepository();
  repo.sourceHealth = [
    sentinelHealth({ source_id: "src-live", is_active: true }),
    sentinelHealth({
      source_id: "src-superseded",
      is_active: false,
      sentinel_health_status: "healing",
    }),
  ];
  await repo.createIncident({
    sourceId: "src-superseded",
    providerId: "prov-demo",
    status: "healing",
    severity: "critical",
    reasonCodes: ["RECORD_COUNT_COLLAPSE"],
    recordsSeen: 1,
    recordsValid: 0,
    recordsInvalid: 1,
  });

  const model = await getSentinelDashboardReadModel(repo);

  assert.equal(model.summary.totalSources, 1);
  assert.deepEqual(
    model.sources.map((source) => source.sourceId),
    ["src-live"],
  );
  assert.equal(model.summary.openIncidents, 0, "a superseded source has no open incident");
  assert.equal(model.activeIncidents.length, 0);
});

test("Source directory: deactivated rows are excluded, and still readable on request", async () => {
  const provider: ProviderRow = { ...DEMO_PROVIDER };
  const base: SourceRow = {
    id: "src-demo-current",
    provider_id: provider.id,
    kind: "other",
    collector_id: "c_demo",
    source_url: "https://ai-radar-orpin.vercel.app/demo-source/healthy",
    label: "Sentinel self-healing demo source",
    is_active: true,
    created_at: minutesAgo(100),
    updated_at: minutesAgo(100),
  };
  const superseded: SourceRow = {
    ...base,
    id: "src-demo-superseded",
    source_url: "https://quotes.toscrape.com/",
    is_active: false,
  };
  const port = new InMemorySourceReadPort({
    providers: [provider],
    sources: [base, superseded],
  });

  const active = await getSourceCatalog({ port, now: () => new Date(NOW) });
  assert.deepEqual(
    active.sources.map((source) => source.identity.sourceId),
    ["src-demo-current"],
  );
  assert.equal(active.summary.totalSources, 1);

  // History is preserved and still reachable, it just is not the fleet.
  const all = await getSourceCatalog({ port, now: () => new Date(NOW), includeInactive: true });
  assert.equal(all.sources.length, 2);
});

test("Model freshness: one provider's degraded catalog does not degrade another provider", () => {
  const degraded = degradedProviderIds(FLEET);

  assert.equal(degraded.has(GEMINI.id), true, "Gemini's partial catalog run is a real degradation");
  assert.equal(degraded.has(ANTHROPIC.id), false, "Anthropic's sources all succeeded");
});

test("Model freshness: a deactivated source's frozen failure is history, not a degradation", () => {
  const degraded = degradedProviderIds([
    { ...DEMO_SUPERSEDED, kind: "models" as const, last_run_status: "failed" as const },
  ]);
  assert.equal(degraded.size, 0);
});

test("Healing demo: a completed recovery survives a reset of the current phase", () => {
  const incidents: SentinelIncidentRow[] = [
    {
      ...incident({ id: "inc-recovered", source_id: "src-demo-current" }),
      status: "resolved",
      last_known_good_count: 10,
      last_known_good_at: minutesAgo(130),
      created_at: minutesAgo(125),
      resolved_at: minutesAgo(120),
    },
  ];
  const attempts: SentinelHealingAttemptRow[] = [
    {
      id: "heal-1",
      incident_id: "inc-recovered",
      source_id: "src-demo-current",
      collector_id: "c_demo",
      attempt_number: 1,
      prompt: "operator text",
      status: "approved",
      refactor_job_id: "job-1",
      candidate_records_count: 10,
      candidate_passed_validation: true,
      validation_details: null,
      error_message: null,
      started_at: minutesAgo(124),
      completed_at: minutesAgo(121),
      created_at: minutesAgo(124),
    },
  ];

  const history = buildDemoHealingHistory(incidents, attempts);

  assert.equal(history.hasCompletedRecovery, true);
  assert.equal(history.completedRecoveries, 1);
  assert.equal(history.lastRecoveryAt, minutesAgo(120));
  assert.equal(history.lastKnownGoodCount, 10);
  assert.equal(history.approvedHealingAttempts, 1);
});

test("Healing demo: a source that has never healed claims nothing", () => {
  const history = buildDemoHealingHistory([], []);

  assert.equal(history.hasCompletedRecovery, false);
  assert.equal(history.completedRecoveries, 0);
  assert.equal(history.lastRecoveryAt, null);
  assert.equal(history.lastKnownGoodCount, null);
  assert.equal(history.approvedHealingAttempts, 0);
});
