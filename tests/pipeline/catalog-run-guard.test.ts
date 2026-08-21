/**
 * A collection run must always reach a terminal state.
 *
 * Production carried a Gemini catalog run stuck in `running` with no completion
 * timestamp for over a day. Its orchestration run had already been recorded as
 * `persistence_failed` — `completeCollectionRun` had thrown on the
 * `collection_runs_counts_balance` constraint — but nothing between
 * `startCollectionRun` and that throw finalized the `collection_runs` row, so
 * Source Detail kept reporting a dead run as in flight.
 *
 * The catalog pipeline was the only one of the four missing this handler. These
 * tests pin it back on: whatever the failure, the run row ends terminal and the
 * original error still reaches the caller unchanged.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { CATALOG_PROVIDERS, ingestCatalogProvider } from "../../lib/pipeline";
import { InMemorySentinelRepository } from "../../lib/sentinel";
import {
  RecordingCatalogRepository,
  collectorPayload,
} from "../orchestration/support/pipeline-doubles";
import { geminiCatalogRecords } from "../orchestration/support/fixtures";

function payload() {
  return collectorPayload(geminiCatalogRecords(), {
    collectorId: "c_gemini_catalog",
    runId: "run-gemini-guard",
  });
}

test("catalog run guard: a persistence failure finalizes the run instead of abandoning it", async () => {
  const repository = new RecordingCatalogRepository("provider-gemini");
  const boom = new Error(
    'new row for relation "collection_runs" violates check constraint "collection_runs_counts_balance"',
  );
  repository.completeCollectionRun = async () => {
    throw boom;
  };

  await assert.rejects(
    ingestCatalogProvider(CATALOG_PROVIDERS.gemini, {
      repository,
      sentinelRepository: new InMemorySentinelRepository(),
      collect: async () => payload(),
      triggeredBy: "test",
    }),
    // The guard reports, it does not swallow: the caller still sees the fault
    // that actually happened, so orchestration classifies it the same way.
    (error: unknown) => error === boom,
  );

  assert.equal(repository.runs.length, 1);
  const run = repository.runs[0];
  assert.equal(run.status, "failed");
  assert.notEqual(run.completed_at, null);
  assert.match(String(run.error_message), /counts_balance/);
});

test("catalog run guard: a failure anywhere after the run opens still closes it", async () => {
  const repository = new RecordingCatalogRepository("provider-gemini");
  repository.saveCapabilitySnapshots = async () => {
    throw new Error("snapshot write rejected");
  };

  await assert.rejects(
    ingestCatalogProvider(CATALOG_PROVIDERS.gemini, {
      repository,
      sentinelRepository: new InMemorySentinelRepository(),
      collect: async () => payload(),
      triggeredBy: "test",
    }),
  );

  const run = repository.runs[0];
  assert.equal(run.status, "failed");
  assert.notEqual(run.completed_at, null);
  assert.match(String(run.error_message), /snapshot write rejected/);
});

test("catalog run guard: a successful ingestion is untouched by the guard", async () => {
  const repository = new RecordingCatalogRepository("provider-gemini");

  const result = await ingestCatalogProvider(CATALOG_PROVIDERS.gemini, {
    repository,
    sentinelRepository: new InMemorySentinelRepository(),
    collect: async () => payload(),
    triggeredBy: "test",
  });

  assert.equal(result.success, true);
  const run = repository.runs[0];
  assert.ok(run.status === "succeeded" || run.status === "partial");
  assert.notEqual(run.completed_at, null);
  assert.equal(run.error_message, null);
});
