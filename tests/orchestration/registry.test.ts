import assert from "node:assert/strict";
import test from "node:test";

import {
  COLLECTION_SOURCE_KEYS,
  ORCHESTRATION_DEFAULTS,
  cadenceToCronHint,
  getCollectionSource,
  isCollectionSourceKey,
  listCollectionSources,
} from "../../lib/orchestration";

function withEnv(values: Record<string, string | undefined>, run: () => void): void {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("all ten intelligence sources are configured with a complete contract", () => {
  const sources = listCollectionSources();
  assert.deepEqual(
    sources.map((source) => source.key),
    [
      "openai-pricing",
      "anthropic-pricing",
      "gemini-pricing",
      "xai-pricing",
      "anthropic-lifecycle",
      "gemini-lifecycle",
      "openai-catalog",
      "anthropic-catalog",
      "gemini-catalog",
      "xai-catalog",
    ],
  );
  assert.deepEqual([...COLLECTION_SOURCE_KEYS], sources.map((source) => source.key));

  for (const source of sources) {
    assert.ok(source.provider.length > 0, `${source.key} names a provider`);
    assert.ok(["pricing", "lifecycle", "catalog"].includes(source.sourceType));

    assert.ok(source.collectorId.startsWith("c_"), `${source.key} has a collector id`);
    assert.ok(source.sourceUrl.startsWith("https://"), `${source.key} has a source url`);
    assert.equal(source.enabled, true, `${source.key} is enabled by default`);
    assert.ok(source.schedule.cadenceMinutes > 0, `${source.key} has a cadence`);
    assert.ok(source.schedule.cronHint.length > 0, `${source.key} has a cron hint`);
    assert.ok(source.timeoutMs > 0, `${source.key} has a timeout`);
    assert.ok(
      source.retry.maxAttempts >= 1 && source.retry.maxAttempts <= 5,
      `${source.key} has bounded retries`,
    );
    assert.equal(source.failureIsolation.continueFleetOnFailure, true);
    assert.equal(source.failureIsolation.quarantineBlocksPersistence, true);
    assert.equal(typeof source.collect, "function");
    assert.equal(typeof source.persist, "function");

    const contract = source.createHealthContract(`source-${source.key}`);
    assert.equal(contract.sourceId, `source-${source.key}`);
    assert.equal(
      contract.sourceCategory,
      source.sourceType === "pricing"
        ? "pricing"
        : source.sourceType === "lifecycle"
          ? "lifecycle"
          : "models",
    );

  }

  const collectorIds = sources.map((source) => source.collectorId);
  assert.equal(new Set(collectorIds).size, collectorIds.length, "collector ids are distinct");
});

test("pricing and lifecycle sources persist against their own source kinds", () => {
  const byKey = new Map(listCollectionSources().map((source) => [source.key, source]));
  assert.equal(byKey.get("openai-pricing")?.sourceKind, "pricing");
  assert.equal(byKey.get("xai-pricing")?.sourceKind, "pricing");
  // Lifecycle rows are model intelligence, so they live under the `models`
  // source kind the lifecycle pipeline already writes to.
  assert.equal(byKey.get("anthropic-lifecycle")?.sourceKind, "models");
  assert.equal(byKey.get("gemini-lifecycle")?.sourceKind, "models");
});

test("cadence, timeout, retries and enablement are configuration, not constants", () => {
  withEnv(
    {
      AI_RADAR_SOURCE_OPENAI_PRICING_CADENCE_MINUTES: "60",
      AI_RADAR_SOURCE_OPENAI_PRICING_TIMEOUT_MS: "5000",
      AI_RADAR_SOURCE_OPENAI_PRICING_MAX_ATTEMPTS: "2",
      AI_RADAR_SOURCE_XAI_PRICING_ENABLED: "false",
      AI_RADAR_COLLECTION_CADENCE_MINUTES: "180",
    },
    () => {
      const openai = getCollectionSource("openai-pricing");
      assert.equal(openai.schedule.cadenceMinutes, 60, "per-source override wins");
      assert.equal(openai.timeoutMs, 5_000);
      assert.equal(openai.retry.maxAttempts, 2);

      const anthropic = getCollectionSource("anthropic-pricing");
      assert.equal(anthropic.schedule.cadenceMinutes, 180, "fleet override applies otherwise");

      assert.equal(getCollectionSource("xai-pricing").enabled, false);
    },
  );

  // Defaults are restored once the overrides are gone.
  assert.equal(
    getCollectionSource("openai-pricing").schedule.cadenceMinutes,
    ORCHESTRATION_DEFAULTS.pricingCadenceMinutes,
  );
  assert.equal(getCollectionSource("xai-pricing").enabled, true);
});

test("retry configuration can never express an unbounded loop", () => {
  withEnv({ AI_RADAR_COLLECTION_MAX_ATTEMPTS: "9999" }, () => {
    for (const source of listCollectionSources()) {
      assert.equal(source.retry.maxAttempts, 5, `${source.key} is capped`);
    }
  });
  withEnv({ AI_RADAR_COLLECTION_MAX_ATTEMPTS: "0" }, () => {
    for (const source of listCollectionSources()) {
      assert.ok(source.retry.maxAttempts >= 1, `${source.key} still attempts once`);
    }
  });
});

test("cadence renders as a cron hint for the status read model", () => {
  assert.equal(cadenceToCronHint(60), "0 * * * *");
  assert.equal(cadenceToCronHint(360), "0 */6 * * *");
  assert.equal(cadenceToCronHint(1440), "0 0 * * *");
  assert.equal(cadenceToCronHint(2880), "0 0 */2 * *");
  assert.equal(cadenceToCronHint(30), "*/30 * * * *");
});

test("unknown source keys are rejected", () => {
  assert.equal(isCollectionSourceKey("openai-pricing"), true);
  assert.equal(isCollectionSourceKey("mistral-pricing"), false);
  assert.throws(() => getCollectionSource("mistral-pricing" as never), /Unknown collection source/);
});
