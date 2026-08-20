/**
 * The historical recovery replay.
 *
 * Two things are being defended here. The first is that the replay is a *read*:
 * it reports a recovery that already happened, it survives a reset of the
 * current demonstration, and it never becomes the live state. The second is
 * that every claim in it is derived rather than asserted — the zero-bad-writes
 * flag, the preserved baseline and the same-collector confirmation each go
 * false when the row behind them is missing, and a stage with no evidence does
 * not appear at all.
 *
 * The end-to-end tests drive the real orchestrator with only Bright Data and
 * Supabase doubled, so a row the replay cites is a row a live run would
 * genuinely have written.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDemoRecoveryProof,
  selectRecoveryIncident,
  selectRecoveryRun,
  type DemoRecoveryEvidencePort,
} from "../../lib/demo-healing/recovery-proof";
import { getDemoHealingReadModel } from "../../lib/demo-healing/read-model";
import { createHealingDemoPort } from "../../lib/demo-healing/ui-port";
import type { DemoQuarantinePayloadReference } from "../../lib/demo-healing/repository";
import { projectHealingDemoSnapshot } from "../../lib/product/healing-demo";
import { HEALING_DEMO_RECOVERY_STAGE_IDS } from "../../lib/product/healing-demo";
import type {
  CollectionRunRow,
  SentinelHealingAttemptRow,
  SentinelIncidentRow,
} from "../../lib/supabase/types";
import {
  awaitingApproval,
  FakeDemoPipelineRepository,
  InMemoryDemoHarnessRepository,
  RunBackedSentinelRepository,
  ScriptedCollectorRunner,
  ScriptedHealer,
  testDemoConfiguration,
} from "./support/doubles";
import { goodPreview, healthyPayload, tableLayoutPayload } from "./support/payloads";

// ---------------------------------------------------------------------------
// Fixed rows, shaped like the ones the production recovery left behind
// ---------------------------------------------------------------------------

const SOURCE_ID = "src-demo-0001";
const PROVIDER_ID = "prov-demo-0001";
const COLLECTOR_ID = "c_test_demo_collector";

const BASELINE_RUN_ID = "run-baseline";
const INVALID_RUN_ID = "run-invalid";
const RECOVERY_RUN_ID = "run-recovery";
const LATER_RUN_ID = "run-later-rehearsal";
const INCIDENT_ID = "incident-1";

function run(overrides: Partial<CollectionRunRow> & { id: string }): CollectionRunRow {
  return {
    source_id: SOURCE_ID,
    status: "succeeded",
    external_run_id: null,
    triggered_by: "sentinel-demo-harness",
    started_at: "2026-08-20T09:55:06.965Z",
    completed_at: "2026-08-20T09:55:08.310Z",
    records_seen: 10,
    records_accepted: 10,
    records_rejected: 0,
    error_message: null,
    error_details: null,
    validation_errors: [],
    created_at: "2026-08-20T09:55:06.965Z",
    ...overrides,
  };
}

function baselineRun(): CollectionRunRow {
  return run({ id: BASELINE_RUN_ID });
}

function invalidRun(): CollectionRunRow {
  return run({
    id: INVALID_RUN_ID,
    status: "failed",
    started_at: "2026-08-20T09:55:19.567Z",
    completed_at: "2026-08-20T09:55:20.371Z",
    records_seen: 0,
    records_accepted: 0,
    error_message: "Collector output contains zero records",
  });
}

function recoveryRun(): CollectionRunRow {
  return run({
    id: RECOVERY_RUN_ID,
    started_at: "2026-08-20T09:56:58.027Z",
    completed_at: "2026-08-20T09:56:59.462Z",
  });
}

/** A later rehearsal baseline, which is not part of this recovery. */
function laterRun(): CollectionRunRow {
  return run({
    id: LATER_RUN_ID,
    started_at: "2026-08-20T10:01:03.270Z",
    completed_at: "2026-08-20T10:01:04.532Z",
  });
}

function incident(overrides: Partial<SentinelIncidentRow> = {}): SentinelIncidentRow {
  return {
    id: INCIDENT_ID,
    source_id: SOURCE_ID,
    provider_id: PROVIDER_ID,
    run_id: INVALID_RUN_ID,
    status: "resolved",
    severity: "critical",
    reason_codes: ["ZERO_RECORDS"],
    summary: "Collector output contains zero records",
    records_seen: 0,
    records_valid: 0,
    records_invalid: 0,
    expected_count: 10,
    last_known_good_count: 10,
    last_known_good_run_id: BASELINE_RUN_ID,
    last_known_good_at: "2026-08-20T09:55:08.310Z",
    healing_attempt_count: 1,
    resolution_note: "Repaired collector template approved after passing Sentinel validation.",
    created_at: "2026-08-20T09:55:22.704Z",
    updated_at: "2026-08-20T09:56:44.940Z",
    resolved_at: "2026-08-20T09:56:42.238Z",
    ...overrides,
  };
}

