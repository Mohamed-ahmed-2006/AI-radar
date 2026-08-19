/**
 * Production cannot silently substitute a fixture.
 *
 * Every simulator, fixture adapter and fabricated corpus in the codebase is
 * checked here against one rule: reaching it must require an explicit
 * server-side opt-in, and the absence of configuration must produce emptiness
 * or an "unavailable" state — never invented data wearing live clothes.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { CANONICAL_ASK_ADAPTER_ID } from "../../lib/product/ask-read-model";
import { FIXTURE_ASK_ADAPTER_ID } from "../../lib/product/ask-fixture";
import { CANONICAL_OPTIMIZER_ADAPTER_ID } from "../../lib/product/optimizer-read-model";
import { FIXTURE_OPTIMIZER_ADAPTER_ID } from "../../lib/product/optimizer-fixture";
import { CANONICAL_HEALING_DEMO_ADAPTER_ID } from "../../lib/product/healing-demo-read-model";
import { getAskAdapter, getOptimizerAdapter, getHealingDemoAdapter } from "../../lib/product";
import {
  isDemoEvidenceEnabled,
  resolveDemoEvidence,
} from "../../lib/intelligence/demo-gate";
import { queryTemporalIntelligence } from "../../lib/intelligence/read-model";
import { isSentinelDemoMode } from "../../lib/sentinel/ui-data";

function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("the installed Ask adapter is canonical, never the fixture", () => {
  const adapter = getAskAdapter();
  assert.equal(adapter.id, CANONICAL_ASK_ADAPTER_ID);
  assert.notEqual(adapter.id, FIXTURE_ASK_ADAPTER_ID);
});

test("the installed Optimizer adapter is canonical, never the fixture", () => {
  const adapter = getOptimizerAdapter();
  assert.equal(adapter.id, CANONICAL_OPTIMIZER_ADAPTER_ID);
  assert.notEqual(adapter.id, FIXTURE_OPTIMIZER_ADAPTER_ID);
});

test("the installed healing-demo adapter is canonical and declares itself not a fixture", () => {
  const adapter = getHealingDemoAdapter();
  assert.equal(adapter.id, CANONICAL_HEALING_DEMO_ADAPTER_ID);
  assert.equal(adapter.isFixture, false);
});

test("an unconfigured healing demo reports unavailable rather than simulating", async () => {
  const model = await getHealingDemoAdapter().getState();
  if (!model.available) {
    assert.equal(model.kind, "unavailable");
    assert.equal(model.isFixture, false);
    assert.equal(model.isDemo, false);
    // Nothing to press: an unavailable demo offers no action at all.
    assert.deepEqual(model.allowedActions, []);
  } else {
    // Configured in this environment: it must still be the real backend.
    assert.equal(model.kind, "real_bright_data_demo");
    assert.equal(model.isFixture, false);
  }
});

test("demo temporal evidence requires the server-side opt-in", () => {
  withEnv({ AI_RADAR_DEMO_EVIDENCE: undefined }, () => {
    assert.equal(isDemoEvidenceEnabled(), false);
    // Asking is not enough.
    assert.equal(resolveDemoEvidence(true), false);
    assert.equal(resolveDemoEvidence(undefined), false);
  });
  withEnv({ AI_RADAR_DEMO_EVIDENCE: "1" }, () => {
    assert.equal(resolveDemoEvidence(true), true);
    // Opting in never turns a live query into a demo one.
    assert.equal(resolveDemoEvidence(false), false);
    assert.equal(resolveDemoEvidence(undefined), false);
  });
  withEnv({ AI_RADAR_DEMO_EVIDENCE: "true" }, () => {
    // Only the exact literal enables it.
    assert.equal(isDemoEvidenceEnabled(), false);
  });
});

test("without the opt-in, demo=true still yields no fabricated evidence", async () => {
  const bundle = await withEnv({ AI_RADAR_DEMO_EVIDENCE: undefined }, () =>
    queryTemporalIntelligence({ demo: true, range: "30d" }),
  );
  assert.equal(bundle.isDemoData, false);
  assert.equal(
    bundle.events.some((event) => event.isDemo),
    false,
  );
});

test("Sentinel demo mode is off unless explicitly set to 1", () => {
  withEnv({ SENTINEL_DEMO_MODE: undefined }, () => {
    assert.equal(isSentinelDemoMode(), false);
  });
  withEnv({ SENTINEL_DEMO_MODE: "0" }, () => {
    assert.equal(isSentinelDemoMode(), false);
  });
  withEnv({ SENTINEL_DEMO_MODE: "true" }, () => {
    assert.equal(isSentinelDemoMode(), false);
  });
  withEnv({ SENTINEL_DEMO_MODE: "1" }, () => {
    assert.equal(isSentinelDemoMode(), true);
  });
});
