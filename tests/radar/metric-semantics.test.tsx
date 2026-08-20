/**
 * Regression coverage for the judge-facing metric labels.
 *
 * Three defects shipped to production and are pinned here:
 *
 *  1. The source-detail heading rendered the current state three times over —
 *     labelled `StatusDot`, its own screen-reader copy, and the badge.
 *  2. Provider cards presented "Error rate —" and "P95 latency —" for
 *     telemetry the pipeline never collects.
 *  3. The dashboard reported ~41 "Canonical models" while the Explorer listed
 *     121, with nothing on screen explaining that they count different things.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProviderHealthOverview } from "../../components/radar/dashboard/ProviderHealthOverview";
import { RadarPulse } from "../../components/radar/dashboard/RadarPulse";
import { EcosystemStatus } from "../../components/radar/dashboard/EcosystemStatus";
import { SentinelSummaryHeader } from "../../components/radar/sentinel/SentinelSummaryHeader";
import { SourceHealthSummary } from "../../components/product/sources/SourceHealthSummary";
import { StatusDot } from "../../components/radar/ui/StatusDot";
import type { SentinelSummaryView } from "../../components/radar/sentinel/types";

/** Occurrences of a whole word in rendered markup. */
function occurrences(html: string, word: string): number {
  return html.match(new RegExp(word, "g"))?.length ?? 0;
}

// ---------------------------------------------------------------------------
// 1. One current-state label
// ---------------------------------------------------------------------------

test("a labelled StatusDot does not repeat itself as screen-reader text", () => {
  const html = renderToStaticMarkup(
    createElement(StatusDot, { status: "healthy", label: "Recovered" }),
  );
  assert.equal(occurrences(html, "Recovered"), 1);
  assert.doesNotMatch(html, /sr-only/, "no duplicate copy for assistive tech");
});

test("an unlabelled StatusDot still announces its state to assistive tech", () => {
  const html = renderToStaticMarkup(createElement(StatusDot, { status: "down" }));
  assert.match(html, /sr-only/);
  assert.match(html, /Down|Unknown|Degraded|Healthy/);
});

test("a decorative StatusDot adds no state text of its own", () => {
  // A recovered source would otherwise be announced as "Healthy" by the dot
  // and "Recovered" by the Sentinel badge sitting beside it.
  const html = renderToStaticMarkup(
    createElement(StatusDot, { status: "healthy", decorative: true }),
  );
  assert.doesNotMatch(html, /sr-only/);
  assert.doesNotMatch(html, /Healthy/);
});

test("the source-detail health summary names the current state exactly once", () => {
  const html = renderToStaticMarkup(
    createElement(SourceHealthSummary, {
      health: {
        status: "recovered",
        statusLabel: "Recovered",
        health: "healthy",
        recordCount: 10,
        openIncident: null,
      },
      recovery: {
        resolvedIncidents: 1,
        healingAttempts: 1,
        lastRecoveredAt: "2026-08-20T09:56:00.000Z",
      },
      freshness: {
        lastRunAt: "2026-08-20T10:01:00.000Z",
        lastSuccessAt: "2026-08-20T10:01:00.000Z",
        stalenessMinutes: 180,
        expectedIntervalMinutes: 1440,
      },
    }),
  );

  // This is the assertion that would have caught "Recovered Recovered Recovered".
  assert.equal(
    occurrences(html, "Recovered"),
    1,
    "the state must be composed once, not through badge + title + subtitle",
  );
  assert.match(html, /Current health/);
  // History is present, and stated as history.
  assert.match(html, /Last recovery/);
  assert.match(html, /No open incident/);
});

test("an open incident is stated as current, not as a recovery", () => {
  const html = renderToStaticMarkup(
    createElement(SourceHealthSummary, {
      health: {
        status: "quarantined",
        statusLabel: "Quarantined",
        health: "down",
        recordCount: 0,
        openIncident: {
          incidentId: "inc-1",
          severity: "critical",
          reasonCodes: ["ZERO_RECORDS"],
          openedAt: "2026-08-20T09:55:00.000Z",
        },
      },
      recovery: { resolvedIncidents: 0, healingAttempts: 0, lastRecoveredAt: null },
      freshness: {
        lastRunAt: "2026-08-20T09:55:00.000Z",
        lastSuccessAt: null,
        stalenessMinutes: null,
        expectedIntervalMinutes: null,
      },
    }),
  );

  assert.match(html, /Open incident/);
  assert.match(html, /Open since/);
  assert.doesNotMatch(html, /Last recovery/);
});

// ---------------------------------------------------------------------------
// 2. No empty telemetry claims
// ---------------------------------------------------------------------------

