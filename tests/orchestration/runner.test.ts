import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryOrchestrationRepository,
  runCollectionSource,
  type CollectionSourceDefinition,
} from "../../lib/orchestration";
import { InMemorySentinelRepository } from "../../lib/sentinel";
import { harnessSource, healthyRecordsFor } from "./support/fixtures";
import { canonicalWriteCount, collectorPayload } from "./support/pipeline-doubles";

const NOW = new Date("2026-08-18T12:00:00.000Z");

function tuned(
  source: CollectionSourceDefinition,
  overrides: Partial<CollectionSourceDefinition>,
): CollectionSourceDefinition {
  return { ...source, ...overrides };
}

function baseOptions() {
  return {
    invocationId: "inv-1",
    trigger: "cron",
    repository: new InMemoryOrchestrationRepository(),
    sentinelRepository: new InMemorySentinelRepository(),
    autoHealOverride: false,
    now: () => NOW,
    sleep: async () => {},
  };
}

test("a healthy run persists and records the orchestration run", async () => {
  const harness = harnessSource("openai-pricing", async () =>
    collectorPayload(healthyRecordsFor("openai-pricing"), {
      collectorId: "c_test",
      runId: "bright-1",
    }),
  );
  const options = baseOptions();

  const result = await runCollectionSource(harness.source, options);

  assert.equal(result.status, "succeeded");
  assert.equal(result.outcome, "completed");
  assert.equal(result.attempts, 1);
  assert.equal(result.recordsAccepted, 2);
  assert.equal(result.externalRunId, "bright-1");
  assert.equal(result.sentinel?.quarantined, false);
  assert.ok(result.durationMs >= 0);
  assert.ok(result.nextExpectedRunAt, "the next expected run is derivable");
  assert.ok(harness.pricing.pricingSnapshots.length > 0, "canonical rows were written");

  const run = options.repository.runs[0];
  assert.equal(run?.status, "succeeded");
  assert.equal(run?.outcome, "completed");
  assert.equal(run?.records_accepted, 2);
  assert.equal(run?.completed_at, NOW.toISOString());
  assert.ok(run?.collection_run_id, "the collection run is linked");
});

test("a collector that never answers is timed out and reported, not left hanging", async () => {
  const harness = harnessSource(
    "gemini-pricing",
    () => new Promise(() => {
      /* a collector that never settles */
    }),
  );
  const source = tuned(harness.source, {
    timeoutMs: 25,
    retry: { ...harness.source.retry, maxAttempts: 1, backoffMs: 1 },
  });
  const options = baseOptions();

  const result = await runCollectionSource(source, options);

  assert.equal(result.status, "failed");
  assert.equal(result.outcome, "timed_out");
  assert.equal(result.attempts, 1);
  assert.match(result.error?.message ?? "", /exceeded its 25ms budget/);
  assert.equal(canonicalWriteCount(harness.pricing), 0, "a timeout writes nothing canonical");
  assert.equal(options.repository.runs[0]?.status, "failed");
  assert.equal(options.repository.runs[0]?.outcome, "timed_out");
});

test("retries are bounded by policy and stop at the configured ceiling", async () => {
  const harness = harnessSource("xai-pricing", async () => {
    throw new Error("collector socket reset");
  });
  const source = tuned(harness.source, {
    timeoutMs: 500,
    retry: { ...harness.source.retry, maxAttempts: 3, backoffMs: 1, maxBackoffMs: 2 },
  });
  const backoffs: number[] = [];
  const options = { ...baseOptions(), sleep: async (ms: number) => void backoffs.push(ms) };

  const result = await runCollectionSource(source, options);

  assert.equal(result.status, "failed");
  assert.equal(result.outcome, "collector_failed");
  assert.equal(result.attempts, 3, "exactly the configured number of attempts");
  assert.equal(harness.collectCalls, 3, "the collector was called once per attempt");
  assert.equal(backoffs.length, 2, "backoff happens between attempts, not after the last one");
  assert.equal(options.repository.runs[0]?.attempt_count, 3);
});

test("a single attempt policy never retries", async () => {
  const harness = harnessSource("anthropic-pricing", async () => {
    throw new Error("collector unavailable");
  });
  const source = tuned(harness.source, {
    retry: { ...harness.source.retry, maxAttempts: 1 },
  });

  const result = await runCollectionSource(source, baseOptions());

  assert.equal(result.attempts, 1);
  assert.equal(harness.collectCalls, 1);
});

test("a transient failure that then succeeds is retried into a success", async () => {
  const harness = harnessSource("openai-pricing", async (attempt) => {
    if (attempt === 1) throw new Error("temporary Bright Data 503");
    return collectorPayload(healthyRecordsFor("openai-pricing"), {
      collectorId: "c_test",
      runId: "bright-retry",
    });
  });
  const source = tuned(harness.source, {
    retry: { ...harness.source.retry, maxAttempts: 3, backoffMs: 1 },
  });

  const result = await runCollectionSource(source, baseOptions());

  assert.equal(result.status, "succeeded");
  assert.equal(result.attempts, 2);
  assert.equal(result.recordsAccepted, 2);
});

