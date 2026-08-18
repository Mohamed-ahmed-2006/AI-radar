import test from "node:test";
import assert from "node:assert/strict";

import {
  InMemorySourceReadPort,
  getSourceCatalog,
  getSourceDetail,
} from "../../lib/sources";
import {
  ANTHROPIC_PROVIDER,
  CLAUDE_MODEL,
  LIFECYCLE_SOURCE,
  NOW,
  OPENAI_PROVIDER,
  PRICING_SOURCE,
  healingAttempt,
  healthySourceData,
  incident,
  lifecycleSnapshot,
  minutesAgo,
  run,
  sentinelHealth,
} from "./support/fixtures";

const now = () => NOW;

test("Source detail: a healthy source reports identity, contract, freshness and evidence", async () => {
  const port = new InMemorySourceReadPort(healthySourceData());
  const detail = await getSourceDetail(PRICING_SOURCE.id, { port, now });

  assert.ok(detail, "healthy source must resolve");

  assert.equal(detail.identity.sourceId, PRICING_SOURCE.id);
  assert.equal(detail.identity.providerSlug, "openai");
  assert.equal(detail.identity.providerName, "OpenAI");
  assert.equal(detail.identity.category, "pricing");
  assert.equal(detail.identity.collectorId, "c_openai_pricing");
  assert.equal(detail.identity.enabled, true);
  assert.equal(detail.identity.sourceUrl, PRICING_SOURCE.source_url);

  assert.equal(detail.health.status, "healthy");
  assert.equal(detail.health.lastSuccessfulRunId, "run-latest");
  assert.equal(detail.health.currentRecordCount, 12);
  assert.equal(detail.health.activeIncident, null);
  assert.equal(detail.health.freshness.status, "fresh");
  assert.equal(detail.health.freshness.ageMinutes, 59);
  assert.equal(detail.health.freshness.maxStalenessMinutes, 1440);

  // Contract: semantic expectations, never executable configuration.
  assert.ok(detail.contract);
  assert.equal(detail.contract.authorityDomain, "pricing");
  assert.equal(detail.contract.isAuthoritative, false);
  assert.ok(detail.contract.requiredFields.includes("model_name"));
  assert.equal(detail.contract.failurePolicy.autoHeal, true);

  // Observations collapse to the newest per (model, mode, tier); history keeps
  // every value the source has published.
  assert.equal(detail.observations.length, 1);
  assert.equal(detail.observations[0]?.snapshotId, "snap-new");
  assert.equal(detail.observations[0]?.values.inputPricePer1MTokens, 1.25);
  assert.equal(detail.history.length, 2);
  assert.equal(detail.history[1]?.values.inputPricePer1MTokens, 2.5);
});

test("Source detail: raw observation is paired with the canonical value it produced", async () => {
  const port = new InMemorySourceReadPort(healthySourceData());
  const detail = await getSourceDetail(PRICING_SOURCE.id, { port, now });

  const transformation = detail?.transformation;
  assert.ok(transformation);
  assert.equal(transformation.snapshotId, "snap-new");

  const byField = new Map(
    transformation.fields.map((field) => [field.normalizedField, field]),
  );

  // Structural key matching: `inputPrice` resolves to input_price_per_1m_tokens.
  const input = byField.get("inputPricePer1MTokens");
  assert.equal(input?.rawField, "inputPrice");
  assert.equal(input?.rawValue, "$1.25");
  assert.equal(input?.normalizedValue, 1.25);
  assert.equal(input?.derivation, "mapped");

  // Spaces and case are ignored too.
  assert.equal(byField.get("cachedInputPricePer1MTokens")?.rawField, "Cached input");

  // A canonical field with no raw counterpart is reported as derived, not
  // silently dropped.
  const tier = byField.get("contextTier");
  assert.equal(tier?.rawField, null);
  assert.equal(tier?.derivation, "derived");
  assert.equal(tier?.normalizedValue, "default");
});

test("Source detail: lifecycle source exposes authoritative contract and lifecycle evidence", async () => {
  const port = new InMemorySourceReadPort({
    sources: [LIFECYCLE_SOURCE],
    providers: [ANTHROPIC_PROVIDER],
    models: [CLAUDE_MODEL],
    runs: [run({ id: "run-lc", source_id: LIFECYCLE_SOURCE.id, started_at: minutesAgo(90) })],
    sentinelHealth: [
      sentinelHealth({
        source_id: LIFECYCLE_SOURCE.id,
        provider_id: ANTHROPIC_PROVIDER.id,
        provider_slug: "anthropic",
        provider_name: "Anthropic",
        kind: "models",
        last_run_id: "run-lc",
        last_run_status: "succeeded",
        last_run_started_at: minutesAgo(90),
        last_run_completed_at: minutesAgo(89),
        last_run_records_accepted: 9,
        sentinel_health_status: "healthy",
      }),
    ],
    lifecycleSnapshots: [lifecycleSnapshot({ id: "lc-1", run_id: "run-lc" })],
  });

  const detail = await getSourceDetail(LIFECYCLE_SOURCE.id, { port, now });
  assert.ok(detail);
  assert.equal(detail.identity.category, "lifecycle");
  assert.equal(detail.contract?.authorityDomain, "lifecycle");
  assert.equal(detail.contract?.isAuthoritative, true);
  assert.equal(detail.observations[0]?.values.lifecycleState, "deprecated");
  assert.equal(detail.observations[0]?.values.retirementDate, "2026-10-22");
  assert.equal(detail.transformation?.fields[1]?.rawField, "current_state");
  assert.equal(detail.transformation?.fields[1]?.rawValue, "Deprecated");
});

