/**
 * Regression coverage for the judge-facing state contradictions.
 *
 * Every case here is one that shipped wrong to production:
 *
 *  1. A resolved incident rendered as an open incident on `/sources` while
 *     `/source-health` correctly reported zero open incidents.
 *  2. The source-detail heading named the current state three times over.
 *  3. The self-healing demo source was reported as having no registered
 *     Sentinel contract while its own healing evidence said a candidate had
 *     passed validation against the source contract.
 *  4. `healthy` was reported as healthy + recovered, so a fleet bar reading
 *     "9 Healthy, 1 Recovered" sat next to a KPI reading "Healthy 10 of 11".
 *
 * The assertions are on the read models, not on strings in a component, so a
 * later copy change cannot quietly reintroduce the underlying defect.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { InMemorySourceReadPort } from "../../lib/sources";
import { getSourceCatalog, getSourceDetail } from "../../lib/sources/read-model";
import { resolveSourceContractView } from "../../lib/sources/contract-view";
import {
  buildSourceDetailFromReadModel,
  buildSourceDirectoryFromReadModel,
} from "../../lib/product/source-detail-read-model";
import { summarizeSentinelSources } from "../../components/radar/sentinel/utils";
import type { SentinelSourceView } from "../../components/radar/sentinel/types";
import type { ProviderRow, SourceRow } from "../../lib/supabase/types";
import {
  NOW,
  healingAttempt,
  incident,
  minutesAgo,
  run,
  sentinelHealth,
} from "./support/fixtures";

const DEMO_PROVIDER: ProviderRow = {
  id: "prov-sentinel-demo",
  slug: "sentinel-demo",
  name: "Sentinel Demo",
  homepage_url: "https://quotes.toscrape.com",
  created_at: minutesAgo(100_000),
  updated_at: minutesAgo(100_000),
};

const DEMO_SOURCE: SourceRow = {
  id: "src-sentinel-demo",
  provider_id: DEMO_PROVIDER.id,
  kind: "other",
  collector_id: "c_demo",
  source_url: "https://quotes.toscrape.com/",
  label: "Sentinel self-healing demo source",
  is_active: true,
  created_at: minutesAgo(100_000),
  updated_at: minutesAgo(100_000),
};

/**
 * The exact production shape: the source has recovered, and the health view
 * still publishes the resolved incident under the `active_incident_*` prefix
 * because that view returns the latest incident regardless of status.
 */
function recoveredDemoPort(): InMemorySourceReadPort {
  return new InMemorySourceReadPort({
    sources: [DEMO_SOURCE],
    providers: [DEMO_PROVIDER],
    runs: [
      run({
        id: "run-after-heal",
        source_id: DEMO_SOURCE.id,
        started_at: minutesAgo(20),
        status: "succeeded",
      }),
      run({
        id: "run-broken",
        source_id: DEMO_SOURCE.id,
        started_at: minutesAgo(40),
        status: "failed",
        records_seen: 0,
        records_accepted: 0,
      }),
    ],
    incidents: [
      incident({
        id: "inc-demo",
        source_id: DEMO_SOURCE.id,
        provider_id: DEMO_PROVIDER.id,
        status: "resolved",
        reason_codes: ["ZERO_RECORDS"],
        healing_attempt_count: 1,
        created_at: minutesAgo(40),
        updated_at: minutesAgo(21),
        resolved_at: minutesAgo(21),
      }),
    ],
    // One logical attempt, written as three rows as it progressed. Production
    // looks exactly like this.
    healingAttempts: [
      healingAttempt({
        id: "heal-1-approved",
        source_id: DEMO_SOURCE.id,
        incident_id: "inc-demo",
        collector_id: DEMO_SOURCE.collector_id,
        attempt_number: 1,
        status: "approved",
        started_at: minutesAgo(23),
        completed_at: minutesAgo(21),
      }),
      healingAttempt({
        id: "heal-1-awaiting",
        source_id: DEMO_SOURCE.id,
        incident_id: "inc-demo",
        collector_id: DEMO_SOURCE.collector_id,
        attempt_number: 1,
        status: "awaiting_approval",
        started_at: minutesAgo(25),
        completed_at: null,
      }),
      healingAttempt({
        id: "heal-1-initiated",
        source_id: DEMO_SOURCE.id,
        incident_id: "inc-demo",
        collector_id: DEMO_SOURCE.collector_id,
        attempt_number: 1,
        status: "initiated",
        started_at: minutesAgo(28),
        completed_at: null,
      }),
    ],
    sentinelHealth: [
      sentinelHealth({
        source_id: DEMO_SOURCE.id,
        provider_id: DEMO_PROVIDER.id,
        provider_name: DEMO_PROVIDER.name,
        provider_slug: DEMO_PROVIDER.slug,
        kind: DEMO_SOURCE.kind,
        collector_id: DEMO_SOURCE.collector_id,
        source_url: DEMO_SOURCE.source_url,
        label: DEMO_SOURCE.label,
        last_run_id: "run-after-heal",
        last_run_status: "succeeded",
        last_run_started_at: minutesAgo(20),
        last_run_completed_at: minutesAgo(19),
        last_run_records_accepted: 10,
        // The view keeps publishing the resolved incident here.
        active_incident_id: "inc-demo",
        active_incident_status: "resolved",
        active_incident_severity: "critical",
        active_reason_codes: ["ZERO_RECORDS"],
        healing_attempt_count: 1,
        sentinel_health_status: "recovered",
      }),
    ],
  });
}

