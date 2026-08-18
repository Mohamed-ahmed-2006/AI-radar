import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SourceHealthDashboard } from "../../components/radar/sentinel/SourceHealthDashboard";
import type { SentinelDashboardReadModel } from "../../components/radar/sentinel/types";
import {
  buildSentinelViewFromDemo,
  buildSentinelViewFromReadModel,
} from "../../components/radar/sentinel/view-model";
import { runSentinelDemoSimulation } from "../../lib/sentinel/demo-simulator";

const GENERATED_AT = "2026-08-18T09:40:00.000Z";

function readModel(
  overrides: Partial<SentinelDashboardReadModel> = {},
): SentinelDashboardReadModel {
  const sources: SentinelDashboardReadModel["sources"] = [
    {
      sourceId: "src-openai",
      providerId: "prov-openai",
      providerName: "OpenAI",
      providerSlug: "openai",
      kind: "pricing",
      collectorId: "c_openai",
      sourceUrl: "https://openai.com/api/pricing/",
      label: null,
      status: "healthy",
      lastRunId: "run-openai-1",
      lastRunStatus: "succeeded",
      lastRunAt: "2026-08-18T09:30:00.000Z",
      currentRecordCount: 24,
      lastKnownGoodCount: 24,
      lastKnownGoodAt: "2026-08-18T09:30:00.000Z",
      activeIncident: null,
      stalenessMinutes: 10,
    },
    {
      sourceId: "src-gemini",
      providerId: "prov-gemini",
      providerName: "Gemini",
      providerSlug: "gemini",
      kind: "pricing",
      collectorId: "c_gemini",
      sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
      label: "Gemini pricing page",
      status: "quarantined",
      lastRunId: "run-gemini-9",
      lastRunStatus: "partial",
      lastRunAt: "2026-08-18T09:00:00.000Z",
      currentRecordCount: 0,
      lastKnownGoodCount: 11,
      lastKnownGoodAt: "2026-08-18T04:00:00.000Z",
      activeIncident: {
        id: "inc-1",
        status: "healing",
        severity: "critical",
        reasonCodes: ["ALL_PRICES_NULL"],
        healingAttemptCount: 1,
        createdAt: "2026-08-18T09:01:00.000Z",
      },
      stalenessMinutes: 40,
    },
  ];

  return {
    sources,
    activeIncidents: [
      {
        id: "inc-1",
        sourceId: "src-gemini",
        providerName: "Gemini",
        status: "healing",
        severity: "critical",
        reasonCodes: ["ALL_PRICES_NULL", "RECORD_COUNT_COLLAPSE"],
        summary: "All 11 models extracted a null input price.",
        recordsSeen: 11,
        recordsValid: 0,
        recordsInvalid: 11,
        lastKnownGoodCount: 11,
        healingAttemptCount: 1,
        createdAt: "2026-08-18T09:01:00.000Z",
      },
    ],
    recentHealingAttempts: [
      {
        id: "heal-1",
        incidentId: "inc-1",
        sourceId: "src-gemini",
        collectorId: "c_gemini",
        attemptNumber: 1,
        prompt: "Repair the pricing selector",
        status: "in_progress",
        candidatePassedValidation: null,
        startedAt: "2026-08-18T09:05:00.000Z",
        completedAt: null,
      },
    ],
    summary: {
      totalSources: 2,
      healthySources: 1,
      degradedSources: 0,
      quarantinedSources: 1,
      healingSources: 0,
      needsReviewSources: 0,
      openIncidents: 1,
    },
    ...overrides,
  };
}

test("view summary agrees with the backend's own summary figures", () => {
  const model = readModel();
  const view = buildSentinelViewFromReadModel(model, GENERATED_AT);

  assert.equal(view.summary.totalSources, model.summary.totalSources);
  assert.equal(view.summary.healthySources, model.summary.healthySources);
  assert.equal(view.summary.degradedSources, model.summary.degradedSources);
  assert.equal(view.summary.quarantinedSources, model.summary.quarantinedSources);
  assert.equal(view.summary.healingSources, model.summary.healingSources);
  assert.equal(view.summary.needsReviewSources, model.summary.needsReviewSources);
  assert.equal(view.summary.openIncidents, model.summary.openIncidents);
  // Derived additions must also come from the data, never a constant.
  assert.equal(view.summary.providers, 2);
  assert.equal(view.summary.recordsProtected, 24);
});

test("every displayed concept maps to a real Sentinel field", () => {
  const view = buildSentinelViewFromReadModel(readModel(), GENERATED_AT);
  const gemini = view.sources.find((source) => source.sourceId === "src-gemini");
  assert.ok(gemini);

  assert.equal(gemini.name, "Gemini pricing page");
  assert.equal(gemini.status, "quarantined");
  assert.equal(gemini.health, "down");
  assert.equal(gemini.currentRecordCount, 0);
  assert.equal(gemini.lastKnownGood?.recordCount, 11);
  assert.equal(gemini.lastKnownGood?.observedAt, "2026-08-18T04:00:00.000Z");
  assert.equal(gemini.rejectedCandidate?.recordCount, 11);
  assert.equal(gemini.rejectedCandidate?.invalidCount, 11);
  assert.equal(gemini.rejectedCandidate?.runId, "run-gemini-9");
  assert.deepEqual(gemini.incident?.reasonCodes, [
    "ALL_PRICES_NULL",
    "RECORD_COUNT_COLLAPSE",
  ]);
  assert.equal(gemini.healing.attempts, 1);
  assert.equal(gemini.healing.latestStatus, "in_progress");
  assert.equal(gemini.healing.succeeded, false);

  const labels = gemini.timeline.map((stage) => stage.label);
  assert.deepEqual(labels, [
    "Collection run",
    "Anomaly detected",
    "Bad snapshot quarantined",
    "Healing attempt 1",
  ]);
  assert.equal(
    gemini.timeline.find((stage) => stage.label === "Healing attempt 1")?.status,
    "active",
  );
});