test("a source already in flight is never run twice at once", async () => {
  const repository = new InMemoryOrchestrationRepository();
  const sentinelRepository = new InMemorySentinelRepository();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const slow = harnessSource("openai-pricing", async () => {
    await gate;
    return collectorPayload(healthyRecordsFor("openai-pricing"), {
      collectorId: "c_test",
      runId: "bright-slow",
    });
  });
  const second = harnessSource("openai-pricing", async () =>
    collectorPayload(healthyRecordsFor("openai-pricing"), {
      collectorId: "c_test",
      runId: "bright-second",
    }),
  );

  const inFlight = runCollectionSource(slow.source, {
    invocationId: "inv-first",
    trigger: "cron",
    repository,
    sentinelRepository,
    autoHealOverride: false,
    sleep: async () => {},
  });

  const overlapping = await runCollectionSource(second.source, {
    invocationId: "inv-second",
    trigger: "cron",
    repository,
    sentinelRepository,
    force: true,
    autoHealOverride: false,
    sleep: async () => {},
  });

  assert.equal(overlapping.status, "skipped");
  assert.equal(overlapping.outcome, "skipped_locked");
  assert.equal(second.collectCalls, 0, "the overlapping run never touched the collector");
  assert.equal(canonicalWriteCount(second.pricing), 0);

  release?.();
  const first = await inFlight;
  assert.equal(first.status, "succeeded");
  assert.equal(repository.runs.filter((run) => run.status === "running").length, 0);
});

test("a duplicate scheduler invocation is a no-op, not a second collection", async () => {
  const repository = new InMemoryOrchestrationRepository();
  const sentinelRepository = new InMemorySentinelRepository();
  const options = {
    invocationId: "cron-2026-08-18T12:00:00.000Z",
    trigger: "cron",
    repository,
    sentinelRepository,
    force: true,
    autoHealOverride: false,
    sleep: async () => {},
  };

  const harness = harnessSource("anthropic-lifecycle", async () =>
    collectorPayload(healthyRecordsFor("anthropic-lifecycle"), {
      collectorId: "c_test",
      runId: "bright-lifecycle",
    }),
  );

  const first = await runCollectionSource(harness.source, options);
  const replay = await runCollectionSource(harness.source, options);

  assert.equal(first.status, "succeeded");
  assert.equal(replay.status, "skipped");
  assert.equal(replay.outcome, "skipped_duplicate_invocation");
  assert.equal(harness.collectCalls, 1, "the collector ran once for one invocation");
  assert.equal(repository.runs.length, 1, "one orchestration run for one invocation");
});

test("cadence keeps a source from running again before it is due", async () => {
  const repository = new InMemoryOrchestrationRepository();
  const sentinelRepository = new InMemorySentinelRepository();
  const harness = harnessSource("openai-pricing", async () =>
    collectorPayload(healthyRecordsFor("openai-pricing"), {
      collectorId: "c_test",
      runId: "bright-cadence",
    }),
  );

  await runCollectionSource(harness.source, {
    invocationId: "inv-a",
    trigger: "cron",
    repository,
    sentinelRepository,
    now: () => NOW,
    autoHealOverride: false,
    sleep: async () => {},
  });

  const tooSoon = await runCollectionSource(harness.source, {
    invocationId: "inv-b",
    trigger: "cron",
    repository,
    sentinelRepository,
    now: () => new Date(NOW.getTime() + 60_000),
    autoHealOverride: false,
    sleep: async () => {},
  });

  assert.equal(tooSoon.status, "skipped");
  assert.equal(tooSoon.outcome, "skipped_not_due");
  assert.ok(tooSoon.nextExpectedRunAt, "the caller is told when it will next run");
  assert.equal(harness.collectCalls, 1);

  const later = await runCollectionSource(harness.source, {
    invocationId: "inv-c",
    trigger: "cron",
    repository,
    sentinelRepository,
    now: () => new Date(NOW.getTime() + harness.source.schedule.cadenceMinutes * 60_000 + 1_000),
    autoHealOverride: false,
    sleep: async () => {},
  });
  assert.equal(later.status, "succeeded");
});

test("a disabled source is skipped without touching state", async () => {
  const harness = harnessSource("xai-pricing", async () => {
    throw new Error("must not be collected");
  });
  const options = baseOptions();

  const result = await runCollectionSource(tuned(harness.source, { enabled: false }), options);

  assert.equal(result.status, "skipped");
  assert.equal(result.outcome, "skipped_disabled");
  assert.equal(harness.collectCalls, 0);
  assert.equal(options.repository.runs.length, 0, "no lease is taken for a disabled source");
});

test("an abandoned lease is reclaimed once it expires", async () => {
  const repository = new InMemoryOrchestrationRepository();
  const sentinelRepository = new InMemorySentinelRepository();
  await repository.acquireLease({
    sourceKey: "gemini-pricing",
    providerSlug: "gemini",
    sourceType: "pricing",
    trigger: "cron",
    invocationId: "inv-dead",
    leaseMs: 1_000,
    startedAt: new Date(NOW.getTime() - 60_000).toISOString(),
  });

  const harness = harnessSource("gemini-pricing", async () =>
    collectorPayload(healthyRecordsFor("gemini-pricing"), {
      collectorId: "c_test",
      runId: "bright-reclaim",
    }),
  );

  const result = await runCollectionSource(harness.source, {
    invocationId: "inv-live",
    trigger: "cron",
    repository,
    sentinelRepository,
    force: true,
    now: () => NOW,
    autoHealOverride: false,
    sleep: async () => {},
  });

  assert.equal(result.status, "succeeded");
  const abandoned = repository.runs.find((run) => run.invocation_id === "inv-dead");
  assert.equal(abandoned?.status, "failed");
  assert.equal(abandoned?.outcome, "timed_out");
});
