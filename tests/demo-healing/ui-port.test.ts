/**
 * The wiring between the real healing backend and the SourcePulse demo UI.
 *
 * The port is a projection, so what matters is that it cannot *add* anything:
 * no phase, no approval and no recovery that the backend did not report. These
 * tests drive the real orchestrator — only Bright Data and Supabase are
 * doubled — and check the projection against what actually happened.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createHealingDemoPort } from "../../lib/demo-healing/ui-port";
import { projectHealingDemoSnapshot } from "../../lib/product/healing-demo";
import {
  awaitingApproval,
  FakeDemoPipelineRepository,
  InMemoryDemoHarnessRepository,
  RunBackedSentinelRepository,
  ScriptedCollectorRunner,
  ScriptedHealer,
  testDemoConfiguration,
} from "./support/doubles";
import { badPreview, goodPreview, healthyPayload, tableLayoutPayload } from "./support/payloads";

function buildPort(options: { preview?: unknown[]; includeOperatorDetail?: boolean } = {}) {
  const pipeline = new FakeDemoPipelineRepository();
  const sentinel = new RunBackedSentinelRepository(pipeline);
  const harness = new InMemoryDemoHarnessRepository(pipeline, sentinel);
  const collector = new ScriptedCollectorRunner({
    healthy: healthyPayload(),
    broken: tableLayoutPayload(),
  });
  const healer = new ScriptedHealer(awaitingApproval(options.preview ?? goodPreview()), {
    // Approval is what makes the repaired template take effect on the next run.
    onApprove: () => collector.setPayload("broken", healthyPayload()),
  });

  const port = createHealingDemoPort({
    configuration: testDemoConfiguration(),
    harness,
    sentinelRepository: sentinel,
    pipelineRepository: pipeline,
    collector,
    healer,
    live: false,
    includeOperatorDetail: options.includeOperatorDetail ?? false,
  });

  return { port, pipeline, sentinel, healer, collector };
}

/** The read model the page actually renders, projector included. */
async function readModel(port: ReturnType<typeof buildPort>["port"]) {
  return projectHealingDemoSnapshot(await port.getSnapshot(), {
    adapterId: "test",
    kind: "real_bright_data_demo",
    isFixture: false,
  });
}

// ---------------------------------------------------------------------------
// The full arc, driven entirely through UI actions
// ---------------------------------------------------------------------------

test("port: the UI action sequence reaches a real recovery", async () => {
  const { port, pipeline, sentinel } = buildPort();

  const start = await readModel(port);
  assert.equal(start.phase, "healthy");
  assert.equal(start.phaseLabel, "Not started");
  assert.deepEqual(start.allowedActions.sort(), ["establish_baseline", "reset"]);

  const baseline = await port.dispatch("establish_baseline");
  assert.equal(baseline.phase, "healthy");
  assert.equal(baseline.lastKnownGood!.recordCount, healthyPayload().length);
  assert.equal(pipeline.quoteSnapshots.length, healthyPayload().length);

  const armed = await port.dispatch("trigger_failure");
  assert.equal(armed.phase, "break");
  assert.equal(sentinel.incidents.length, 0, "arming must not fabricate an incident");

  const broken = await port.dispatch("run_broken_collector");
  assert.equal(broken.phase, "quarantined");
  assert.equal(broken.incident!.reasonCodes.length > 0, true);
  assert.equal(broken.recovery!.recovered, false);

  const healed = await port.dispatch("start_healing");
  assert.equal(healed.phase, "preview_validated");
  assert.equal(healed.validation!.passed, true);

  const approved = await port.dispatch("approve_preview");
  assert.equal(approved.phase, "approved");
  assert.equal(approved.approval!.approved, true);

  const recovered = await port.dispatch("rerun_recover");
  assert.equal(recovered.phase, "recovered");
  assert.equal(recovered.recovery!.recovered, true);
  assert.equal(recovered.sentinelStatus, "recovered");
  assert.equal(recovered.candidate!.invalidCount, 0);
});

