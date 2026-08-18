/**
 * The orchestration layer schedules collections. It must not become a new way
 * to change what a source is *allowed to assert*: pricing stays non-authoritative
 * for model inventory and lifecycle stays the only authority for retirement.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryOrchestrationRepository,
  listCollectionSources,
  runCollectionFleet,
  runCollectionSource,
} from "../../lib/orchestration";
import { InMemorySentinelRepository } from "../../lib/sentinel";
import {
  ANTHROPIC_LIFECYCLE_URL,
  anthropicLifecycleRecords,
  harnessSource,
  healthyRecordsFor,
  pricingRecords,
} from "./support/fixtures";
import { collectorPayload } from "./support/pipeline-doubles";

test("every configured source carries the authority contract of its domain", () => {
  for (const source of listCollectionSources()) {
    const contract = source.createHealthContract(`source-${source.key}`);
    if (source.sourceType === "pricing") {
      assert.equal(contract.authorityDomain, "pricing", `${source.key} is a pricing authority only`);
      assert.equal(
        contract.isAuthoritative,
        false,
        `${source.key} must never be authoritative for model inventory`,
      );
    } else if (source.sourceType === "lifecycle") {
      assert.equal(contract.authorityDomain, "lifecycle");
      assert.equal(contract.isAuthoritative, true, `${source.key} is the lifecycle authority`);
      assert.equal(
        contract.failurePolicy.quarantineThresholdPercentage,
        0,
        `${source.key} tolerates no malformed authoritative record`,
      );
    } else {
      assert.equal(contract.authorityDomain, "catalog");
      assert.equal(contract.isAuthoritative, true, `${source.key} is the catalog authority`);
    }
  }
});


test("an orchestrated pricing run never deactivates or retires a model that stopped being listed", async () => {
  const repository = new InMemoryOrchestrationRepository();
  const sentinelRepository = new InMemorySentinelRepository();
  let records = pricingRecords("anthropic");
  const harness = harnessSource("anthropic-pricing", async (attempt) =>
    collectorPayload(records, { collectorId: "c_test", runId: `pricing-${attempt}` }),
  );

  await runCollectionSource(harness.source, {
    invocationId: "inv-1",
    trigger: "cron",
    repository,
    sentinelRepository,
    autoHealOverride: false,
    sleep: async () => {},
  });
  assert.equal(harness.pricing.models.length, 2);

  // An authoritative lifecycle source has since published state for both models.
  for (const model of harness.pricing.models) {
    model.lifecycle_state = "deprecated";
    model.deprecated_on = "2026-08-17";
    model.retirement_not_before_date = "2027-08-05";
  }

  // The pricing page stops listing one of them.
  records = [pricingRecords("anthropic")[0]];
  const second = await runCollectionSource(harness.source, {
    invocationId: "inv-2",
    trigger: "cron",
    repository,
    sentinelRepository,
    force: true,
    autoHealOverride: false,
    sleep: async () => {},
  });

  assert.equal(second.status, "succeeded");
  for (const model of harness.pricing.models) {
    assert.equal(model.is_active, true, `${model.model_name} stays active`);
    assert.equal(model.lifecycle_state, "deprecated", "pricing cannot rewrite lifecycle state");
    assert.equal(model.retirement_date, null, "pricing cannot invent a retirement date");
    assert.equal(model.retirement_not_before_date, "2027-08-05");
  }
  assert.equal(
    harness.pricing.lifecycleProjections.length,
    0,
    "a pricing run applies no lifecycle projection at all",
  );
});

test("an orchestrated lifecycle run retires only from an explicit authoritative row", async () => {
  const repository = new InMemoryOrchestrationRepository();
  const sentinelRepository = new InMemorySentinelRepository();
  let records = anthropicLifecycleRecords();
  const harness = harnessSource("anthropic-lifecycle", async (attempt) =>
    collectorPayload(records, { collectorId: "c_test", runId: `lifecycle-${attempt}` }),
  );

  await runCollectionSource(harness.source, {
    invocationId: "inv-1",
    trigger: "cron",
    repository,
    sentinelRepository,
    autoHealOverride: false,
    sleep: async () => {},
  });

  const deprecated = harness.lifecycle.models.find((model) =>
    model.model_name.toLowerCase().includes("opus"),
  );
  assert.ok(deprecated, "the deprecated model was tracked");
  assert.equal(deprecated?.lifecycle_state, "deprecated");
  assert.equal(deprecated?.is_active, true, "deprecated is not retired");
  assert.equal(deprecated?.retirement_date, null, "a lower bound is never an exact date");
  assert.equal(deprecated?.retirement_not_before_date, "2027-08-05", "the lower bound is kept");

  // The page now states retirement explicitly.
  records = [
    anthropicLifecycleRecords()[0],
    {
      product_page_url: ANTHROPIC_LIFECYCLE_URL,
      input: { url: ANTHROPIC_LIFECYCLE_URL },
      api_model_name: "claude-opus-4-1-20250805",
      current_state: "Retired",
      deprecated_date: "June 5, 2026",
      tentative_retirement_date: "August 5, 2026",
    },
  ];
  await runCollectionSource(harness.source, {
    invocationId: "inv-2",
    trigger: "cron",
    repository,
    sentinelRepository,
    force: true,
    autoHealOverride: false,
    sleep: async () => {},
  });

  assert.equal(deprecated?.lifecycle_state, "retired");
  assert.equal(deprecated?.is_active, false, "an explicit Retired row does retire the model");
  assert.equal(deprecated?.retirement_date, "2026-08-05");
});

test("a fleet run keeps each source inside its own provider and domain", async () => {
  const repository = new InMemoryOrchestrationRepository();
  const sentinelRepository = new InMemorySentinelRepository();
  const harnesses = listCollectionSources().map((definition) =>
    harnessSource(definition.key, async () =>
      collectorPayload(healthyRecordsFor(definition.key), {
        collectorId: "c_test",
        runId: `${definition.key}-run`,
      }),
    ),
  );

  const fleet = await runCollectionFleet({
    sources: harnesses.map((harness) => harness.source),
    repository,
    sentinelRepository,
    trigger: "cron",
    autoHealOverride: false,
    sleep: async () => {},
  });

  assert.equal(fleet.summary.succeeded, harnesses.length);
  for (const harness of harnesses) {
    if (harness.source.sourceType === "pricing") {
      assert.ok(harness.pricing.pricingSnapshots.length > 0, "pricing wrote pricing snapshots");
      assert.equal(
        harness.pricing.lifecycleSnapshots.length,
        0,
        "a pricing run never writes lifecycle evidence",
      );
      assert.equal(harness.pricing.lifecycleProjections.length, 0);
    } else if (harness.source.sourceType === "lifecycle") {
      assert.ok(harness.lifecycle.lifecycleSnapshots.length > 0, "lifecycle wrote its evidence");
      assert.equal(
        harness.lifecycle.pricingSnapshots.length,
        0,
        "a lifecycle run never writes pricing",
      );
    } else {
      assert.ok(harness.catalog.capabilitySnapshots.length > 0, "catalog wrote its capabilities");
      assert.equal(
        harness.catalog.pricingSnapshots.length,
        0,
        "a catalog run never writes pricing",
      );
      assert.equal(
        harness.catalog.lifecycleSnapshots.length,
        0,
        "a catalog run never writes lifecycle evidence",
      );
    }
  }


  // Each orchestration run is attributed to exactly one provider and domain.
  for (const run of repository.runs) {
    const definition = listCollectionSources().find((source) => source.key === run.source_key);
    assert.equal(run.provider_slug, definition?.providerSlug);
    assert.equal(run.source_type, definition?.sourceType);
  }
});
