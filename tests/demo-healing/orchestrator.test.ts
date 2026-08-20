/**
 * The demonstration state machine, driven end to end.
 *
 * Every step here runs the real orchestrator against the real contract, the
 * real evaluator, the real Sentinel gate and the real ingestion function. Only
 * Bright Data and Supabase are doubled, so what these tests establish is that
 * the *sequence* is genuine: the quarantine is reached by detection, the
 * approval is gated on validation, and the recovery is a real re-run through
 * the same gate rather than a status flipped by hand.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  DemoHealingOrchestrator,
  type DemoAction,
} from "../../lib/demo-healing/orchestrator";
import { getDemoHealingReadModel } from "../../lib/demo-healing/read-model";
import {
  awaitingApproval,
  FakeDemoPipelineRepository,
  InMemoryDemoHarnessRepository,
  RunBackedSentinelRepository,
  ScriptedCollectorRunner,
  ScriptedHealer,
  testDemoConfiguration,
} from "./support/doubles";
import {
  badPreview,
  goodPreview,
  healthyPayload,
  tableLayoutPayload,
} from "./support/payloads";

function buildHarness(
  options: { brokenPayload?: unknown[]; preview?: unknown[] } = {},
) {
  const pipeline = new FakeDemoPipelineRepository();
  const sentinel = new RunBackedSentinelRepository(pipeline);
  const harness = new InMemoryDemoHarnessRepository(pipeline, sentinel);
  const configuration = testDemoConfiguration();
  const collector = new ScriptedCollectorRunner({
    healthy: healthyPayload(),
    broken: options.brokenPayload ?? tableLayoutPayload(),
  });
  // Approving the candidate is what makes the repaired template take effect:
  // from then on the broken layout extracts correctly, exactly as an approved
  // Scraper Studio refactor would behave on the next run.
  const healer = new ScriptedHealer(awaitingApproval(options.preview ?? goodPreview()), {
    onApprove: () => collector.setPayload("broken", healthyPayload()),
  });

  const orchestrator = new DemoHealingOrchestrator({
    configuration,
    harness,
    sentinelRepository: sentinel,
    pipelineRepository: pipeline,
    collector,
    healer,
    live: false,
  });

  const readModel = () =>
    getDemoHealingReadModel({ configuration, harness, includeOperatorDetail: true });

  return { pipeline, sentinel, harness, collector, healer, orchestrator, readModel };
}

async function run(orchestrator: DemoHealingOrchestrator, actions: DemoAction[]) {
  const results = [];
  for (const action of actions) results.push(await orchestrator.execute(action));
  return results;
}

// ---------------------------------------------------------------------------
// The happy path, in order
// ---------------------------------------------------------------------------

test("lifecycle: healthy baseline → quarantine → heal → validate → approve → recover", async () => {
  const { orchestrator, pipeline, sentinel, healer, collector, readModel } = buildHarness();

  // 1. Healthy extraction establishes last-known-good.
  const baseline = await orchestrator.execute("run_baseline");
  assert.equal(baseline.status, "ok", baseline.summary);
  assert.equal(baseline.phase, "healthy");
  assert.equal(pipeline.quoteSnapshots.length, healthyPayload().length);

  // 2. The controlled break re-points the collector; nothing else changes.
  const armed = await orchestrator.execute("arm_failure");
  assert.equal(armed.status, "ok");
  assert.equal(armed.phase, "failure_armed");
  assert.equal(sentinel.incidents.length, 0, "arming must not fabricate an incident");
  assert.equal(pipeline.quoteSnapshots.length, healthyPayload().length);

  // 3. The invalid observation is detected and quarantined.
  const broken = await orchestrator.execute("run_broken");
  assert.equal(broken.status, "refused");
  assert.equal(broken.phase, "quarantined");
  assert.equal(collector.calls.at(-1)!.layout, "broken");
  assert.equal(sentinel.incidents.length, 1);
  assert.equal(sentinel.quarantinePayloads.length, 1);

  // Zero canonical writes from the refused run; baseline untouched.
  const afterBreak = await readModel();
  assert.equal(afterBreak.quarantine.canonicalWritesFromRefusedRun, 0);
  assert.equal(afterBreak.lastKnownGoodPreserved, true);
  // The run still serving is the baseline run, not the refused one.
  assert.equal(afterBreak.lastKnownGoodRun!.runId, pipeline.runs[0]!.id);
  assert.notEqual(afterBreak.lastKnownGoodRun!.runId, afterBreak.currentRun!.runId);
  assert.equal(afterBreak.lastKnownGoodRun!.canonicalRecordsWritten, healthyPayload().length);
  assert.equal(afterBreak.canonicalRecordTotal, healthyPayload().length);
  assert.equal(afterBreak.sentinel.state, "quarantined");

  // 4. Healing is requested from Bright Data, describing the observed symptom.
  const healRequest = await orchestrator.execute("request_heal");
  assert.equal(healRequest.status, "ok", healRequest.summary);
  assert.equal(healRequest.phase, "healing");
  assert.equal(healer.healRequests.length, 1);
  assert.equal(healer.healRequests[0]!.collectorId, "c_test_demo_collector");
  assert.ok(healer.healRequests[0]!.prompt.includes("quote_text"));
  // The repair must be bound to the layout that actually failed. Bright Data
  // otherwise previews the candidate against the template's stored input — the
  // layout that still works — and the repair never sees what broke.
  assert.equal(
    healer.healRequests[0]!.sourceUrl,
    "https://quotes.toscrape.com/tableful/",
  );
  assert.equal(sentinel.incidents[0]!.status, "healing");

  // No approval has been sent yet — the candidate is still unjudged.
  assert.deepEqual(healer.decisions, []);

  // 5. The candidate is judged by the same contract.
  const validated = await orchestrator.execute("validate_preview");
  assert.equal(validated.status, "ok", validated.summary);
  assert.equal(validated.phase, "preview_validated");
  assert.deepEqual(healer.decisions, [], "validation must not approve anything by itself");

  // 6. Approval — only now.
  const approved = await orchestrator.execute("approve");
  assert.equal(approved.status, "ok");
  assert.equal(approved.phase, "approved");
  assert.deepEqual(healer.decisions, [true]);

  // 7. The repaired collector re-runs through the same gate.
  const recovered = await orchestrator.execute("rerun");
  assert.equal(recovered.status, "ok", recovered.summary);
  assert.equal(recovered.phase, "recovered");

  const final = await readModel();
  assert.equal(final.recovery.recovered, true);
  assert.ok(final.recovery.recoveredRunId);
  assert.equal(final.sentinel.state, "recovered");
  assert.equal(final.canonicalRecordTotal, healthyPayload().length * 2);
  assert.equal(final.quarantine.canonicalWritesFromRefusedRun, 0);
  assert.equal(final.evidence.isLive, false, "a doubled run must never claim to be live");

  // The incident closed, and the healing attempt trail records the whole arc.
  assert.equal(sentinel.incidents[0]!.status, "resolved");
  const statuses = sentinel.healingAttempts.map((attempt) => attempt.status);
  assert.ok(statuses.includes("initiated"));
  assert.ok(statuses.includes("awaiting_approval"));
  assert.ok(statuses.includes("approved"));
});

// ---------------------------------------------------------------------------
// Refusals — the sequence cannot be short-circuited
// ---------------------------------------------------------------------------

test("ordering: the failure cannot be armed before a baseline exists", async () => {
  const { orchestrator, sentinel } = buildHarness();

  const result = await orchestrator.execute("arm_failure");

  assert.equal(result.status, "refused");
  assert.equal(result.phase, "unprepared");
  assert.equal(sentinel.incidents.length, 0);
});

test("ordering: the broken run is refused while the failure is not armed", async () => {
  const { orchestrator, collector } = buildHarness();

  await orchestrator.execute("run_baseline");
  const result = await orchestrator.execute("run_broken");

  assert.equal(result.status, "refused");
  assert.equal(collector.calls.length, 1, "no second collector run should have happened");
});

test("ordering: healing cannot be requested without a real open incident", async () => {
  const { orchestrator, healer } = buildHarness();

  await run(orchestrator, ["run_baseline", "arm_failure"]);
  const result = await orchestrator.execute("request_heal");

  assert.equal(result.status, "refused");
  assert.equal(healer.healRequests.length, 0, "Bright Data must not be called speculatively");
});

test("ordering: a re-run is refused until the repaired template is approved", async () => {
  const { orchestrator, collector } = buildHarness();

  await run(orchestrator, ["run_baseline", "arm_failure", "run_broken", "request_heal", "validate_preview"]);
  const before = collector.calls.length;

  const result = await orchestrator.execute("rerun");

  assert.equal(result.status, "refused");
  assert.equal(collector.calls.length, before, "the failing collector must not be re-run");
});

// ---------------------------------------------------------------------------
// The approval gate
// ---------------------------------------------------------------------------

test("gate: a candidate that fails validation is rejected and cannot be approved", async () => {
  const { orchestrator, healer, pipeline, readModel } = buildHarness({ preview: badPreview() });

  await run(orchestrator, ["run_baseline", "arm_failure", "run_broken", "request_heal"]);

  const validated = await orchestrator.execute("validate_preview");
  assert.equal(validated.status, "refused");
  assert.equal(validated.phase, "preview_rejected");

  const model = await readModel();
  assert.equal(model.healing.previewValidationPassed, false);
  assert.ok(model.healing.previewReasonCodes.length > 0);
  assert.equal(model.healing.approvalState, "rejected");

  // Approval is closed behind it, and Bright Data is told to discard.
  const approved = await orchestrator.execute("approve");
  assert.equal(approved.status, "refused");
  assert.ok(!healer.decisions.includes(true), "a failed candidate must never be approved");

  // And nothing was written on the strength of it.
  assert.equal(pipeline.quoteSnapshots.length, healthyPayload().length);
});

test("gate: approval is refused when validation was never run at all", async () => {
  const { orchestrator, healer } = buildHarness();

  await run(orchestrator, ["run_baseline", "arm_failure", "run_broken", "request_heal"]);
  const result = await orchestrator.execute("approve");

  assert.equal(result.status, "refused");
  assert.ok(!healer.decisions.includes(true));
});

test("gate: a rejected candidate can be healed again rather than forced through", async () => {
  const { orchestrator, healer, readModel } = buildHarness({ preview: badPreview() });

  await run(orchestrator, [
    "run_baseline",
    "arm_failure",
    "run_broken",
    "request_heal",
    "validate_preview",
  ]);
  assert.equal((await readModel()).phase.phase, "preview_rejected");

  // Bright Data comes back with a candidate that actually works.
  healer.setOutcome(awaitingApproval(goodPreview()));
  const second = await orchestrator.execute("request_heal");
  assert.equal(second.status, "ok", second.summary);

  const validated = await orchestrator.execute("validate_preview");
  assert.equal(validated.phase, "preview_validated");
  assert.equal(healer.healRequests.length, 2);
});

test("gate: the healing budget is finite and ends in needs_review", async () => {
  const { orchestrator, sentinel, readModel } = buildHarness({ preview: badPreview() });

  await run(orchestrator, ["run_baseline", "arm_failure", "run_broken"]);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await orchestrator.execute("request_heal");
    await orchestrator.execute("validate_preview");
  }

  const exhausted = await orchestrator.execute("request_heal");
  assert.equal(exhausted.status, "refused");
  assert.equal(exhausted.phase, "needs_review");
  assert.equal((await readModel()).sentinel.state, "needs_review");
  assert.equal(sentinel.incidents[0]!.status, "needs_review");
});

// ---------------------------------------------------------------------------
// Recovery must be earned
// ---------------------------------------------------------------------------

test("recovery: an approved template that still does not work is quarantined again", async () => {
  // The candidate previews well but the saved template keeps failing on the
  // full page. Approval must not be enough on its own.
  const pipeline = new FakeDemoPipelineRepository();
  const sentinel = new RunBackedSentinelRepository(pipeline);
  const harness = new InMemoryDemoHarnessRepository(pipeline, sentinel);
  const configuration = testDemoConfiguration();
  const collector = new ScriptedCollectorRunner({
    healthy: healthyPayload(),
    broken: tableLayoutPayload(),
  });
  const healer = new ScriptedHealer(awaitingApproval(goodPreview())); // no repair on approve
  const orchestrator = new DemoHealingOrchestrator({
    configuration,
    harness,
    sentinelRepository: sentinel,
    pipelineRepository: pipeline,
    collector,
    healer,
    live: false,
  });

  await run(orchestrator, [
    "run_baseline",
    "arm_failure",
    "run_broken",
    "request_heal",
    "validate_preview",
    "approve",
  ]);
  const rerun = await orchestrator.execute("rerun");

  assert.equal(rerun.status, "refused");
  assert.equal(rerun.phase, "quarantined");
  assert.equal(pipeline.quoteSnapshots.length, healthyPayload().length, "still no bad writes");
});

test("recovery: the recovered run went through the same gate as every other run", async () => {
  const { orchestrator, pipeline, readModel } = buildHarness();

  await run(orchestrator, [
    "run_baseline",
    "arm_failure",
    "run_broken",
    "request_heal",
    "validate_preview",
    "approve",
    "rerun",
  ]);

  const model = await readModel();
  const recoveredRunId = model.recovery.recoveredRunId!;
  // A run row exists for it, it succeeded, and its canonical rows are attached
  // to it — the same evidence the baseline run produced.
  const row = pipeline.runs.find((candidate) => candidate.id === recoveredRunId)!;
  assert.equal(row.status, "succeeded");
  assert.equal(pipeline.snapshotsForRun(recoveredRunId).length, healthyPayload().length);
});

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

test("reset: returns to the start without erasing the evidence that was produced", async () => {
  const { orchestrator, pipeline, sentinel, readModel } = buildHarness();

  await run(orchestrator, ["run_baseline", "arm_failure", "run_broken"]);
  const runsBefore = pipeline.runs.length;
  const incidentsBefore = sentinel.incidents.length;
  const rowsBefore = pipeline.quoteSnapshots.length;

  const result = await orchestrator.execute("reset");
  assert.equal(result.status, "ok");
  assert.equal(result.phase, "unprepared");

  const model = await readModel();
  assert.equal(model.source.armedLayout, "healthy");
  assert.equal(model.healing.approvalState, "not_requested");
  assert.equal(model.timeline.length, 1, "the journal restarts");

  // Runs, incidents and canonical rows are history, not scratch state.
  assert.equal(pipeline.runs.length, runsBefore);
  assert.equal(sentinel.incidents.length, incidentsBefore);
  assert.equal(pipeline.quoteSnapshots.length, rowsBefore);
});

test("reset: a template break is undone by a real restorative refactor", async () => {
  const { orchestrator, healer } = buildHarness();

  await orchestrator.execute("run_baseline");
  const broke = await orchestrator.execute("break_template");
  assert.equal(broke.status, "ok", broke.summary);
  assert.equal(healer.healRequests.length, 1);

  await orchestrator.execute("reset");
  assert.equal(healer.healRequests.length, 2, "reset must repair the collector it broke");
  assert.ok(healer.healRequests[1]!.prompt.includes("Restore"));
});

// ---------------------------------------------------------------------------
// The journal
// ---------------------------------------------------------------------------

test("journal: every step is recorded with its real outcome, refusals included", async () => {
  const { orchestrator, readModel } = buildHarness();

  await run(orchestrator, [
    "run_baseline",
    "arm_failure",
    "run_broken",
    "request_heal",
    "validate_preview",
    "approve",
    "rerun",
  ]);

  const timeline = (await readModel()).timeline;
  assert.deepEqual(
    timeline.map((entry) => entry.action),
    ["run_baseline", "arm_failure", "run_broken", "request_heal", "validate_preview", "approve", "rerun"],
  );
  const brokenEntry = timeline.find((entry) => entry.action === "run_broken")!;
  assert.equal(brokenEntry.status, "refused");
  assert.equal(brokenEntry.phase, "quarantined");
});
