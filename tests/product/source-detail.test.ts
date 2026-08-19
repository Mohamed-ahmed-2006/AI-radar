import test from "node:test";
import assert from "node:assert/strict";

import {
  SENTINEL_SOURCE_DETAIL_CAPABILITIES,
  buildSourceDetailFromSentinel,
  buildSourceDirectoryFromSentinel,
  createSentinelSourceDetailAdapter,
} from "../../lib/product/sentinel-source-detail";
import {
  getSourceDetailAdapter,
  setSourceDetailAdapter,
  supportedSections,
  type SourceDetailAdapter,
} from "../../lib/product/source-detail";
import { latestRun, sentinelSource, sentinelView } from "./support/fixtures";

test("Source detail: projects identity, health and freshness from the Sentinel view", () => {
  const detail = buildSourceDetailFromSentinel(
    sentinelView(),
    "src-openai-pricing",
    [latestRun()],
  );

  assert(detail);
  assert.equal(detail.identity.name, "OpenAI API pricing");
  assert.equal(detail.identity.providerName, "OpenAI");
  assert.equal(detail.identity.category, "pricing");
  assert.equal(detail.identity.collectorId, "c_msx3bqlyjtv2qustx");
  assert.equal(detail.identity.isActive, true);

  assert.equal(detail.health.status, "healthy");
  assert.equal(detail.health.statusLabel, "Healthy");
  assert.equal(detail.health.health, "healthy");
  assert.equal(detail.health.recordCount, 12);

  assert.equal(detail.freshness.lastRunAt, "2026-08-17T09:00:00.000Z");
  assert.equal(detail.freshness.lastSuccessAt, "2026-08-17T09:00:00.000Z");
  assert.equal(detail.freshness.stalenessMinutes, 42);
  // No source declares an expected interval yet, so it must not be guessed.
  assert.equal(detail.freshness.expectedIntervalMinutes, null);
});

test("Source detail: an unknown source id resolves to nothing", () => {
  assert.equal(buildSourceDetailFromSentinel(sentinelView(), "src-missing"), null);
});

test("Source detail: run history and observed data come from the latest run", () => {
  const detail = buildSourceDetailFromSentinel(
    sentinelView(),
    "src-openai-pricing",
    [latestRun()],
  );

  assert(detail?.runHistory.available);
  assert.equal(detail.runHistory.data.length, 1);
  assert.equal(detail.runHistory.data[0].id, "run-9f3");
  assert.equal(detail.runHistory.data[0].status, "succeeded");
  assert.equal(detail.runHistory.data[0].recordsRejected, 1);

  assert(detail.observedData.available);
  assert.equal(detail.observedData.data.observedRecords, 13);
  assert.equal(detail.observedData.data.trustedRecords, 12);
  assert.equal(detail.observedData.data.rejectedRecords, 1);
});

test("Source detail: a failed run reports no last success rather than a plausible time", () => {
  const detail = buildSourceDetailFromSentinel(
    sentinelView([sentinelSource({ status: "quarantined", health: "down" })]),
    "src-openai-pricing",
    [latestRun({ status: "failed", errorMessage: "Collector returned 0 records" })],
  );

  assert(detail);
  assert.equal(detail.freshness.lastSuccessAt, null);
  assert.equal(detail.health.statusLabel, "Quarantined");
  assert(detail.runHistory.available);
  assert.equal(detail.runHistory.data[0].errorMessage, "Collector returned 0 records");
});

test("Source detail: sections without data state why, instead of rendering as empty", () => {
  const detail = buildSourceDetailFromSentinel(
    sentinelView([
      sentinelSource({ lastKnownGood: null, incident: null, timeline: [] }),
    ]),
    "src-openai-pricing",
  );

  assert(detail);

  assert.equal(detail.runHistory.available, false);
  assert.equal(detail.observedData.available, false);
  assert.equal(detail.lastKnownGood.available, false);
  assert.equal(detail.incidents.available, false);
  assert.equal(detail.healingTimeline.available, false);

  for (const section of [
    detail.runHistory,
    detail.observedData,
    detail.lastKnownGood,
    detail.incidents,
    detail.healingTimeline,
  ]) {
    assert.equal(section.available, false);
    if (!section.available) {
      assert(section.reason.length > 0, "an unavailable section must explain itself");
    }
  }
});

test("Source detail: an open incident is surfaced with its reason codes and timeline", () => {
  const detail = buildSourceDetailFromSentinel(
    sentinelView([
      sentinelSource({
        status: "quarantined",
        health: "down",
        incident: {
          id: "inc-1",
          status: "open",
          severity: "critical",
          reasonCodes: ["ALL_PRICES_NULL"],
          summary: "Every priced field extracted as null.",
          recordsSeen: 13,
          recordsValid: 0,
          recordsInvalid: 13,
          healingAttemptCount: 1,
          createdAt: "2026-08-17T09:05:00.000Z",
        },
      }),
    ]),
    "src-openai-pricing",
  );

  assert(detail?.incidents.available);
  assert.equal(detail.incidents.data.length, 1);
  assert.deepEqual(detail.incidents.data[0].reasonCodes, ["ALL_PRICES_NULL"]);
  assert(detail.healingTimeline.available);
});

