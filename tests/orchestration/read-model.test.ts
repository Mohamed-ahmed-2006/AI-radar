import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryOrchestrationRepository,
  SCHEDULER_TICK,
  computeBackoffMs,
  computeNextRunAt,
  evaluateSchedule,
  getCollectionSource,
  getOrchestrationReadModel,
  handleOrchestrationStatusRequest,
  listCollectionSources,
  runCollectionFleet,
} from "../../lib/orchestration";
import { InMemorySentinelRepository } from "../../lib/sentinel";
import { harnessSource, healthyRecordsFor, malformedRecordsFor } from "./support/fixtures";
import { collectorPayload } from "./support/pipeline-doubles";

const NOW = new Date("2026-08-18T12:00:00.000Z");

test("cadence arithmetic decides what is due without polling", () => {
  const source = getCollectionSource("openai-pricing");
  const cadenceMs = source.schedule.cadenceMinutes * 60_000;

  assert.equal(computeNextRunAt(null, 360), null, "a source that never ran has no next run");
  assert.equal(
    computeNextRunAt("2026-08-18T00:00:00.000Z", 360),
    "2026-08-18T06:00:00.000Z",
  );

  assert.deepEqual(evaluateSchedule(source, null, NOW), {
    due: true,
    reason: "never_run",
    nextExpectedRunAt: null,
  });
  assert.equal(evaluateSchedule(source, NOW.toISOString(), NOW).due, false);
  assert.equal(
    evaluateSchedule(source, NOW.toISOString(), new Date(NOW.getTime() + cadenceMs)).due,
    true,
  );
  assert.equal(
    evaluateSchedule(source, NOW.toISOString(), NOW, { force: true }).reason,
    "forced",
  );
  assert.equal(
    evaluateSchedule({ ...source, enabled: false }, null, NOW).reason,
    "disabled",
  );
});

test("backoff grows and is capped by the policy", () => {
  const policy = { backoffMs: 1_000, backoffMultiplier: 2, maxBackoffMs: 5_000 };
  assert.equal(computeBackoffMs(policy, 1), 1_000);
  assert.equal(computeBackoffMs(policy, 2), 2_000);
  assert.equal(computeBackoffMs(policy, 3), 4_000);
  assert.equal(computeBackoffMs(policy, 4), 5_000);
  assert.equal(computeBackoffMs(policy, 40), 5_000);
});

test("the status read model reports every source, including one that failed", async () => {
  const repository = new InMemoryOrchestrationRepository();
  const sentinelRepository = new InMemorySentinelRepository();
  const sources = listCollectionSources().map((source) => {
    const harness = harnessSource(source.key, async () => {
      if (source.key === "gemini-pricing") throw new Error("gemini collector is unreachable");
      const records =
        source.key === "xai-pricing"
          ? malformedRecordsFor(source.key)
          : healthyRecordsFor(source.key);
      return collectorPayload(records, { collectorId: "c_test", runId: `${source.key}-run` });
    });
    return {
      ...harness.source,
      retry: { ...harness.source.retry, maxAttempts: 1, backoffMs: 1 },
    };
  });

  await runCollectionFleet({
    sources,
    repository,
    sentinelRepository,
    trigger: "cron",
    autoHealOverride: false,
    sleep: async () => {},
    now: () => NOW,
  });

  const readModel = await getOrchestrationReadModel({
    repository,
    sources,
    loadSentinel: async () => {
      throw new Error("sentinel read model unavailable");
    },
    now: () => new Date(NOW.getTime() + 60_000),
  });

  assert.equal(readModel.sources.length, 10, "a failing source never hides the others");
  assert.equal(readModel.summary.succeeding, 8);
  assert.equal(readModel.summary.failing, 1);
  assert.equal(readModel.summary.quarantined, 1);
  assert.equal(readModel.summary.running, 0);

  assert.equal(readModel.scheduler.mechanism, "scheduled-workflow");
  assert.equal(readModel.scheduler.path, SCHEDULER_TICK.path);
  assert.equal(readModel.scheduler.cronExpression, SCHEDULER_TICK.cronExpression);

  const openai = readModel.sources.find((source) => source.sourceKey === "openai-pricing");
  assert.equal(openai?.lastAttempt?.startedAt, NOW.toISOString());
  assert.equal(openai?.lastSuccess?.status, "succeeded");
  assert.equal(openai?.latestResult?.outcome, "completed");
  assert.equal(openai?.latestResult?.recordsAccepted, 2);
  assert.equal(typeof openai?.latestResult?.durationMs, "number");
  assert.equal(
    openai?.nextExpectedRunAt,
    new Date(NOW.getTime() + openai!.schedule.cadenceMinutes * 60_000).toISOString(),
  );

  const failing = readModel.sources.find((source) => source.sourceKey === "gemini-pricing");
  assert.equal(failing?.latestResult?.status, "failed");
  assert.equal(failing?.lastSuccess, null, "a source that never succeeded says so");
  assert.equal(failing?.consecutiveFailures, 1);

  const quarantined = readModel.sources.find((source) => source.sourceKey === "xai-pricing");
  assert.equal(quarantined?.latestResult?.status, "quarantined");
  assert.equal(quarantined?.needsAttention, true);
  assert.ok((quarantined?.latestResult?.reasonCodes.length ?? 0) > 0);
});