test("a healthy source invents no incident, quarantine, or healing", () => {
  const view = buildSentinelViewFromReadModel(readModel(), GENERATED_AT);
  const openai = view.sources.find((source) => source.sourceId === "src-openai");
  assert.ok(openai);

  assert.equal(openai.incident, null);
  assert.equal(openai.rejectedCandidate, null);
  assert.equal(openai.healing.attempts, 0);
  assert.equal(openai.timeline.length, 1);
  assert.equal(openai.timeline[0].label, "Collection run");
});

test("a recovered source gets a recovery stage from its healing attempts", () => {
  const model = readModel();
  model.sources[1].status = "recovered";
  model.sources[1].currentRecordCount = 11;
  model.activeIncidents = [];
  model.recentHealingAttempts[0].status = "approved";
  model.recentHealingAttempts[0].candidatePassedValidation = true;
  model.recentHealingAttempts[0].completedAt = "2026-08-18T09:20:00.000Z";

  const view = buildSentinelViewFromReadModel(model, GENERATED_AT);
  const gemini = view.sources.find((source) => source.sourceId === "src-gemini");
  assert.ok(gemini);

  assert.equal(gemini.status, "recovered");
  assert.equal(gemini.health, "healthy");
  assert.equal(gemini.healing.succeeded, true);
  const recovered = gemini.timeline.at(-1);
  assert.equal(recovered?.label, "Recovered");
  assert.equal(recovered?.at, "2026-08-18T09:20:00.000Z");
});

test("spotlight picks the most alarming source and skips an all-healthy fleet", () => {
  assert.equal(
    buildSentinelViewFromReadModel(readModel(), GENERATED_AT).spotlightSourceId,
    "src-gemini",
  );

  const allHealthy = readModel();
  allHealthy.sources = [allHealthy.sources[0]];
  allHealthy.activeIncidents = [];
  allHealthy.recentHealingAttempts = [];
  assert.equal(
    buildSentinelViewFromReadModel(allHealthy, GENERATED_AT).spotlightSourceId,
    null,
  );
});

test("live data renders the incident story with no demo labelling", () => {
  const view = buildSentinelViewFromReadModel(readModel(), GENERATED_AT);
  const html = renderToStaticMarkup(
    createElement(SourceHealthDashboard, { view }),
  );

  assert.match(html, /Gemini pricing page/);
  assert.match(html, /Quarantined/);
  assert.match(html, /ALL_PRICES_NULL/);
  assert.match(html, /Last-known-good/);
  assert.match(html, /Healing attempt 1/);
  assert.doesNotMatch(html, /Demo simulation/);
});

test("demo mode renders the backend hero simulation, clearly labelled", async () => {
  const view = buildSentinelViewFromDemo(
    await runSentinelDemoSimulation(),
    GENERATED_AT,
  );

  assert.equal(view.isDemo, true);
  assert.equal(view.sources.length, 1);
  assert.equal(view.sources[0].status, "recovered");
  assert.equal(view.sources[0].lastKnownGood?.recordCount, 4);

  const html = renderToStaticMarkup(
    createElement(SourceHealthDashboard, { view }),
  );
  assert.match(html, /Demo simulation/);
  assert.match(html, /Recovered/);
  assert.match(html, /Anomaly Detected &amp; Candidate Quarantined/);
  assert.match(html, /Bright Data Autonomous Healing Initiated/);
  assert.match(html, /Repaired Candidate Validated by Sentinel/);
});

test("loading, empty, and error states replace the grid instead of blanking", () => {
  const loading = renderToStaticMarkup(
    createElement(SourceHealthDashboard, { view: null }),
  );
  assert.match(loading, /Loading source health/);

  const emptyView = buildSentinelViewFromReadModel(
    { sources: [], activeIncidents: [], recentHealingAttempts: [], summary: {
      totalSources: 0, healthySources: 0, degradedSources: 0,
      quarantinedSources: 0, healingSources: 0, needsReviewSources: 0,
      openIncidents: 0,
    } },
    GENERATED_AT,
  );
  const empty = renderToStaticMarkup(
    createElement(SourceHealthDashboard, { view: emptyView }),
  );
  assert.match(empty, /No sources are being monitored/);

  const errored = renderToStaticMarkup(
    createElement(SourceHealthDashboard, {
      view: null,
      error: "Missing environment variable NEXT_PUBLIC_SUPABASE_URL",
    }),
  );
  assert.match(errored, /Source health unavailable/);
  assert.match(errored, /Missing environment variable/);
  assert.doesNotMatch(errored, /Loading source health/);
});