test("Source detail: the raw-to-normalized explainer reflects observed counts only", () => {
  const withRun = buildSourceDetailFromSentinel(
    sentinelView(),
    "src-openai-pricing",
    [latestRun()],
  );
  assert(withRun?.normalization.available);
  assert.equal(withRun.normalization.data.contractName, "NormalizedPricingRecord");

  const collect = withRun.normalization.data.stages.find((stage) => stage.id === "collect");
  assert.equal(collect?.detail, "13 records");

  const withoutRun = buildSourceDetailFromSentinel(sentinelView(), "src-openai-pricing");
  assert(withoutRun?.normalization.available);
  const collectAgain = withoutRun.normalization.data.stages.find(
    (stage) => stage.id === "collect",
  );
  assert.equal(collectAgain?.detail, null, "no run means no observed figure");
});

test("Source detail: provenance carries the collector, source URL and validation state", () => {
  const detail = buildSourceDetailFromSentinel(
    sentinelView(),
    "src-openai-pricing",
    [latestRun()],
  );

  assert(detail);
  assert.equal(detail.provenance.collectorId, "c_msx3bqlyjtv2qustx");
  assert.equal(detail.provenance.sourceUrl, "https://openai.com/api/pricing");
  assert.equal(detail.provenance.runId, "run-9f3");
  assert.equal(detail.provenance.validation?.label, "Healthy");
  assert.equal(detail.provenance.validation?.status, "passing");
  assert.equal(detail.provenance.isDemo, false);
});

test("Source detail: demo mode is labelled and claims no collection runs", () => {
  const view = sentinelView([sentinelSource()], {
    isDemo: true,
    demoScenario: "Autonomous healing",
  });
  const detail = buildSourceDetailFromSentinel(view, "src-openai-pricing");

  assert(detail);
  assert.equal(detail.isDemo, true);
  assert.equal(detail.demoScenario, "Autonomous healing");
  assert.equal(detail.provenance.isDemo, true);
  assert.equal(detail.runHistory.available, false);
  if (!detail.runHistory.available) {
    assert.match(detail.runHistory.reason, /demo/i);
  }
});

test("Source directory: lists every source with a readable status", () => {
  const directory = buildSourceDirectoryFromSentinel(
    sentinelView([
      sentinelSource(),
      sentinelSource({
        sourceId: "src-anthropic-lifecycle",
        name: "Anthropic model deprecations",
        providerName: "Anthropic",
        kind: "changelog",
        status: "needs_review",
        health: "down",
        incident: {
          id: "inc-2",
          status: "needs_review",
          severity: "critical",
          reasonCodes: ["SCHEMA_VALIDATION_FAILURE"],
          summary: null,
          recordsSeen: null,
          recordsValid: null,
          recordsInvalid: null,
          healingAttemptCount: 3,
          createdAt: "2026-08-17T09:05:00.000Z",
        },
      }),
    ]),
  );

  assert.equal(directory.entries.length, 2);
  assert.equal(directory.entries[0].statusLabel, "Healthy");
  assert.equal(directory.entries[0].hasOpenIncident, false);
  assert.equal(directory.entries[1].statusLabel, "Needs review");
  assert.equal(directory.entries[1].hasOpenIncident, true);
  assert.equal(directory.isDemo, false);
});

test("Source detail seam: a richer adapter can replace the Sentinel one wholesale", async () => {
  const sentinelAdapter = createSentinelSourceDetailAdapter({
    loadView: async () => sentinelView(),
    loadRuns: async () => [latestRun()],
  });

  setSourceDetailAdapter(sentinelAdapter);
  assert.equal(getSourceDetailAdapter().id, "sentinel-source-health-v1");
  const viaSentinel = await getSourceDetailAdapter().getSourceDetail("src-openai-pricing");
  assert.equal(viaSentinel?.identity.name, "OpenAI API pricing");

  const richer: SourceDetailAdapter = {
    id: "richer-source-detail",
    label: "Richer source detail API",
    capabilities: { ...SENTINEL_SOURCE_DETAIL_CAPABILITIES, rawPayload: true },
    listSources: async () => buildSourceDirectoryFromSentinel(sentinelView()),
    getSourceDetail: async (sourceId) =>
      buildSourceDetailFromSentinel(sentinelView(), sourceId, [latestRun()]),
  };

  setSourceDetailAdapter(richer);
  assert.equal(getSourceDetailAdapter().id, "richer-source-detail");
  assert(supportedSections(richer.capabilities).includes("rawPayload"));
  assert.equal(supportedSections(sentinelAdapter.capabilities).includes("rawPayload"), false);

  const viaRicher = await getSourceDetailAdapter().getSourceDetail("src-openai-pricing");
  assert.equal(viaRicher?.identity.sourceId, "src-openai-pricing");

  setSourceDetailAdapter(null);
});