test("port: start_healing really runs both backend steps", async () => {
  const { port, healer, sentinel } = buildPort();

  await port.dispatch("establish_baseline");
  await port.dispatch("trigger_failure");
  await port.dispatch("run_broken_collector");
  const healed = await port.dispatch("start_healing");

  // Bright Data was asked for a repair...
  assert.equal(healer.healRequests.length, 1);
  // ...and the candidate was genuinely judged, not assumed good.
  assert.equal(healed.validation!.passed, true);
  assert.ok(
    sentinel.healingAttempts.some((attempt) => attempt.status === "awaiting_approval"),
    "the refactor reached the approval gate",
  );
  // Validation alone must not approve anything.
  assert.deepEqual(healer.decisions, []);
});

// ---------------------------------------------------------------------------
// Approval is gated on validation
// ---------------------------------------------------------------------------

test("port: a failed preview blocks approval and never offers the action", async () => {
  const { port, healer } = buildPort({ preview: badPreview() });

  await port.dispatch("establish_baseline");
  await port.dispatch("trigger_failure");
  await port.dispatch("run_broken_collector");
  const rejected = await port.dispatch("start_healing");

  assert.equal(rejected.phase, "preview_failed");
  assert.equal(rejected.validation!.passed, false);
  assert.equal(rejected.approval!.available, false);
  assert.equal(rejected.brightData!.approvalState, "blocked");
  assert.ok(
    !rejected.allowedActions.includes("approve_preview"),
    "approve_preview must not be offered on a failed preview",
  );

  // And pressing it anyway changes nothing.
  const forced = await port.dispatch("approve_preview");
  assert.equal(forced.approval!.approved, false);
  assert.ok(!healer.decisions.includes(true), "a failed candidate is never approved");
});

test("port: approve_preview is offered only once validation has passed", async () => {
  const { port } = buildPort();

  await port.dispatch("establish_baseline");
  await port.dispatch("trigger_failure");
  const quarantined = await port.dispatch("run_broken_collector");
  assert.ok(!quarantined.allowedActions.includes("approve_preview"));

  const validated = await port.dispatch("start_healing");
  assert.ok(validated.allowedActions.includes("approve_preview"));
  assert.equal(validated.brightData!.approvalState, "available");
});

test("port: recovery is refused when the approved template still does not work", async () => {
  const pipeline = new FakeDemoPipelineRepository();
  const sentinel = new RunBackedSentinelRepository(pipeline);
  const harness = new InMemoryDemoHarnessRepository(pipeline, sentinel);
  const collector = new ScriptedCollectorRunner({
    healthy: healthyPayload(),
    broken: tableLayoutPayload(),
  });
  // Previews well, but approval repairs nothing.
  const healer = new ScriptedHealer(awaitingApproval(goodPreview()));
  const port = createHealingDemoPort({
    configuration: testDemoConfiguration(),
    harness,
    sentinelRepository: sentinel,
    pipelineRepository: pipeline,
    collector,
    healer,
    live: false,
  });

  await port.dispatch("establish_baseline");
  await port.dispatch("trigger_failure");
  await port.dispatch("run_broken_collector");
  await port.dispatch("start_healing");
  await port.dispatch("approve_preview");
  const rerun = await port.dispatch("rerun_recover");

  assert.equal(rerun.phase, "quarantined");
  assert.equal(rerun.recovery!.recovered, false);
  assert.equal(pipeline.quoteSnapshots.length, healthyPayload().length, "no bad writes");
});

// ---------------------------------------------------------------------------
// Last-known-good
// ---------------------------------------------------------------------------

test("port: last-known-good is unchanged across an invalid attempt", async () => {
  const { port } = buildPort();

  await port.dispatch("establish_baseline");
  const beforeBreak = await readModel(port);

  await port.dispatch("trigger_failure");
  const quarantined = await port.dispatch("run_broken_collector");

  assert.deepEqual(quarantined.lastKnownGood, beforeBreak.lastKnownGood);
  assert.equal(quarantined.lastKnownGood!.invalidCount, 0);
  assert.match(quarantined.quarantine!.summary!, /0 canonical writes from the refused run/);
  assert.match(quarantined.quarantine!.summary!, /Last-known-good preserved/);
  // The invalid candidate is shown as the candidate, never as trusted data.
  assert.notEqual(quarantined.candidate!.runId, quarantined.lastKnownGood!.runId);
  assert.ok(quarantined.candidate!.invalidCount! > 0);
});