// ---------------------------------------------------------------------------
// 1. A resolved incident is history, never a current open incident
// ---------------------------------------------------------------------------

test("a resolved incident never reports as an open incident on the source catalog", async () => {
  const catalog = await getSourceCatalog({
    port: recoveredDemoPort(),
    now: () => NOW,
  });
  const demo = catalog.sources.find((s) => s.identity.sourceId === DEMO_SOURCE.id);
  assert.ok(demo);

  assert.equal(demo.health.status, "recovered");
  assert.equal(demo.health.activeIncident, null, "a resolved incident is not active");
  assert.ok(demo.health.latestIncident, "the resolved incident stays readable as history");
  assert.equal(demo.health.latestIncident?.status, "resolved");

  // The two horizons agree with each other and with `/source-health`.
  assert.equal(catalog.summary.openIncidents, 0);
  assert.equal(catalog.summary.recoveredIncidents, 1);
});

test("the source directory row separates an open incident from a resolved one", async () => {
  const catalog = await getSourceCatalog({
    port: recoveredDemoPort(),
    now: () => NOW,
  });
  const directory = buildSourceDirectoryFromReadModel(
    catalog.sources,
    catalog.generatedAt,
  );
  const entry = directory.entries.find((e) => e.sourceId === DEMO_SOURCE.id);
  assert.ok(entry);

  assert.equal(entry.hasOpenIncident, false, "the badge that said Open incident");
  assert.equal(entry.hasResolvedIncident, true, "history is still visible");
  assert.equal(entry.statusLabel, "Recovered");
});

test("an incident that is genuinely open is still reported as open", async () => {
  const port = recoveredDemoPort();
  port.data.incidents[0].status = "open";
  port.data.incidents[0].resolved_at = null;
  port.data.sentinelHealth[0].active_incident_status = "open";
  port.data.sentinelHealth[0].sentinel_health_status = "quarantined";

  const catalog = await getSourceCatalog({ port, now: () => NOW });
  const demo = catalog.sources.find((s) => s.identity.sourceId === DEMO_SOURCE.id);
  assert.ok(demo?.health.activeIncident, "an open incident must not be swallowed");
  assert.equal(demo.health.activeIncident?.status, "open");
  assert.equal(catalog.summary.openIncidents, 1);
  assert.equal(catalog.summary.recoveredIncidents, 0);
});

// ---------------------------------------------------------------------------
// 2. Current state is named once; recovery is separate evidence
// ---------------------------------------------------------------------------

test("source detail reports one current-state label and recovery as history", async () => {
  const detail = await getSourceDetail(DEMO_SOURCE.id, {
    port: recoveredDemoPort(),
    now: () => NOW,
  });
  assert.ok(detail);
  const view = buildSourceDetailFromReadModel(detail);

  // Exactly one current-state label, and no open incident on it.
  assert.equal(view.health.statusLabel, "Recovered");
  assert.equal(view.health.openIncident, null);

  // The recovery evidence lives on its own object with its own timestamp.
  assert.equal(view.recovery.resolvedIncidents, 1);
  // Three rows, one attempt. The incident's own counter says 1, and the
  // recovery summary must not contradict it by counting state transitions.
  assert.equal(view.recovery.healingAttempts, 1);
  assert.equal(view.recovery.lastRecoveredAt, minutesAgo(21));
});

test("the healing timeline renders one stage per attempt, not one per state row", async () => {
  const detail = await getSourceDetail(DEMO_SOURCE.id, {
    port: recoveredDemoPort(),
    now: () => NOW,
  });
  assert.ok(detail);
  const view = buildSourceDetailFromReadModel(detail);

  assert.equal(view.healingTimeline.available, true);
  if (!view.healingTimeline.available) return;

  const labels = view.healingTimeline.data.map((stage) => stage.label);
  assert.deepEqual(labels, ["Healing attempt 1"], "no repeated attempt heading");
  assert.equal(view.healingTimeline.data[0].status, "done");
  assert.equal(
    view.healingTimeline.data.length,
    view.recovery.healingAttempts,
    "the timeline and the recovery count describe the same attempts",
  );
});

