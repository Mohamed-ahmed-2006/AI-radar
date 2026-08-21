/**
 * The dashboard must agree with `/changes` and Source Detail.
 *
 * Two production defects motivated this file, and each was invisible to the
 * suites that existed:
 *
 *   * `getLiveRadarDashboardData` computed the trusted (admissibility-filtered)
 *     change rows and then handed `buildRadarDashboardData` the *unfiltered*
 *     ones, so the retracted Gemini capability regression kept rendering on the
 *     dashboard after `/changes` and Model Detail had stopped showing it. The
 *     builder is pure, so the wiring is what has to be pinned.
 *   * The freshness panel labelled any degraded source "Stale", so a source that
 *     had collected 24 minutes into a 720-minute window was called stale beside
 *     its own elapsed figure.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SourceFreshnessPanel } from "../../components/radar/dashboard/SourceFreshnessPanel";
import { buildRadarDashboardData } from "../../lib/radar/read-model";
import { withoutSupersededCapabilityEvidence } from "../../lib/intelligence/read-model";
import type {
  ChangeEventRow,
  ProviderRow,
  SourceHealthRow,
  SupabaseServerClient,
} from "../../lib/supabase";

const NOW = Date.parse("2026-08-21T15:00:00.000Z");
const minutesAgo = (minutes: number) =>
  new Date(NOW - minutes * 60_000).toISOString();

const GOOGLE: ProviderRow = {
  id: "prov-google",
  slug: "gemini",
  name: "Google",
  homepage_url: "https://ai.google.dev",
  created_at: minutesAgo(100_000),
  updated_at: minutesAgo(100_000),
};

const GEMINI_MODELS = "https://ai.google.dev/gemini-api/docs/models";

/** Truthfully degraded, and freshly collected: 24 minutes into a 720m cadence. */
const GEMINI_CATALOG: SourceHealthRow = {
  source_id: "src-gemini-catalog",
  provider_id: GOOGLE.id,
  kind: "models",
  collector_id: "c_msz708an1gawux0njo",
  source_url: GEMINI_MODELS,
  is_active: true,
  last_run_id: "run-fresh-partial",
  last_run_status: "partial",
  last_run_started_at: minutesAgo(25),
  last_run_completed_at: minutesAgo(24),
  records_seen: 41,
  records_accepted: 40,
  records_rejected: 1,
  error_message: null,
};

/** The same source, but genuinely past its cadence. */
const GEMINI_CATALOG_EXPIRED: SourceHealthRow = {
  ...GEMINI_CATALOG,
  last_run_started_at: minutesAgo(900),
  last_run_completed_at: minutesAgo(899),
};

function event(id: string, snapshotId: string | null, old: unknown, next: unknown): ChangeEventRow {
  return {
    id,
    provider_id: GOOGLE.id,
    source_id: GEMINI_CATALOG.source_id,
    run_id: "run-1",
    model_id: "model-flash-lite",
    change_type: "capability_changed",
    field_name: "supportsVision",
    pricing_mode: null,
    context_tier: null,
    old_value: old as never,
    new_value: next as never,
    previous_snapshot_id: null,
    current_snapshot_id: null,
    previous_lifecycle_snapshot_id: null,
    current_lifecycle_snapshot_id: null,
    previous_capability_snapshot_id: null,
    current_capability_snapshot_id: snapshotId,
    summary: null,
    detected_at: minutesAgo(200),
    created_at: minutesAgo(200),
  };
}

/** The locale-contaminated observation, and the canonical one that corrected it. */
const SNAPSHOTS = [
  { id: "snap-localized", raw: { source_url: `${GEMINI_MODELS}/gemini-2.5-flash-lite?hl=es-419` } },
  { id: "snap-canonical", raw: { source_url: `${GEMINI_MODELS}/gemini-2.5-flash-lite` } },
];

function fakeDb(): SupabaseServerClient {
  return {
    from: () => {
      const api = {
        select: () => api,
        in: (_column: string, ids: string[]) =>
          Promise.resolve({ data: SNAPSHOTS.filter((s) => ids.includes(s.id)), error: null }),
      };
      return api;
    },
  } as unknown as SupabaseServerClient;
}

function dashboard(recentEvents: readonly ChangeEventRow[], sourceHealth: SourceHealthRow[]) {
  return buildRadarDashboardData(
    {
      providers: [GOOGLE],
      models: [],
      snapshots: [],
      lifecycle: [],
      capabilities: [],
      sourceHealth,
      recentEvents,
      recentEvents24h: recentEvents,
      priceEvents7d: [],
      lifecycleEvents7d: [],
    },
    NOW,
  );
}

// ---------------------------------------------------------------------------
// Trusted change rows reach the dashboard
// ---------------------------------------------------------------------------

const BAD = event("bad-vision", "snap-localized", true, false);
const CORRECTION = event("correction", "snap-canonical", false, true);

/**
 * The wiring bug, stated as a test: whatever the dashboard renders must be what
 * the admissibility filter returned, not the raw rows beside it.
 */
test("dashboard Recent Changes carries only admissible capability events", async () => {
  const trusted = await withoutSupersededCapabilityEvidence(fakeDb(), [BAD, CORRECTION]);
  const data = dashboard(trusted, [GEMINI_CATALOG]);

  const ids = data.changes.map((change) => change.id);
  assert.equal(ids.includes("bad-vision"), false, "the retracted event must not reach the dashboard");
  assert.equal(ids.includes("correction"), true, "the valid correction must remain");
  assert.equal(data.ecosystem.changesLast24h, 1);
});

/** Skipping the filter is exactly the production bug, and must look different. */
test("passing unfiltered rows would surface the retracted event", async () => {
  const data = dashboard([BAD, CORRECTION], [GEMINI_CATALOG]);
  assert.equal(
    data.changes.map((change) => change.id).includes("bad-vision"),
    true,
    "guard: the builder itself does not filter, so the caller must",
  );
});

// ---------------------------------------------------------------------------
// Health, recency and clean-success history are three different facts
// ---------------------------------------------------------------------------

test("a degraded source with a fresh partial run is not stale", () => {
  const [source] = dashboard([], [GEMINI_CATALOG]).sources;

  assert.equal(source.status, "degraded");
  assert.equal(source.expectedIntervalMinutes, 720);
  assert.ok(
    source.stalenessMinutes !== null && source.stalenessMinutes < 720,
    "elapsed time must be measured from the completed attempt, partial included",
  );
  // No fully clean run has ever happened, and that stays separately true.
  assert.equal(source.lastSuccessAt, null);
});

test("a source genuinely past its cadence does read as stale", () => {
  const [source] = dashboard([], [GEMINI_CATALOG_EXPIRED]).sources;
  assert.ok(source.stalenessMinutes !== null && source.stalenessMinutes > 720);
});

/**
 * The rendered badge names health. It used to say "Stale", which is a claim
 * about recency, and contradicted the elapsed figure printed beside it.
 */
test("the freshness panel labels a degraded source by its health, not as stale", () => {
  const data = dashboard([], [GEMINI_CATALOG]);
  const html = renderToStaticMarkup(
    createElement(SourceFreshnessPanel, { sources: data.sources }),
  );

  assert.match(html, /Degraded/);
  assert.doesNotMatch(html, /Stale/);
  assert.match(html, /24m \/ 720m/);
});
