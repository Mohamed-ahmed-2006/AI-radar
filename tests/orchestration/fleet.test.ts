import assert from "node:assert/strict";
import test from "node:test";

import {
  COLLECTION_SOURCE_KEYS,
  InMemoryOrchestrationRepository,
  deriveInvocationId,
  runCollectionFleet,
  type CollectionSourceKey,
} from "../../lib/orchestration";
import { InMemorySentinelRepository } from "../../lib/sentinel";
import {
  harnessSource,
  healthyRecordsFor,
  malformedRecordsFor,
  type HarnessedSource,
} from "./support/fixtures";
import { canonicalWriteCount, collectorPayload } from "./support/pipeline-doubles";

type Behaviour = "healthy" | "collector_down" | "malformed" | "hangs";

function buildFleet(behaviours: Partial<Record<CollectionSourceKey, Behaviour>> = {}): {
  harnesses: Map<CollectionSourceKey, HarnessedSource>;
  sources: HarnessedSource["source"][];
} {
  const harnesses = new Map<CollectionSourceKey, HarnessedSource>();
  for (const key of COLLECTION_SOURCE_KEYS) {
    const behaviour = behaviours[key] ?? "healthy";
    const harness = harnessSource(key, async () => {
      if (behaviour === "collector_down") throw new Error(`${key} collector is unreachable`);
      if (behaviour === "hangs") {
        return new Promise(() => {
          /* never settles */
        });
      }
      const records = behaviour === "malformed" ? malformedRecordsFor(key) : healthyRecordsFor(key);
      return collectorPayload(records, { collectorId: "c_test", runId: `${key}-run` });
    });
    harnesses.set(key, harness);
  }
  return {
    harnesses,
    sources: COLLECTION_SOURCE_KEYS.map((key) => {
      const source = harnesses.get(key)!.source;
      return {
        ...source,
        timeoutMs: 25,
        retry: { ...source.retry, maxAttempts: 1, backoffMs: 1 },
      };
    }),
  };
}

function fleetOptions() {
  return {
    repository: new InMemoryOrchestrationRepository(),
    sentinelRepository: new InMemorySentinelRepository(),
    autoHealOverride: false,
    sleep: async () => {},
  };
}

test("a full fleet run executes all ten configured sources", async () => {
  const { harnesses, sources } = buildFleet();
  const options = fleetOptions();

  const fleet = await runCollectionFleet({ ...options, sources, trigger: "cron" });

  assert.equal(fleet.status, "completed");
  assert.equal(fleet.summary.total, 10);
  assert.equal(fleet.summary.succeeded, 10);
  assert.equal(fleet.summary.failed, 0);
  assert.equal(fleet.summary.quarantined, 0);
  assert.equal(fleet.summary.skipped, 0);
  assert.deepEqual(
    fleet.sources.map((source) => source.sourceKey),
    [...COLLECTION_SOURCE_KEYS],
  );
  for (const key of COLLECTION_SOURCE_KEYS) {
    assert.equal(harnesses.get(key)?.collectCalls, 1, `${key} was collected exactly once`);
  }
  assert.equal(options.repository.runs.length, 10);
  assert.ok(options.repository.runs.every((run) => run.status === "succeeded"));
  assert.ok(fleet.durationMs >= 0);
});

test("one provider failing does not block or hide the others", async () => {
  const { harnesses, sources } = buildFleet({ "anthropic-pricing": "collector_down" });
  const options = fleetOptions();

  const fleet = await runCollectionFleet({ ...options, sources, trigger: "cron" });

  assert.equal(fleet.status, "partial");
  assert.equal(fleet.summary.succeeded, 9);
  assert.equal(fleet.summary.failed, 1);

  const failed = fleet.sources.find((source) => source.sourceKey === "anthropic-pricing");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.outcome, "collector_failed");
  assert.match(failed?.error?.message ?? "", /unreachable/);
  assert.equal(
    canonicalWriteCount(harnesses.get("anthropic-pricing")!.pricing),
    0,
    "the failing source wrote nothing",
  );

  for (const key of COLLECTION_SOURCE_KEYS) {
    if (key === "anthropic-pricing") continue;
    const result = fleet.sources.find((source) => source.sourceKey === key);
    assert.equal(result?.status, "succeeded", `${key} still succeeded`);
    assert.equal(result?.recordsAccepted, 2, `${key} still persisted its records`);
  }
});