// ---------------------------------------------------------------------------
// 3. The demo source is governed by a real, named contract
// ---------------------------------------------------------------------------

test("the self-healing demo source resolves a real Sentinel contract, declared by the demo harness", () => {
  const contract = resolveSourceContractView(
    DEMO_SOURCE.kind,
    DEMO_PROVIDER.slug,
    DEMO_SOURCE.id,
    DEMO_SOURCE.collector_id,
    DEMO_SOURCE.source_url,
  );

  assert.ok(contract, "the demo source is not contract-less");
  assert.equal(contract.registry, "sentinel-demo-harness");
  assert.equal(contract.contractName, "Sentinel self-healing demo source contract");
  // Real contract, but never an authority for the canonical tables.
  assert.equal(contract.isAuthoritative, false);
  assert.deepEqual(contract.requiredFields, ["quote_text", "author"]);
});

test("a production source still resolves through the production registry", () => {
  const contract = resolveSourceContractView(
    "pricing",
    "openai",
    "src-openai-pricing",
    "c_openai_pricing",
    "https://developers.openai.com/api/docs/pricing",
  );
  assert.ok(contract);
  assert.equal(contract.registry, "production-sources");
  assert.equal(contract.contractName, "openai pricing source contract");
});

test("source detail never claims the demo source has no registered contract", async () => {
  const detail = await getSourceDetail(DEMO_SOURCE.id, {
    port: recoveredDemoPort(),
    now: () => NOW,
  });
  assert.ok(detail);
  const view = buildSourceDetailFromReadModel(detail);

  assert.equal(view.normalization.available, true);
  if (!view.normalization.available) return;

  assert.equal(
    view.normalization.data.contractName,
    "Sentinel self-healing demo source contract",
  );

  const registryStage = view.normalization.data.stages.find(
    (stage) => stage.id === "contract-registry",
  );
  assert.ok(registryStage, "the page states which registry declares the contract");
  assert.match(registryStage.description, /demo harness/);
  assert.match(registryStage.description, /never reach the canonical/);

  const everything = JSON.stringify(view.normalization);
  assert.doesNotMatch(
    everything,
    /no Sentinel contract is registered/,
    "the false no-contract wording must not come back",
  );
});

// ---------------------------------------------------------------------------
// 4. Healthy, Recovered and Operational are three different numbers
// ---------------------------------------------------------------------------

function fleetSource(
  sourceId: string,
  status: SentinelSourceView["status"],
): SentinelSourceView {
  return {
    sourceId,
    name: sourceId,
    providerName: "Provider",
    kind: "pricing",
    collectorId: null,
    sourceUrl: null,
    status,
    health: status === "degraded" ? "degraded" : "healthy",
    lastRunAt: null,
    stalenessMinutes: null,
    currentRecordCount: null,
    lastKnownGood: null,
    rejectedCandidate: null,
    incident: null,
    healing: { attempts: 0, latestStatus: null, succeeded: false },
    timeline: [],
  };
}

test("the fleet summary never folds recovered sources into the healthy count", () => {
  const sources = [
    ...Array.from({ length: 9 }, (_, i) => fleetSource(`healthy-${i}`, "healthy")),
    fleetSource("recovered-0", "recovered"),
    fleetSource("degraded-0", "degraded"),
  ];

  const summary = summarizeSentinelSources(sources, 0, 1);

  assert.equal(summary.totalSources, 11);
  // The reading that used to say "Healthy 10 of 11" beside "9 Healthy".
  assert.equal(summary.healthySources, 9);
  assert.equal(summary.recoveredSources, 1);
  assert.equal(summary.operationalSources, 10);
  assert.equal(summary.degradedSources, 1);

  // The fleet bar and the KPI row are computed from the same numbers.
  assert.equal(summary.statusCounts.healthy, summary.healthySources);
  assert.equal(summary.statusCounts.recovered, summary.recoveredSources);
  assert.equal(
    summary.operationalSources,
    summary.healthySources + summary.recoveredSources,
  );

  // CURRENT and HISTORY are separate figures on separate fields.
  assert.equal(summary.openIncidents, 0);
  assert.equal(summary.resolvedIncidents, 1);
});

test("the source catalog summary splits healthy, recovered and operational too", async () => {
  const catalog = await getSourceCatalog({
    port: recoveredDemoPort(),
    now: () => NOW,
  });
  assert.equal(catalog.summary.healthy, 0);
  assert.equal(catalog.summary.recovered, 1);
  assert.equal(catalog.summary.operational, 1);
});
