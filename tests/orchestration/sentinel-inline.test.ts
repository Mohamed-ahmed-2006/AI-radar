/**
 * Proof that Sentinel is inline on the real ingestion path of every configured
 * source, not bolted on around it.
 *
 * These tests drive the production pipeline functions. Only Supabase and Bright
 * Data are doubles, so any canonical row the doubles record is a row a real
 * collection would have written.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  COLLECTION_SOURCE_KEYS,
  getCollectionSource,
  runCollectionSource,
  type CollectionSourceKey,
} from "../../lib/orchestration";
import {
  InMemoryOrchestrationRepository,
} from "../../lib/orchestration";
import { SentinelQuarantineError } from "../../lib/pipeline";
import { InMemorySentinelRepository, type SentinelHealer } from "../../lib/sentinel";
import {
  harnessSource,
  healthyRecordsFor,
  malformedRecordsFor,
} from "./support/fixtures";
import {
  canonicalWriteCount,
  collectorPayload,
  type CanonicalWriteLog,
} from "./support/pipeline-doubles";

function canonicalLog(harness: {
  pricing: CanonicalWriteLog;
  lifecycle: CanonicalWriteLog;
  catalog: CanonicalWriteLog;
}): CanonicalWriteLog {
  return {
    models: [
      ...harness.pricing.models,
      ...harness.lifecycle.models,
      ...harness.catalog.models,
    ],
    pricingSnapshots: [
      ...harness.pricing.pricingSnapshots,
      ...harness.lifecycle.pricingSnapshots,
      ...(harness.catalog.pricingSnapshots ?? []),
    ],
    lifecycleSnapshots: [
      ...harness.pricing.lifecycleSnapshots,
      ...harness.lifecycle.lifecycleSnapshots,
      ...(harness.catalog.lifecycleSnapshots ?? []),
    ],
    capabilitySnapshots: [
      ...(harness.pricing.capabilitySnapshots ?? []),
      ...(harness.lifecycle.capabilitySnapshots ?? []),
      ...harness.catalog.capabilitySnapshots,
    ],
    lifecycleProjections: [
      ...harness.pricing.lifecycleProjections,
      ...harness.lifecycle.lifecycleProjections,
      ...(harness.catalog.lifecycleProjections ?? []),
    ],
    changeEvents: [
      ...harness.pricing.changeEvents,
      ...harness.lifecycle.changeEvents,
      ...harness.catalog.changeEvents,
    ],
    runs: [
      ...harness.pricing.runs,
      ...harness.lifecycle.runs,
      ...harness.catalog.runs,
    ],
  };
}


for (const key of COLLECTION_SOURCE_KEYS) {
  test(`${key}: a malformed real-source payload is quarantined before canonical persistence`, async () => {
    const sentinelRepository = new InMemorySentinelRepository();
    const definition = getCollectionSource(key);
    const harness = harnessSource(key, async () =>
      collectorPayload(malformedRecordsFor(key), {
        collectorId: definition.collectorId,
        runId: `${key}-broken`,
      }),
    );

    await assert.rejects(
      () => harness.source.persist(
        collectorPayload(malformedRecordsFor(key), {
          collectorId: definition.collectorId,
          runId: `${key}-broken`,
        }),
        { triggeredBy: "test", sentinelRepository },
      ),
      SentinelQuarantineError,
      `${key} must refuse a malformed payload`,
    );

    const log = canonicalLog(harness);
    assert.equal(log.models.length, 0, `${key}: no model row was written`);
    assert.equal(log.pricingSnapshots.length, 0, `${key}: no pricing snapshot was written`);
    assert.equal(log.lifecycleSnapshots.length, 0, `${key}: no lifecycle snapshot was written`);
    assert.equal(log.lifecycleProjections.length, 0, `${key}: no lifecycle projection was applied`);
    assert.equal(log.changeEvents.length, 0, `${key}: no change event was written`);
    assert.equal(canonicalWriteCount(log), 0);

    // The rejection is recorded: a failed run, an incident, and the raw payload
    // isolated in quarantine.
    assert.equal(log.runs.at(-1)?.status, "failed", `${key}: the collection run is failed`);
    assert.equal(sentinelRepository.incidents.length, 1, `${key}: one incident was opened`);
    assert.equal(sentinelRepository.incidents[0]?.status, "open");
    assert.equal(
      sentinelRepository.quarantinePayloads.length,
      1,
      `${key}: the raw payload was quarantined`,
    );
  });

  test(`${key}: a healthy real-source payload reaches canonical persistence`, async () => {
    const sentinelRepository = new InMemorySentinelRepository();
    const definition = getCollectionSource(key);
    const harness = harnessSource(key, async () =>
      collectorPayload(healthyRecordsFor(key), {
        collectorId: definition.collectorId,
        runId: `${key}-healthy`,
      }),
    );

    const result = await harness.source.persist(
      collectorPayload(healthyRecordsFor(key), {
        collectorId: definition.collectorId,
        runId: `${key}-healthy`,
      }),
      { triggeredBy: "test", sentinelRepository },
    );

    assert.equal(result.success, true);
    assert.equal(result.acceptedCount, 2, `${key}: both records were accepted`);
    assert.equal(result.sentinel?.status, "healthy", `${key}: the gate reported health`);
    assert.equal(sentinelRepository.incidents.length, 0, `${key}: no incident was opened`);

    const log = canonicalLog(harness);
    assert.ok(log.models.length > 0, `${key}: canonical models were written`);
    const wroteIntelligence =
      log.pricingSnapshots.length > 0 ||
      log.lifecycleSnapshots.length > 0 ||
      (log.capabilitySnapshots?.length ?? 0) > 0;
    assert.ok(wroteIntelligence, `${key}: canonical intelligence rows were written`);

    assert.equal(log.runs.at(-1)?.status, "succeeded");
  });
}

test("a collector failure opens an incident and writes nothing canonical", async () => {
  const sentinelRepository = new InMemorySentinelRepository();
  const key: CollectionSourceKey = "anthropic-pricing";
  const definition = getCollectionSource(key);
  const harness = harnessSource(key, async () =>
    collectorPayload([], {
      collectorId: definition.collectorId,
      runId: `${key}-down`,
      success: false,
      error: "Bright Data collector returned HTTP 502",
    }),
  );

  await assert.rejects(
    () => harness.source.persist(
      collectorPayload([], {
        collectorId: definition.collectorId,
        runId: `${key}-down`,
        success: false,
        error: "Bright Data collector returned HTTP 502",
      }),
      { triggeredBy: "test", sentinelRepository },
    ),
    SentinelQuarantineError,
  );

  assert.equal(canonicalWriteCount(canonicalLog(harness)), 0);
  assert.deepEqual(sentinelRepository.incidents[0]?.reason_codes, ["COLLECTOR_EXECUTION_FAILURE"]);
  assert.equal(harness.pricing.runs.at(-1)?.status, "failed");
});

test("the orchestrated path inherits the same gate: quarantine stops persistence end to end", async () => {
  const key: CollectionSourceKey = "gemini-lifecycle";
  const definition = getCollectionSource(key);
  const sentinelRepository = new InMemorySentinelRepository();
  const repository = new InMemoryOrchestrationRepository();
  const harness = harnessSource(key, async () =>
    collectorPayload(malformedRecordsFor(key), {
      collectorId: definition.collectorId,
      runId: `${key}-broken`,
    }),
  );

  const result = await runCollectionSource(harness.source, {
    invocationId: "inv-quarantine",
    trigger: "cron",
    repository,
    sentinelRepository,
    autoHealOverride: false,
    sleep: async () => {},
  });

  assert.equal(result.status, "quarantined");
  assert.equal(result.outcome, "quarantined");
  assert.equal(result.sentinel?.quarantined, true);
  assert.ok(result.sentinel?.incidentId, "the incident is reported back to the scheduler");
  assert.equal(result.recordsAccepted, 0);
  assert.equal(canonicalWriteCount(canonicalLog(harness)), 0, "nothing canonical was written");
  assert.equal(repository.runs[0]?.status, "quarantined");
  assert.equal(sentinelRepository.quarantinePayloads.length, 1);
});

test("healing re-enters the pipeline, so a repaired candidate must still pass the gate", async () => {
  const key: CollectionSourceKey = "openai-pricing";
  const definition = getCollectionSource(key);
  const sentinelRepository = new InMemorySentinelRepository();
  const repository = new InMemoryOrchestrationRepository();
  const harness = harnessSource(key, async () =>
    collectorPayload(malformedRecordsFor(key), {
      collectorId: definition.collectorId,
      runId: `${key}-broken`,
    }),
  );

  // The "repaired" collector still emits rows that violate the contract.
  const brokenHealer: SentinelHealer = {
    healScraper: async <T>() => ({
      success: true,
      status: "approved" as const,
      candidateData: malformedRecordsFor(key) as T[],
    }),
  };

  const result = await runCollectionSource(harness.source, {
    invocationId: "inv-heal",
    trigger: "cron",
    repository,
    sentinelRepository,
    healer: brokenHealer,
    autoHealOverride: true,
    sleep: async () => {},
  });

  assert.equal(result.status, "quarantined", "a bad candidate cannot recover the source");
  assert.equal(result.sentinel?.healingAttempted, true);
  assert.equal(result.sentinel?.healingOutcome, "healed_candidate_rejected");
  assert.equal(canonicalWriteCount(canonicalLog(harness)), 0, "healing is not a bypass");
});