test("a quarantined source, a dead collector and a hanging collector all stay isolated", async () => {
  const { harnesses, sources } = buildFleet({
    "openai-pricing": "malformed",
    "xai-pricing": "collector_down",
    "gemini-lifecycle": "hangs",
  });
  const options = fleetOptions();

  const fleet = await runCollectionFleet({ ...options, sources, trigger: "cron" });

  assert.equal(fleet.status, "partial");
  assert.equal(fleet.summary.succeeded, 7);
  assert.equal(fleet.summary.quarantined, 1);
  assert.equal(fleet.summary.failed, 2);

  const byKey = new Map(fleet.sources.map((source) => [source.sourceKey, source]));
  assert.equal(byKey.get("openai-pricing")?.outcome, "quarantined");
  assert.equal(byKey.get("xai-pricing")?.outcome, "collector_failed");
  assert.equal(byKey.get("gemini-lifecycle")?.outcome, "timed_out");
  assert.equal(byKey.get("anthropic-pricing")?.status, "succeeded");
  assert.equal(byKey.get("gemini-pricing")?.status, "succeeded");
  assert.equal(byKey.get("anthropic-lifecycle")?.status, "succeeded");

  assert.equal(canonicalWriteCount(harnesses.get("openai-pricing")!.pricing), 0);
  assert.ok(canonicalWriteCount(harnesses.get("anthropic-lifecycle")!.lifecycle) > 0);
});

test("the fleet can be restricted to named sources", async () => {
  const { harnesses, sources } = buildFleet();
  const options = fleetOptions();

  const fleet = await runCollectionFleet({
    ...options,
    sources,
    sourceKeys: ["gemini-pricing", "anthropic-lifecycle"],
    trigger: "manual",
  });

  assert.equal(fleet.summary.total, 2);
  assert.equal(fleet.summary.succeeded, 2);
  assert.equal(harnesses.get("openai-pricing")?.collectCalls, 0);
});

test("a second fleet run in the same tick window collects nothing twice", async () => {
  const { harnesses, sources } = buildFleet();
  const options = fleetOptions();
  const now = () => new Date("2026-08-18T12:30:00.000Z");

  const first = await runCollectionFleet({ ...options, sources, trigger: "cron", now });
  const replay = await runCollectionFleet({ ...options, sources, trigger: "cron", now });

  assert.equal(first.status, "completed");
  assert.equal(replay.status, "noop", "every source was skipped");
  assert.equal(replay.summary.skipped, 10);
  assert.equal(first.invocationId, replay.invocationId, "the tick window is the invocation id");
  for (const key of COLLECTION_SOURCE_KEYS) {
    assert.equal(harnesses.get(key)?.collectCalls, 1, `${key} was collected once`);
  }
  assert.equal(options.repository.runs.length, 10);
});

test("cron invocation ids collapse per tick window; manual runs stay distinct", () => {
  const early = new Date("2026-08-18T12:05:00.000Z");
  const late = new Date("2026-08-18T12:55:00.000Z");
  const nextHour = new Date("2026-08-18T13:05:00.000Z");

  assert.equal(deriveInvocationId("cron", early, 60), deriveInvocationId("cron", late, 60));
  assert.notEqual(deriveInvocationId("cron", early, 60), deriveInvocationId("cron", nextHour, 60));
  assert.notEqual(deriveInvocationId("manual", early, 60), deriveInvocationId("manual", early, 60));
});

test("an unexpected error inside one source cannot abort the fleet", async () => {
  const { sources } = buildFleet();
  const exploding = {
    ...sources[0],
    collect: () => {
      throw new Error("synchronous explosion");
    },
  };
  const options = fleetOptions();

  const fleet = await runCollectionFleet({
    ...options,
    sources: [exploding, ...sources.slice(1)],
    trigger: "cron",
  });

  assert.equal(fleet.summary.total, 10);
  assert.equal(fleet.summary.succeeded, 9);
  assert.equal(fleet.sources[0]?.status, "failed");
});
