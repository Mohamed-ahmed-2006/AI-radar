import test from "node:test";
import assert from "node:assert/strict";

import { registerHealingDemoBackend } from "../../lib/healing-demo/backend";
import {
  HEALING_DEMO_ACTIONS,
  HEALING_DEMO_UNAVAILABLE_TITLE,
  isHealingDemoAction,
  projectHealingDemoSnapshot,
  sanitizeHealingDemoActions,
  setHealingDemoAdapter,
} from "../../lib/product/healing-demo";
import {
  createFixtureHealingDemoAdapter,
  fixtureHealingDemoReadModel,
  fixtureHealingDemoSnapshot,
  FIXTURE_HEALING_DEMO_ADAPTER_ID,
  FIXTURE_HEALING_DEMO_COLLECTOR_ID,
  FIXTURE_HEALING_DEMO_SOURCE_ID,
} from "../../lib/product/healing-demo-fixture";
import {
  CANONICAL_HEALING_DEMO_ADAPTER_ID,
  createCanonicalHealingDemoAdapter,
  installCanonicalHealingDemoAdapter,
} from "../../lib/product/healing-demo-read-model";

installCanonicalHealingDemoAdapter();

test.afterEach(() => {
  setHealingDemoAdapter(null);
  registerHealingDemoBackend(null);
});

test("canonical adapter is the production default and never the fixture", async () => {
  const { getHealingDemoAdapter: fromBarrel } = await import("../../lib/product");
  const adapter = fromBarrel();
  assert.equal(adapter.id, CANONICAL_HEALING_DEMO_ADAPTER_ID);
  assert.equal(adapter.isFixture, false);
  assert.notEqual(adapter.id, FIXTURE_HEALING_DEMO_ADAPTER_ID);

  const state = await adapter.getState();
  assert.equal(state.available, false);
  assert.equal(state.unavailableTitle, HEALING_DEMO_UNAVAILABLE_TITLE);
  assert.equal(state.isFixture, false);
  assert.equal(state.isDemo, false);
  assert.equal(state.kind, "unavailable");
  assert.equal(state.phase, null);
  assert.equal(state.recovery, null);
  assert.deepEqual(state.allowedActions, []);
  assert.deepEqual(state.timeline, []);
});

test("missing backend never substitutes the in-memory Sentinel simulation or fixture", async () => {
  const adapter = createCanonicalHealingDemoAdapter({ port: null });
  const state = await adapter.getState();
  assert.equal(state.unavailableTitle, HEALING_DEMO_UNAVAILABLE_TITLE);
  assert.equal(state.kind, "unavailable");
  assert.match(state.unavailableReason ?? "", /will not substitute the in-memory Sentinel demo/i);
  assert.equal(state.isDemo, false);
  assert.doesNotMatch(JSON.stringify(state), /SENTINEL_DEMO_MODE/);
});

test("throwing backend stays unavailable instead of fabricating recovery", async () => {
  const adapter = createCanonicalHealingDemoAdapter({
    port: {
      async getSnapshot() {
        throw new Error("collector unreachable");
      },
      async dispatch() {
        throw new Error("collector unreachable");
      },
    },
  });
  const state = await adapter.getState();
  assert.equal(state.available, false);
  assert.equal(state.unavailableTitle, HEALING_DEMO_UNAVAILABLE_TITLE);
  assert.match(state.unavailableReason ?? "", /collector unreachable/);
  assert.equal(state.phase, null);
});

test("allowlist rejects unknown action vocabulary", () => {
  assert.equal(isHealingDemoAction("reset"), true);
  assert.equal(isHealingDemoAction("approve_preview"), true);
  assert.equal(isHealingDemoAction("heal"), false);
  assert.equal(isHealingDemoAction("collectorId"), false);
  assert.equal(isHealingDemoAction("https://example.com"), false);
  assert.deepEqual(sanitizeHealingDemoActions(["reset", "explode", "approve_preview", "reset"]), [
    "reset",
    "approve_preview",
  ]);
  assert.equal(HEALING_DEMO_ACTIONS.length, 7);
});