test("provider cards report observed collection metrics and claim no telemetry", () => {
  const html = renderToStaticMarkup(
    createElement(ProviderHealthOverview, {
      providers: [
        {
          id: "prov-openai",
          name: "OpenAI",
          status: "healthy",
          pricedModels: 3,
          sourcesMonitored: 2,
          acceptedRecords: 27,
          lastCollectionAt: "2026-08-20T08:50:00.000Z",
          collectorId: "c_openai",
        },
      ],
    }),
  );

  // Unmeasured telemetry is absent, not rendered as an em dash.
  assert.doesNotMatch(html, /Error rate/);
  assert.doesNotMatch(html, /P95 latency/);

  // What is shown comes from rows a collection run wrote.
  assert.match(html, /Priced models/);
  assert.match(html, /Accepted records/);
  assert.match(html, /Sources/);
  assert.match(html, /Last collection/);
});

// ---------------------------------------------------------------------------
// 3. Two different model counts, named for what they count
// ---------------------------------------------------------------------------

test("the dashboard hero distinguishes priced models from tracked identities", () => {
  const html = renderToStaticMarkup(
    createElement(RadarPulse, {
      pricedModels: 41,
      modelIdentities: 121,
      status: "degraded",
    }),
  );

  assert.match(html, /41/);
  assert.match(html, /models with canonical pricing/);
  assert.match(html, /121/);
  assert.match(html, /tracked identities/);
  // The old wording invited the reading that 41 was everything AI Radar knows.
  assert.doesNotMatch(html, /canonical models under observation/);
});

test("the ecosystem stat row carries both model counts under distinct labels", () => {
  const html = renderToStaticMarkup(
    createElement(EcosystemStatus, {
      data: {
        status: "degraded",
        pricedModels: 41,
        modelIdentities: 121,
        providersTracked: 5,
        sourcesMonitored: 11,
        changesLast24h: 0,
        priceChangesLast7d: 0,
        lifecycleChangesLast7d: 0,
        activeAlerts: 0,
        lastGlobalRefreshAt: "2026-08-20T10:01:00.000Z",
      },
      sentinel: {
        available: false,
        unavailableReason: "not attached in this test",
        isDemo: false,
        totalSources: null,
        healthy: null,
        degraded: null,
        quarantined: null,
        recovered: null,
        healing: null,
        needsReview: null,
      },
    }),
  );

  assert.match(html, /Models priced/);
  assert.match(html, /Model identities/);
  assert.doesNotMatch(html, /Canonical models/);
});

// ---------------------------------------------------------------------------
// 4. Source Health KPIs separate the two time horizons
// ---------------------------------------------------------------------------

const SUMMARY: SentinelSummaryView = {
  totalSources: 11,
  healthySources: 9,
  recoveredSources: 1,
  operationalSources: 10,
  degradedSources: 1,
  quarantinedSources: 0,
  healingSources: 0,
  needsReviewSources: 0,
  openIncidents: 0,
  resolvedIncidents: 1,
  statusCounts: {
    healthy: 9,
    recovered: 1,
    degraded: 1,
    quarantined: 0,
    healing: 0,
    needs_review: 0,
  },
  providers: 5,
  recordsProtected: 120,
  healingAttempts: 1,
  lastRunAt: "2026-08-20T10:01:00.000Z",
};

test("Source Health labels Operational, Healthy and Recovered as three figures", () => {
  const html = renderToStaticMarkup(
    createElement(SentinelSummaryHeader, { summary: SUMMARY }),
  );

  assert.match(html, /Operational/);
  assert.match(html, /of 11 · serving trusted data/);
  assert.match(html, /Healthy/);
  assert.match(html, /Recovered/);
  assert.match(html, /Degraded/);
});

test("Source Health keeps open incidents and healing history in separate groups", () => {
  const html = renderToStaticMarkup(
    createElement(SentinelSummaryHeader, { summary: SUMMARY }),
  );

  assert.match(html, /Current state/);
  assert.match(html, /History/);

  // The healing-attempt count no longer hangs off the open-incident card.
  const currentIndex = html.indexOf("Current state");
  const historyIndex = html.indexOf(">History<");
  assert.ok(currentIndex >= 0 && historyIndex > currentIndex);
  assert.ok(
    html.indexOf("Open incidents") < historyIndex,
    "open incidents belong to the current-state group",
  );
  assert.ok(
    html.indexOf("Healing attempts") > historyIndex,
    "healing attempts belong to the history group",
  );
  assert.ok(html.indexOf("Resolved incidents") > historyIndex);
});