function attempt(
  overrides: Partial<SentinelHealingAttemptRow> & { id: string },
): SentinelHealingAttemptRow {
  return {
    incident_id: INCIDENT_ID,
    source_id: SOURCE_ID,
    collector_id: COLLECTOR_ID,
    attempt_number: 1,
    prompt: "(prompt text that must never reach a public payload)",
    status: "initiated",
    refactor_job_id: null,
    candidate_records_count: null,
    candidate_passed_validation: null,
    validation_details: null,
    error_message: null,
    started_at: "2026-08-20T09:55:21.560Z",
    completed_at: null,
    created_at: "2026-08-20T09:55:21.560Z",
    ...overrides,
  };
}

function attempts(): SentinelHealingAttemptRow[] {
  return [
    attempt({ id: "attempt-initiated" }),
    attempt({
      id: "attempt-preview",
      status: "awaiting_approval",
      refactor_job_id: "ia_test_refactor_job",
      candidate_records_count: 2,
      started_at: "2026-08-20T09:56:39.619Z",
    }),
    attempt({
      id: "attempt-approved",
      status: "approved",
      candidate_records_count: 2,
      candidate_passed_validation: true,
      started_at: "2026-08-20T09:56:42.073Z",
      completed_at: "2026-08-20T09:56:42.073Z",
    }),
  ];
}

/** Canonical row counts and the quarantine reference, as the database holds them. */
function evidencePort(options: {
  counts?: Record<string, number>;
  quarantine?: DemoQuarantinePayloadReference | null;
} = {}): DemoRecoveryEvidencePort & { canonicalReads: string[] } {
  const counts = options.counts ?? {
    [BASELINE_RUN_ID]: 10,
    [INVALID_RUN_ID]: 0,
    [RECOVERY_RUN_ID]: 10,
    [LATER_RUN_ID]: 10,
  };
  const canonicalReads: string[] = [];
  return {
    canonicalReads,
    async countCanonicalRecordsForRun(runId: string) {
      canonicalReads.push(runId);
      return counts[runId] ?? 0;
    },
    async getQuarantinePayloadForIncident(incidentId: string) {
      if (options.quarantine === null) return null;
      return (
        options.quarantine ?? {
          id: "quarantine-1",
          incidentId,
          runId: INVALID_RUN_ID,
          createdAt: "2026-08-20T09:55:22.750Z",
        }
      );
    },
  };
}