test("port: repeated invalid attempts never disturb last-known-good", async () => {
  const { port } = buildPort({ preview: badPreview() });

  await port.dispatch("establish_baseline");
  const baseline = (await readModel(port)).lastKnownGood;

  await port.dispatch("trigger_failure");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await port.dispatch("run_broken_collector");
    await port.dispatch("start_healing");
  }

  assert.deepEqual((await readModel(port)).lastKnownGood, baseline);
});

// ---------------------------------------------------------------------------
// Disclosure and labelling
// ---------------------------------------------------------------------------

test("port: the public snapshot discloses no collector id or source URL", async () => {
  const { port } = buildPort();
  await port.dispatch("establish_baseline");

  const model = await readModel(port);

  assert.equal(model.brightData!.collectorId, null);
  assert.equal(model.identity!.sourceUrl, null);
  assert.ok(!JSON.stringify(model).includes("c_test_demo_collector"));
});

test("port: an operator snapshot adds the collector id and source URL", async () => {
  const { port } = buildPort({ includeOperatorDetail: true });
  await port.dispatch("establish_baseline");

  const model = await readModel(port);

  assert.equal(model.brightData!.collectorId, "c_test_demo_collector");
  assert.equal(model.identity!.sourceUrl, testDemoConfiguration().layouts.healthy.url);
});

test("port: the real demo is never labelled as a fixture", async () => {
  const { port } = buildPort();
  await port.dispatch("establish_baseline");

  const model = await readModel(port);

  assert.equal(model.isFixture, false);
  assert.equal(model.isDemo, false);
  assert.equal(model.kind, "real_bright_data_demo");
  assert.equal(model.available, true);
});

// ---------------------------------------------------------------------------
// The action surface
// ---------------------------------------------------------------------------

test("port: the contingency template break is not reachable from the UI", async () => {
  const { port, healer } = buildPort();
  await port.dispatch("establish_baseline");

  const model = await readModel(port);

  // The backend offers break_template here; the UI action set does not carry it.
  assert.ok(model.allowedActions.includes("trigger_failure"));
  assert.equal(model.allowedActions.length, new Set(model.allowedActions).size);
  for (const action of model.allowedActions) {
    assert.ok(
      ["reset", "establish_baseline", "trigger_failure", "run_broken_collector",
       "start_healing", "approve_preview", "rerun_recover"].includes(action),
      `unexpected action ${action}`,
    );
  }
  assert.equal(healer.healRequests.length, 0, "no refactor was started by reading state");
});

test("port: an unknown action is refused rather than dispatched", async () => {
  const { port } = buildPort();

  await assert.rejects(
    () => port.dispatch("delete_collector" as never),
    /not in the healing demo allowlist/i,
  );
});

test("port: timeline stages carry evidence only once they have happened", async () => {
  const { port } = buildPort();
  await port.dispatch("establish_baseline");

  const model = await readModel(port);
  const recovery = model.timeline.find((stage) => stage.stepId === "recovery")!;

  assert.equal(recovery.status, "pending");
  assert.equal(recovery.evidence, null);
  assert.equal(recovery.at, null);
});

test("port: reset returns to the start without erasing the evidence", async () => {
  const { port, pipeline, sentinel } = buildPort();

  await port.dispatch("establish_baseline");
  await port.dispatch("trigger_failure");
  await port.dispatch("run_broken_collector");
  const runsBefore = pipeline.runs.length;
  const incidentsBefore = sentinel.incidents.length;

  const reset = await port.dispatch("reset");

  assert.equal(reset.phase, "healthy");
  assert.equal(reset.phaseLabel, "Not started");
  assert.equal(pipeline.runs.length, runsBefore);
  assert.equal(sentinel.incidents.length, incidentsBefore);
});
