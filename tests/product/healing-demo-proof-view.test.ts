import test from "node:test";
import assert from "node:assert/strict";

import { unavailableHealingDemoRecoveryProof } from "../../lib/product/healing-demo";
import {
  recoveryProofChips,
  recoveryStageCompactFact,
} from "../../lib/product/healing-demo-proof-view";
import { fixtureHistoricalRecoveryProof } from "../../lib/product/healing-demo-fixture";

test("recovery chips only render facts present on the proof", () => {
  const chips = recoveryProofChips(fixtureHistoricalRecoveryProof());
  assert.deepEqual(
    chips.map((chip) => chip.id),
    ["lkg", "zero-writes", "same-collector", "recovered-count", "live-evidence"],
  );
  assert.equal(chips.find((chip) => chip.id === "lkg")?.value, "10");
  assert.equal(chips.find((chip) => chip.id === "zero-writes")?.value, "0");
});

test("unavailable proof yields no chips and no invented compact facts", () => {
  const proof = unavailableHealingDemoRecoveryProof("No resolved incident.");
  assert.deepEqual(recoveryProofChips(proof), []);
  assert.equal(proof.stages.length, 0);
});

test("compact stage facts read evidence labels rather than inventing counts", () => {
  const proof = fixtureHistoricalRecoveryProof();
  const byId = Object.fromEntries(proof.stages.map((stage) => [stage.id, stage]));

  assert.equal(recoveryStageCompactFact(byId.trusted_baseline, proof), "10 / 10 accepted");
  assert.equal(recoveryStageCompactFact(byId.invalid_extraction, proof), "0 records");
  assert.equal(recoveryStageCompactFact(byId.sentinel_detected, proof), "ZERO_RECORDS");
  assert.equal(recoveryStageCompactFact(byId.quarantined, proof), "Write blocked");
  assert.equal(
    recoveryStageCompactFact(byId.last_known_good_preserved, proof),
    "10 trusted records still served",
  );
  assert.equal(
    recoveryStageCompactFact(byId.bright_data_repair, proof),
    "Same collector refactored",
  );
  assert.equal(recoveryStageCompactFact(byId.candidate_validated, proof), "Passed contract");
  assert.equal(recoveryStageCompactFact(byId.recovered, proof), "10 / 10 accepted");

  const stripped = {
    ...byId.trusted_baseline,
    evidence: [{ label: "Baseline run", value: "run-lkg-healthy" }],
  };
  assert.equal(recoveryStageCompactFact(stripped, proof), null);
});
