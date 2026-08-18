import test from "node:test";
import assert from "node:assert/strict";
import { runSentinelDemoSimulation } from "../../lib/sentinel";

test("Sentinel Demo: completes 5-step autonomous healing simulation", async () => {
  const result = await runSentinelDemoSimulation({ providerSlug: "openai" });

  assert.equal(result.success, true);
  assert.equal(result.finalStatus, "recovered");
  assert.equal(result.timeline.length, 5);

  // Step 1: Healthy baseline
  assert.equal(result.timeline[0]?.step, 1);
  assert.equal(result.timeline[0]?.sourceStatus, "healthy");
  assert.equal(result.timeline[0]?.recordsAccepted, 4);

  // Step 2: Quarantined
  assert.equal(result.timeline[1]?.step, 2);
  assert.equal(result.timeline[1]?.isQuarantined, true);
  assert.equal(result.timeline[1]?.lastKnownGoodPreserved, true);

  // Step 3: Healing
  assert.equal(result.timeline[2]?.step, 3);
  assert.equal(result.timeline[2]?.sourceStatus, "healing");

  // Step 4: Validated
  assert.equal(result.timeline[3]?.step, 4);
  assert.equal(result.timeline[3]?.healingState, "candidate_validated");

  // Step 5: Recovered
  assert.equal(result.timeline[4]?.step, 5);
  assert.equal(result.timeline[4]?.sourceStatus, "recovered");
  assert.equal(result.timeline[4]?.recordsAccepted, 4);
});