test("fixture snapshots cover the judging sequence without UI invention", () => {
  const healthy = fixtureHealingDemoReadModel("healthy");
  assert.equal(healthy.phase, "healthy");
  assert.equal(healthy.kind, "fixture");
  assert.equal(healthy.identity?.sourceId, FIXTURE_HEALING_DEMO_SOURCE_ID);
  assert.equal(healthy.brightData?.collectorId, FIXTURE_HEALING_DEMO_COLLECTOR_ID);
  assert.equal(healthy.comparisonMode, "healthy");
  assert.ok(healthy.timeline.some((stage) => stage.stepId === "healthy_baseline" && stage.status === "done"));

  const broken = fixtureHealingDemoReadModel("break");
  assert.equal(broken.phase, "break");
  assert.equal(broken.sentinelStatus, "degraded");

  const detected = fixtureHealingDemoReadModel("detected");
  assert.equal(detected.phase, "detected");
  assert.ok(detected.incident);

  const quarantined = fixtureHealingDemoReadModel("quarantined");
  assert.equal(quarantined.phase, "quarantined");
  assert.equal(quarantined.quarantine?.active, true);
  assert.equal(quarantined.comparisonMode, "quarantine");
  assert.equal(quarantined.lastKnownGood?.recordCount, 18);
  assert.equal(quarantined.candidate?.recordCount, 3);

  const healing = fixtureHealingDemoReadModel("healing");
  assert.equal(healing.phase, "healing");
  assert.equal(healing.brightData?.healRequested, true);
  assert.equal(healing.busy, true);

  const waiting = fixtureHealingDemoReadModel("preview_waiting");
  assert.equal(waiting.preview?.state, "waiting");
  assert.equal(waiting.pollAfterMs, 2000);

  const failed = fixtureHealingDemoReadModel("preview_failed");
  assert.equal(failed.validation?.passed, false);
  assert.equal(failed.approval?.available, false);
  assert.ok(!failed.allowedActions.includes("approve_preview"));

  const validated = fixtureHealingDemoReadModel("preview_validated");
  assert.equal(validated.validation?.passed, true);
  assert.equal(validated.approval?.available, true);
  assert.ok(validated.allowedActions.includes("approve_preview"));

  const recovered = fixtureHealingDemoReadModel("recovered");
  assert.equal(recovered.phase, "recovered");
  assert.equal(recovered.recovery?.recovered, true);
  assert.equal(recovered.comparisonMode, "recovered");
});

test("approval is available only when the preview passed validation", () => {
  const sneak = fixtureHealingDemoSnapshot("preview_failed");
  sneak.allowedActions = ["reset", "approve_preview"];
  sneak.approval = { available: true, approved: false, at: null, summary: "should be stripped" };
  const projected = projectHealingDemoSnapshot(sneak, {
    adapterId: "test",
    kind: "real_bright_data_demo",
    isFixture: false,
  });
  assert.equal(projected.approval?.available, false);
  assert.ok(!projected.allowedActions.includes("approve_preview"));
});

test("fixture start_healing does not fabricate a recovered preview", async () => {
  const adapter = createFixtureHealingDemoAdapter("quarantined");
  const afterHeal = await adapter.runAction("start_healing");
  assert.equal(afterHeal.phase, "healing");
  assert.notEqual(afterHeal.phase, "recovered");
  assert.notEqual(afterHeal.phase, "preview_validated");
  assert.equal(afterHeal.recovery?.recovered, false);
});

test("fixture refuses approve_preview until the preview is valid", async () => {
  const failed = createFixtureHealingDemoAdapter("preview_failed");
  const stillFailed = await failed.runAction("approve_preview");
  assert.equal(stillFailed.phase, "preview_failed");

  const validated = createFixtureHealingDemoAdapter("preview_validated");
  const approved = await validated.runAction("approve_preview");
  assert.equal(approved.phase, "approved");

  const rerun = await validated.runAction("rerun_recover");
  assert.equal(rerun.phase, "recovered");
});

test("canonical adapter projects a registered backend without redesign", async () => {
  const adapter = createCanonicalHealingDemoAdapter({
    port: {
      async getSnapshot() {
        return fixtureHealingDemoSnapshot("quarantined");
      },
      async dispatch() {
        return fixtureHealingDemoSnapshot("healing");
      },
    },
  });
  const state = await adapter.getState();
  assert.equal(state.available, true);
  assert.equal(state.kind, "real_bright_data_demo");
  assert.equal(state.isFixture, false);
  assert.equal(state.isDemo, false);
  assert.equal(state.phase, "quarantined");
  assert.equal(state.kindLabel, "Real Bright Data demo");

  const healed = await adapter.runAction("start_healing");
  assert.equal(healed.phase, "healing");
  assert.equal(healed.kind, "real_bright_data_demo");
});

test("product barrel still exports getHealingDemoAdapter after install", async () => {
  const product = await import("../../lib/product");
  assert.equal(typeof product.getHealingDemoAdapter, "function");
  assert.equal(product.getHealingDemoAdapter().isFixture, false);
});