test("Source detail: a degraded, quarantined source reports the incident and the last known good baseline", async () => {
  const data = healthySourceData();
  const port = new InMemorySourceReadPort({
    ...data,
    runs: [
      run({
        id: "run-bad",
        source_id: PRICING_SOURCE.id,
        started_at: minutesAgo(20),
        status: "failed",
        records_seen: 3,
        records_accepted: 0,
        records_rejected: 3,
        error_message: "Selector .price-table returned 0 rows",
      }),
      ...(data.runs ?? []),
    ],
    sentinelHealth: [
      sentinelHealth({
        source_id: PRICING_SOURCE.id,
        last_run_id: "run-bad",
        last_run_status: "failed",
        last_run_started_at: minutesAgo(20),
        last_run_completed_at: minutesAgo(19),
        last_run_records_seen: 3,
        last_run_records_accepted: 0,
        last_run_records_rejected: 3,
        active_incident_id: "inc-1",
        active_incident_status: "open",
        active_incident_severity: "critical",
        active_reason_codes: ["RECORD_COUNT_COLLAPSE", "SCHEMA_VALIDATION_FAILURE"],
        healing_attempt_count: 1,
        last_known_good_count: 12,
        last_known_good_at: minutesAgo(60),
        sentinel_health_status: "quarantined",
      }),
    ],
    incidents: [
      incident({
        id: "inc-1",
        source_id: PRICING_SOURCE.id,
        run_id: "run-bad",
        reason_codes: ["RECORD_COUNT_COLLAPSE", "SCHEMA_VALIDATION_FAILURE"],
        last_known_good_run_id: "run-latest",
        healing_attempt_count: 1,
      }),
    ],
    healingAttempts: [
      healingAttempt({
        id: "heal-1",
        source_id: PRICING_SOURCE.id,
        incident_id: "inc-1",
        status: "in_progress",
        candidate_passed_validation: null,
        candidate_records_count: null,
        completed_at: null,
      }),
    ],
  });

  const detail = await getSourceDetail(PRICING_SOURCE.id, { port, now });
  assert.ok(detail);

  assert.equal(detail.health.status, "quarantined");
  assert.equal(detail.health.activeIncident?.incidentId, "inc-1");
  assert.deepEqual(detail.health.activeIncident?.reasonCodes, [
    "RECORD_COUNT_COLLAPSE",
    "SCHEMA_VALIDATION_FAILURE",
  ]);
  assert.equal(detail.health.currentRecordCount, 0);
  assert.equal(detail.health.expectedRecordCount, 12);
  assert.equal(detail.health.lastKnownGoodCount, 12);
  assert.equal(detail.health.lastKnownGoodRunId, "run-latest");

  // The last *successful* run still anchors freshness, not the failed attempt.
  assert.equal(detail.health.lastSuccessfulRunId, "run-latest");
  assert.equal(detail.health.lastAttemptedRunId, "run-bad");

  assert.equal(detail.incidents[0]?.quarantined, true);
  assert.equal(detail.incidents[0]?.recordsInvalid, 2);
  assert.equal(detail.runs[0]?.status, "failed");
  assert.equal(detail.runs[0]?.validationStatus, "failed");
  assert.equal(detail.healing[0]?.outcome, "in_progress");
});

test("Source detail: a recovered source reports resolution and a validated healing candidate", async () => {
  const data = healthySourceData();
  const port = new InMemorySourceReadPort({
    ...data,
    sentinelHealth: [
      sentinelHealth({
        source_id: PRICING_SOURCE.id,
        last_run_id: "run-latest",
        last_run_status: "succeeded",
        last_run_started_at: minutesAgo(60),
        last_run_completed_at: minutesAgo(59),
        last_run_records_accepted: 12,
        active_incident_id: "inc-1",
        active_incident_status: "resolved",
        active_incident_severity: "critical",
        active_reason_codes: ["RECORD_COUNT_COLLAPSE"],
        healing_attempt_count: 2,
        last_known_good_count: 12,
        last_known_good_at: minutesAgo(420),
        sentinel_health_status: "recovered",
      }),
    ],
    incidents: [
      incident({
        id: "inc-1",
        source_id: PRICING_SOURCE.id,
        status: "resolved",
        resolved_at: minutesAgo(58),
        healing_attempt_count: 2,
        resolution_note: "Collector healed and revalidated",
      }),
    ],
    healingAttempts: [
      healingAttempt({
        id: "heal-2",
        source_id: PRICING_SOURCE.id,
        incident_id: "inc-1",
        attempt_number: 2,
        status: "approved",
        started_at: minutesAgo(70),
      }),
      healingAttempt({
        id: "heal-1",
        source_id: PRICING_SOURCE.id,
        incident_id: "inc-1",
        attempt_number: 1,
        status: "candidate_rejected",
        candidate_passed_validation: false,
        started_at: minutesAgo(80),
      }),
    ],
  });

  const detail = await getSourceDetail(PRICING_SOURCE.id, { port, now });
  assert.ok(detail);

  assert.equal(detail.health.status, "recovered");
  assert.equal(detail.incidents[0]?.status, "resolved");
  assert.equal(detail.incidents[0]?.quarantined, false);
  assert.ok(detail.incidents[0]?.resolvedAt);

  // Healing timeline is newest first, and each attempt carries its outcome.
  assert.deepEqual(
    detail.healing.map((attempt) => [attempt.attemptNumber, attempt.outcome]),
    [
      [2, "recovered"],
      [1, "rejected"],
    ],
  );
  assert.equal(detail.healing[0]?.candidatePassedValidation, true);
});

