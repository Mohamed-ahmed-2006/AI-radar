/**
 * Canonical persistence and the quarantine guarantee.
 *
 * The claims under test are the ones a judge would want checked rather than
 * asserted: a refused payload writes nothing, the previous good run is still
 * standing afterwards, and the refusal is recorded as evidence rather than
 * merely thrown.
 *
 * Only Bright Data and Supabase are doubled. `ingestDemoObservation`, the
 * contract, the evaluator and `assertSentinelSafe` are the real ones, so an
 * absent canonical row here is a write that genuinely did not happen.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { ingestDemoObservation } from "../../lib/demo-healing/persistence";
import { SentinelQuarantineError } from "../../lib/pipeline";
import {
  FakeDemoPipelineRepository,
  RunBackedSentinelRepository,
  testDemoConfiguration,
} from "./support/doubles";
import {
  containerLatchPayload,
  emptyPayload,
  healthyPayload,
  tableLayoutPayload,
} from "./support/payloads";

function harness() {
  const pipeline = new FakeDemoPipelineRepository();
  const sentinel = new RunBackedSentinelRepository(pipeline);
  const configuration = testDemoConfiguration();
  const observe = (layout: "healthy" | "broken", rawRecords: unknown[]) =>
    ingestDemoObservation({
      configuration,
      layout,
      rawRecords,
      triggeredBy: "test",
      repository: pipeline,
      sentinelRepository: sentinel,
    });
  return { pipeline, sentinel, configuration, observe };
}

test("persistence: a healthy observation writes canonical rows and completes its run", async () => {
  const { pipeline, observe } = harness();

  const result = await observe("healthy", healthyPayload());

  assert.equal(result.acceptedCount, healthyPayload().length);
  assert.equal(result.rejectedCount, 0);
  assert.equal(result.sentinel.status, "healthy");
  assert.equal(pipeline.quoteSnapshots.length, healthyPayload().length);
  assert.equal(pipeline.snapshotsForRun(result.collectionRunId).length, healthyPayload().length);
  assert.equal(pipeline.runs.at(-1)!.status, "succeeded");
});

test("persistence: canonical rows carry the provenance of the run that produced them", async () => {
  const { pipeline, configuration, observe } = harness();

  const result = await observe("healthy", healthyPayload());
  const row = pipeline.quoteSnapshots[0]!;

  assert.equal(row.runId, result.collectionRunId);
  assert.equal(row.sourceId, result.sourceId);
  assert.equal(row.sourceUrl, configuration.layouts.healthy.url);
  assert.ok(row.quoteKey.length > 0);
});

test("persistence: a refused payload writes exactly zero canonical rows", async () => {
  const { pipeline, observe } = harness();

  await assert.rejects(
    () => observe("broken", tableLayoutPayload()),
    (error: unknown) => {
      assert.ok(error instanceof SentinelQuarantineError);
      assert.ok(error.reasonCodes.includes("SCHEMA_VALIDATION_FAILURE"));
      return true;
    },
  );

  assert.equal(pipeline.quoteSnapshots.length, 0);
});

test("persistence: the refused run is closed as failed, not left open", async () => {
  const { pipeline, observe } = harness();

  await assert.rejects(() => observe("broken", tableLayoutPayload()));

  const run = pipeline.runs.at(-1)!;
  assert.equal(run.status, "failed");
  assert.notEqual(run.completed_at, null);
  assert.equal(run.records_accepted, 0);
  assert.ok(run.error_message && run.error_message.length > 0);
});

test("persistence: last-known-good survives a refusal untouched", async () => {
  const { pipeline, sentinel, observe } = harness();

  const baseline = await observe("healthy", healthyPayload());
  const goodBefore = await sentinel.getLastKnownGoodBaseline(baseline.sourceId);
  const rowsBefore = [...pipeline.quoteSnapshots];

  await assert.rejects(() => observe("broken", tableLayoutPayload()));

  const goodAfter = await sentinel.getLastKnownGoodBaseline(baseline.sourceId);
  assert.deepEqual(goodAfter, goodBefore);
  assert.equal(goodAfter!.runId, baseline.collectionRunId);
  // The canonical table is byte-for-byte what it was before the bad run.
  assert.deepEqual(pipeline.quoteSnapshots, rowsBefore);
  assert.equal(pipeline.snapshotsForRun(pipeline.runs.at(-1)!.id).length, 0);
});

test("persistence: the refusal is recorded as an incident with a quarantined payload", async () => {
  const { sentinel, observe } = harness();

  await observe("healthy", healthyPayload());
  await assert.rejects(() => observe("broken", tableLayoutPayload()));

  assert.equal(sentinel.incidents.length, 1);
  const incident = sentinel.incidents[0]!;
  assert.equal(incident.status, "open");
  assert.ok(incident.reason_codes.length > 0);
  // The baseline the incident names is the run that is still serving.
  assert.equal(incident.last_known_good_count, healthyPayload().length);

  assert.equal(sentinel.quarantinePayloads.length, 1);
  const quarantined = sentinel.quarantinePayloads[0]!;
  assert.equal(quarantined.incident_id, incident.id);
  assert.ok(quarantined.raw_payload, "the refused payload is kept as evidence");
});

test("persistence: a total extraction miss is refused too", async () => {
  const { pipeline, observe } = harness();

  await observe("healthy", healthyPayload());
  await assert.rejects(
    () => observe("broken", emptyPayload()),
    (error: unknown) =>
      error instanceof SentinelQuarantineError && error.reasonCodes.includes("ZERO_RECORDS"),
  );

  assert.equal(pipeline.quoteSnapshots.length, healthyPayload().length);
});

test("persistence: a container latch is refused despite every record parsing", async () => {
  const { pipeline, observe } = harness();

  await observe("healthy", healthyPayload());
  await assert.rejects(() => observe("broken", containerLatchPayload()));

  assert.equal(pipeline.quoteSnapshots.length, healthyPayload().length);
});

test("persistence: a collector-level failure is refused before any record is read", async () => {
  const { pipeline, configuration, sentinel } = harness();

  await assert.rejects(
    () =>
      ingestDemoObservation({
        configuration,
        layout: "broken",
        rawRecords: [],
        collectorError: "collector returned HTTP 500",
        triggeredBy: "test",
        repository: pipeline,
        sentinelRepository: sentinel,
      }),
    (error: unknown) =>
      error instanceof SentinelQuarantineError &&
      error.reasonCodes.includes("COLLECTOR_EXECUTION_FAILURE"),
  );

  assert.equal(pipeline.quoteSnapshots.length, 0);
});

test("persistence: switching layouts keeps one source and one continuous history", async () => {
  const { pipeline, observe } = harness();

  const first = await observe("healthy", healthyPayload());
  await assert.rejects(() => observe("broken", tableLayoutPayload()));
  const third = await observe("broken", healthyPayload());

  // Same source across all three, so last-known-good is continuous rather than
  // reset by pointing the collector at the other layout.
  assert.equal(third.sourceId, first.sourceId);
  assert.equal(pipeline.runs.length, 3);
});

test("persistence: recovery resumes canonical writes on the same source", async () => {
  const { pipeline, observe } = harness();

  const baseline = await observe("healthy", healthyPayload());
  await assert.rejects(() => observe("broken", tableLayoutPayload()));
  const recovered = await observe("broken", healthyPayload());

  assert.equal(recovered.sourceId, baseline.sourceId);
  assert.equal(recovered.acceptedCount, healthyPayload().length);
  assert.equal(pipeline.snapshotsForRun(recovered.collectionRunId).length, healthyPayload().length);
  assert.equal(pipeline.quoteSnapshots.length, healthyPayload().length * 2);
});