test("a run in flight is reported as running", async () => {
  const repository = new InMemoryOrchestrationRepository();
  await repository.acquireLease({
    sourceKey: "anthropic-lifecycle",
    providerSlug: "anthropic",
    sourceType: "lifecycle",
    trigger: "cron",
    invocationId: "inv-live",
    leaseMs: 300_000,
    startedAt: NOW.toISOString(),
  });

  const readModel = await getOrchestrationReadModel({
    repository,
    loadSentinel: async () => {
      throw new Error("not needed");
    },
    now: () => new Date(NOW.getTime() + 1_000),
  });

  const source = readModel.sources.find((entry) => entry.sourceKey === "anthropic-lifecycle");
  assert.equal(source?.running, true);
  assert.equal(source?.lastAttempt?.status, "running");
  assert.equal(source?.latestResult, null, "an in-flight run has no result yet");
  assert.equal(readModel.summary.running, 1);
});

test("the public status payload withholds collector ids and diagnostics", async () => {
  const repository = new InMemoryOrchestrationRepository();
  await repository.acquireLease({
    sourceKey: "openai-pricing",
    providerSlug: "openai",
    sourceType: "pricing",
    trigger: "cron",
    invocationId: "inv-1",
    leaseMs: 1_000,
    startedAt: NOW.toISOString(),
  });
  await repository.completeRun(repository.runs[0].id, {
    status: "failed",
    outcome: "collector_failed",
    attemptCount: 1,
    completedAt: NOW.toISOString(),
    durationMs: 10,
    errorMessage: "BRIGHTDATA_API_KEY rejected by upstream",
  });

  const previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "status-secret";
  try {
    const anonymous = await handleOrchestrationStatusRequest(
      new Request("http://localhost/api/orchestration/status"),
      {
        repository,
        loadSentinel: async () => {
          throw new Error("unavailable");
        },
      },
    );
    const text = await anonymous.text();
    assert.equal(anonymous.status, 200);
    assert.ok(!text.includes("BRIGHTDATA_API_KEY"), "diagnostics are withheld");
    assert.ok(
      !text.includes(getCollectionSource("openai-pricing").collectorId),
      "collector ids are never published",
    );
    assert.ok(text.includes("collectorConfigured"), "only the configured flag is exposed");

    const operator = await handleOrchestrationStatusRequest(
      new Request("http://localhost/api/orchestration/status", {
        headers: { authorization: "Bearer status-secret" },
      }),
      {
        repository,
        loadSentinel: async () => {
          throw new Error("unavailable");
        },
      },
    );
    const operatorBody = await operator.text();
    assert.ok(
      operatorBody.includes("BRIGHTDATA_API_KEY rejected"),
      "an authorized operator sees the failure detail",
    );
    assert.ok(
      !operatorBody.includes(getCollectionSource("openai-pricing").collectorId),
      "collector ids stay unpublished even for operators",
    );
  } finally {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  }
});