test("Source detail: run history is newest first and carries run identity, duration and validation status", async () => {
  const port = new InMemorySourceReadPort({
    ...healthySourceData(),
    runs: [
      run({ id: "run-mid", source_id: PRICING_SOURCE.id, started_at: minutesAgo(420) }),
      run({ id: "run-old", source_id: PRICING_SOURCE.id, started_at: minutesAgo(780) }),
      run({
        id: "run-latest",
        source_id: PRICING_SOURCE.id,
        started_at: minutesAgo(60),
        status: "partial",
        records_seen: 12,
        records_accepted: 10,
        records_rejected: 2,
      }),
    ],
  });

  const detail = await getSourceDetail(PRICING_SOURCE.id, { port, now });
  assert.ok(detail);

  assert.deepEqual(
    detail.runs.map((entry) => entry.runId),
    ["run-latest", "run-mid", "run-old"],
  );
  assert.equal(detail.runs[0]?.validationStatus, "partial");
  assert.equal(detail.runs[0]?.externalRunId, "bd_run-latest");
  assert.equal(detail.runs[0]?.durationMs, 42_000);
  assert.equal(detail.runs[1]?.validationStatus, "passed");
  assert.equal(detail.counts.runs, 3);
});

test("Source detail: freshness degrades to stale past the contracted staleness budget", async () => {
  const port = new InMemorySourceReadPort({
    ...healthySourceData(),
    runs: [
      run({ id: "run-latest", source_id: PRICING_SOURCE.id, started_at: minutesAgo(3000) }),
    ],
    sentinelHealth: [
      sentinelHealth({
        source_id: PRICING_SOURCE.id,
        last_run_id: "run-latest",
        last_run_status: "succeeded",
        last_run_started_at: minutesAgo(3000),
        last_run_completed_at: minutesAgo(2999),
        last_run_records_accepted: 12,
      }),
    ],
  });

  const detail = await getSourceDetail(PRICING_SOURCE.id, { port, now });
  assert.equal(detail?.health.freshness.status, "stale");
  assert.equal(detail?.health.freshness.ageMinutes, 2999);
  assert.ok(detail?.health.freshness.staleAfter);
});

test("Source detail: an unknown source id resolves to null so the route can answer 404", async () => {
  const port = new InMemorySourceReadPort(healthySourceData());
  assert.equal(await getSourceDetail("src-does-not-exist", { port, now }), null);
});

test("Source catalog: summarizes every source without an N+1 read per source", async () => {
  const data = healthySourceData();
  const port = new InMemorySourceReadPort({
    ...data,
    sources: [PRICING_SOURCE, LIFECYCLE_SOURCE],
    providers: [OPENAI_PROVIDER, ANTHROPIC_PROVIDER],
    runs: [
      ...(data.runs ?? []),
      run({ id: "run-lc", source_id: LIFECYCLE_SOURCE.id, started_at: minutesAgo(90) }),
    ],
    sentinelHealth: [
      ...(data.sentinelHealth ?? []),
      sentinelHealth({
        source_id: LIFECYCLE_SOURCE.id,
        provider_id: ANTHROPIC_PROVIDER.id,
        provider_slug: "anthropic",
        kind: "models",
        last_run_id: "run-lc",
        last_run_status: "succeeded",
        last_run_started_at: minutesAgo(90),
        last_run_completed_at: minutesAgo(89),
        last_run_records_accepted: 9,
        sentinel_health_status: "degraded",
      }),
    ],
  });

  const catalog = await getSourceCatalog({ port, now });

  assert.equal(catalog.summary.totalSources, 2);
  assert.equal(catalog.summary.enabledSources, 2);
  assert.equal(catalog.summary.healthy, 1);
  assert.equal(catalog.summary.degraded, 1);

  const lifecycle = catalog.sources.find(
    (source) => source.identity.sourceId === LIFECYCLE_SOURCE.id,
  );
  assert.equal(lifecycle?.identity.category, "lifecycle");
  assert.equal(lifecycle?.contract?.isAuthoritative, true);
  assert.equal(lifecycle?.health.lastSuccessfulRunId, "run-lc");
});