function buildInput(overrides: Partial<Parameters<typeof buildDemoRecoveryProof>[0]> = {}) {
  return {
    runs: [laterRun(), recoveryRun(), invalidRun(), baselineRun()],
    incidents: [incident()],
    attempts: attempts(),
    configuration: testDemoConfiguration({ collectorId: COLLECTOR_ID }),
    sourceCollectorId: COLLECTOR_ID,
    isLiveEvidence: true,
    evidence: evidencePort(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The replay itself
// ---------------------------------------------------------------------------

test("recovery proof: replays the full historical arc from persisted rows", async () => {
  const proof = await buildDemoRecoveryProof(buildInput());

  assert.equal(proof.available, true);
  assert.equal(proof.isHistorical, true);
  assert.equal(proof.isLiveEvidence, true);
  assert.equal(proof.summary!.finalState, "recovered");
  assert.equal(proof.recoveredAt, "2026-08-20T09:56:59.462Z");

  assert.deepEqual(
    proof.stages.map((stage) => stage.id),
    [
      "trusted_baseline",
      "source_layout_changed",
      "invalid_extraction",
      "sentinel_detected",
      "quarantined",
      "last_known_good_preserved",
      "bright_data_repair",
      "candidate_validated",
      "approved",
      "recovery_rerun",
      "recovered",
    ],
  );
});

test("recovery proof: stage order is deterministic and matches the declared order", async () => {
  const forward = await buildDemoRecoveryProof(buildInput());
  // Same rows, shuffled. Ordering must come from the stage list, not the input.
  const shuffled = await buildDemoRecoveryProof(
    buildInput({
      runs: [baselineRun(), laterRun(), invalidRun(), recoveryRun()],
      attempts: attempts().reverse(),
    }),
  );

  assert.deepEqual(
    forward.stages.map((stage) => stage.id),
    shuffled.stages.map((stage) => stage.id),
  );
  for (const stage of forward.stages) {
    assert.equal(stage.order, HEALING_DEMO_RECOVERY_STAGE_IDS.indexOf(stage.id));
  }
  const orders = forward.stages.map((stage) => stage.order);
  assert.deepEqual(orders, [...orders].sort((left, right) => left - right));
});

test("recovery proof: the layout stage is marked context, not a database observation", async () => {
  const proof = await buildDemoRecoveryProof(buildInput());
  const layout = proof.stages.find((stage) => stage.id === "source_layout_changed")!;

  assert.equal(layout.kind, "context");
  assert.equal(layout.at, null, "a context stage must not carry a fabricated timestamp");
  for (const stage of proof.stages) {
    if (stage.id === "source_layout_changed") continue;
    assert.equal(stage.kind, "observed");
    assert.ok(stage.at, `${stage.id} must carry the timestamp of the row behind it`);
  }
});

// ---------------------------------------------------------------------------
// Missing evidence removes stages rather than inventing them
// ---------------------------------------------------------------------------

test("recovery proof: no resolved incident means no replay at all", async () => {
  const proof = await buildDemoRecoveryProof(
    buildInput({ incidents: [incident({ status: "open", resolved_at: null })] }),
  );

  assert.equal(proof.available, false);
  assert.deepEqual(proof.stages, []);
  assert.equal(proof.summary, null);
  assert.ok(proof.unavailableReason);
});

test("recovery proof: a missing quarantine row removes the stage instead of faking it", async () => {
  const proof = await buildDemoRecoveryProof(
    buildInput({ evidence: evidencePort({ quarantine: null }) }),
  );

  assert.ok(!proof.stages.some((stage) => stage.id === "quarantined"));
  // Everything the rows do support is still there.
  assert.ok(proof.stages.some((stage) => stage.id === "sentinel_detected"));
});

test("recovery proof: with no verifying re-run the replay stops short of recovered", async () => {
  const proof = await buildDemoRecoveryProof(
    buildInput({ runs: [invalidRun(), baselineRun()] }),
  );

  assert.equal(proof.summary!.finalState, "approved_awaiting_rerun");
  assert.equal(proof.summary!.recoveryRunId, null);
  assert.equal(proof.recoveredAt, null);
  assert.ok(!proof.stages.some((stage) => stage.id === "recovery_rerun"));
  assert.ok(!proof.stages.some((stage) => stage.id === "recovered"));
});

test("recovery proof: with no healing attempts the repair stages disappear", async () => {
  const proof = await buildDemoRecoveryProof(buildInput({ attempts: [] }));

  assert.ok(!proof.stages.some((stage) => stage.id === "bright_data_repair"));
  assert.ok(!proof.stages.some((stage) => stage.id === "candidate_validated"));
  assert.equal(proof.collector!.sameCollectorConfirmed, false);
});

// ---------------------------------------------------------------------------
// Derived claims
// ---------------------------------------------------------------------------

test("recovery proof: zero bad canonical writes is read back, never assumed", async () => {
  const derived = await buildDemoRecoveryProof(buildInput());
  assert.equal(derived.summary!.zeroBadCanonicalWrites, true);
  assert.equal(derived.summary!.canonicalWritesFromInvalidRun, 0);
  // Same rows, but the refused run did leave canonical rows behind.
  const contaminated = await buildDemoRecoveryProof(
    buildInput({
      evidence: evidencePort({
        counts: {
          [BASELINE_RUN_ID]: 10,
          [INVALID_RUN_ID]: 3,
          [RECOVERY_RUN_ID]: 10,
        },
      }),
    }),
  );
  assert.equal(contaminated.summary!.zeroBadCanonicalWrites, false);
  assert.equal(contaminated.summary!.canonicalWritesFromInvalidRun, 3);
});

test("recovery proof: an unknown invalid run cannot claim zero bad writes", async () => {
  const proof = await buildDemoRecoveryProof(
    buildInput({ incidents: [incident({ run_id: null })] }),
  );

  assert.equal(proof.summary!.zeroBadCanonicalWrites, false);
  assert.equal(proof.summary!.canonicalWritesFromInvalidRun, null);
});

test("recovery proof: last-known-good preservation is derived from canonical rows", async () => {
  const preserved = await buildDemoRecoveryProof(buildInput());
  assert.equal(preserved.summary!.lastKnownGoodPreserved, true);
  assert.equal(preserved.summary!.baselineRunId, BASELINE_RUN_ID);
  assert.match(preserved.summary!.lastKnownGoodEvidence!, /still holds/);

  // The baseline no longer holds what the incident credited it with.
  const lost = await buildDemoRecoveryProof(
    buildInput({
      evidence: evidencePort({
        counts: {
          [BASELINE_RUN_ID]: 4,
          [INVALID_RUN_ID]: 0,
          [RECOVERY_RUN_ID]: 10,
        },
      }),
    }),
  );
  assert.equal(lost.summary!.lastKnownGoodPreserved, false);
});

test("recovery proof: same-collector confirmation needs the rows to agree", async () => {
  const confirmed = await buildDemoRecoveryProof(buildInput());
  assert.equal(confirmed.collector!.sameCollectorConfirmed, true);
  assert.equal(confirmed.collector!.ref, COLLECTOR_ID);

  // The repair targeted a collector the source is not registered against.
  const mismatched = await buildDemoRecoveryProof(
    buildInput({ sourceCollectorId: "c_some_other_collector" }),
  );
  assert.equal(mismatched.collector!.sameCollectorConfirmed, false);

  // The attempts disagree among themselves.
  const inconsistent = await buildDemoRecoveryProof(
    buildInput({
      attempts: [
        attempt({ id: "a", collector_id: COLLECTOR_ID }),
        attempt({ id: "b", collector_id: "c_other" }),
      ],
    }),
  );
  assert.equal(inconsistent.collector!.sameCollectorConfirmed, false);
});

test("recovery proof: the invalid and recovery runs are distinct rows", async () => {
  const proof = await buildDemoRecoveryProof(buildInput());
  const summary = proof.summary!;

  assert.equal(summary.invalidRunId, INVALID_RUN_ID);
  assert.equal(summary.recoveryRunId, RECOVERY_RUN_ID);
  assert.notEqual(summary.invalidRunId, summary.recoveryRunId);
  assert.notEqual(summary.recoveryRunId, summary.baselineRunId);
  assert.equal(summary.distinctRunIds, true);
});

test("recovery proof: a later rehearsal run is not mistaken for the recovery", () => {
  const chosen = selectRecoveryRun(
    [laterRun(), recoveryRun(), invalidRun(), baselineRun()],
    incident(),
    [INVALID_RUN_ID, BASELINE_RUN_ID],
  );
  assert.equal(chosen!.id, RECOVERY_RUN_ID);
});

test("recovery proof: an unresolved incident is never selected for replay", () => {
  assert.equal(
    selectRecoveryIncident([
      incident({ id: "open-one", status: "open", resolved_at: null }),
      incident({ id: "healing-one", status: "healing", resolved_at: null }),
    ]),
    null,
  );
  assert.equal(
    selectRecoveryIncident([
      incident({ id: "open-one", status: "open", resolved_at: null }),
      incident({ id: "resolved-one" }),
    ])!.id,
    "resolved-one",
  );
});

// ---------------------------------------------------------------------------
// Nothing secret gets in
// ---------------------------------------------------------------------------

test("recovery proof: prompts, payloads and credentials never enter the payload", async () => {
  const proof = await buildDemoRecoveryProof(buildInput());
  const serialized = JSON.stringify(proof);

  assert.ok(!serialized.includes("must never reach a public payload"), "no healing prompt");
  for (const forbidden of ["prompt", "rawPayload", "raw_payload", "apiKey", "api_key", "token", "secret", "Bearer"]) {
    assert.ok(
      !serialized.includes(forbidden),
      `the replay must not carry a '${forbidden}' field`,
    );
  }
});

// ---------------------------------------------------------------------------
// End to end: the replay is history, and history is not the current session
// ---------------------------------------------------------------------------

function buildPort() {
  const pipeline = new FakeDemoPipelineRepository();
  const sentinel = new RunBackedSentinelRepository(pipeline);
  const harness = new InMemoryDemoHarnessRepository(pipeline, sentinel);
  const collector = new ScriptedCollectorRunner({
    healthy: healthyPayload(),
    broken: tableLayoutPayload(),
  });
  const healer = new ScriptedHealer(awaitingApproval(goodPreview()), {
    onApprove: () => collector.setPayload("broken", healthyPayload()),
  });
  const configuration = testDemoConfiguration();
  const port = createHealingDemoPort({
    configuration,
    harness,
    sentinelRepository: sentinel,
    pipelineRepository: pipeline,
    collector,
    healer,
    live: false,
  });
  return { port, pipeline, sentinel, harness, configuration };
}

async function driveToRecovery(port: ReturnType<typeof buildPort>["port"]) {
  await port.dispatch("establish_baseline");
  await port.dispatch("trigger_failure");
  await port.dispatch("run_broken_collector");
  await port.dispatch("start_healing");
  await port.dispatch("approve_preview");
  return port.dispatch("rerun_recover");
}

test("recovery proof: a real end-to-end recovery produces a replay of itself", async () => {
  const { port, pipeline } = buildPort();
  const recovered = await driveToRecovery(port);

  const proof = recovered.recoveryProof!;
  assert.equal(proof.available, true);
  assert.equal(proof.summary!.finalState, "recovered");
  assert.equal(proof.summary!.zeroBadCanonicalWrites, true);
  assert.equal(proof.summary!.lastKnownGoodPreserved, true);
  assert.equal(proof.collector!.sameCollectorConfirmed, true);
  assert.equal(proof.summary!.distinctRunIds, true);
  assert.equal(proof.isLiveEvidence, false, "the doubles must be declared, not hidden");

  // The refused run really wrote nothing, which is what the flag reports.
  assert.equal(pipeline.snapshotsForRun(proof.summary!.invalidRunId!).length, 0);
  assert.ok(pipeline.snapshotsForRun(proof.summary!.baselineRunId!).length > 0);
});

test("recovery proof: a reset clears the session but not the replay", async () => {
  const { port } = buildPort();
  await driveToRecovery(port);

  const afterReset = projectHealingDemoSnapshot(await port.dispatch("reset"), {
    adapterId: "test",
    kind: "real_bright_data_demo",
    isFixture: false,
  });

  // The current session is genuinely back at the start...
  assert.equal(afterReset.phase, "healthy");
  assert.equal(afterReset.phaseLabel, "Not started");
  assert.equal(afterReset.incident, null);
  assert.equal(afterReset.recovery!.recovered, false);

  // ...while the historical proof is untouched.
  assert.equal(afterReset.recoveryProof.available, true);
  assert.equal(afterReset.recoveryProof.isHistorical, true);
  assert.equal(afterReset.recoveryProof.summary!.finalState, "recovered");
  assert.equal(afterReset.recoveryProof.summary!.incidentStatus, "resolved");
  assert.ok(afterReset.recoveryProof.recoveredAt);
});

test("recovery proof: a resolved incident is never replayed as an open one", async () => {
  const { port } = buildPort();
  await driveToRecovery(port);
  const afterReset = await port.dispatch("reset");

  assert.equal(afterReset.recoveryProof!.summary!.incidentStatus, "resolved");
  assert.equal(afterReset.sentinelStatus, "healthy", "the live source is not in an incident");
  assert.equal(afterReset.quarantine, null);
  assert.equal(
    afterReset.incident,
    null,
    "a resolved historical incident must not resurface as a current one",
  );
});

test("recovery proof: a source that has never run reports the replay unavailable", async () => {
  const { port } = buildPort();
  const snapshot = await port.getSnapshot();

  assert.equal(snapshot.recoveryProof!.available, false);
  assert.deepEqual(snapshot.recoveryProof!.stages, []);
  assert.equal(snapshot.recoveryProof!.summary, null);
});

test("recovery proof: reading the demo state twice changes nothing", async () => {
  const { port, pipeline, sentinel, harness, configuration } = buildPort();
  await driveToRecovery(port);

  const before = {
    runs: pipeline.runs.length,
    snapshots: pipeline.quoteSnapshots.length,
    incidents: sentinel.incidents.length,
    attempts: sentinel.healingAttempts.length,
    phase: harness.state.phase,
  };

  // Read the model repeatedly, through both the backend and the UI port.
  await getDemoHealingReadModel({ configuration, harness });
  await port.getSnapshot();
  const again = await getDemoHealingReadModel({ configuration, harness });

  assert.equal(pipeline.runs.length, before.runs, "reading must not start a run");
  assert.equal(pipeline.quoteSnapshots.length, before.snapshots, "reading must not write");
  assert.equal(sentinel.incidents.length, before.incidents);
  assert.equal(sentinel.healingAttempts.length, before.attempts);
  assert.equal(harness.state.phase, before.phase, "reading must not advance the phase");
  assert.equal(again.recoveryProof.available, true);
});

test("recovery proof: the read path exposes no action that could replay the recovery", async () => {
  const { port } = buildPort();
  await driveToRecovery(port);
  const afterReset = await port.dispatch("reset");

  const proof = afterReset.recoveryProof!;
  // The replay is data only: no callable, no action list, no dispatch hint.
  for (const value of Object.values(proof)) {
    assert.notEqual(typeof value, "function");
  }
  assert.ok(!("actions" in proof));
  assert.ok(!("allowedActions" in proof));
  assert.ok(!("replay" in proof));
});
