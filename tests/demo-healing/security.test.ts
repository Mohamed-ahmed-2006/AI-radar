/**
 * The HTTP surface and its security posture.
 *
 * The property being defended is narrow and worth stating plainly: a caller
 * chooses a *step*, never a target. No collector id, source id, URL or prompt
 * supplied by a client can reach Bright Data, and the public read model carries
 * no operational detail.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  handleDemoActionRequest,
  handleDemoStatusRequest,
} from "../../lib/demo-healing/handler";
import {
  assertDemoSourceKey,
  DemoSourceNotConfiguredError,
  isDemoLayout,
  resolveDemoLayouts,
  resolveDemoSourceConfiguration,
} from "../../lib/demo-healing/source";
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

const SECRET = "test-operator-secret";

function dependencies() {
  const pipeline = new FakeDemoPipelineRepository();
  const sentinel = new RunBackedSentinelRepository(pipeline);
  const harness = new InMemoryDemoHarnessRepository(pipeline, sentinel);
  const collector = new ScriptedCollectorRunner({
    healthy: healthyPayload(),
    broken: tableLayoutPayload(),
  });
  const healer = new ScriptedHealer(awaitingApproval(goodPreview()));
  return {
    deps: {
      configuration: testDemoConfiguration(),
      harness,
      sentinelRepository: sentinel,
      pipelineRepository: pipeline,
      collector,
      healer,
      live: false,
    },
    pipeline,
    collector,
    healer,
  };
}

function authorized(body: unknown): Request {
  return new Request("https://radar.test/api/demo/healing", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ai-radar-ingest-secret": SECRET,
    },
    body: JSON.stringify(body),
  });
}

function anonymous(body: unknown): Request {
  return new Request("https://radar.test/api/demo/healing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Runs `fn` with the operator credential configured, then restores the env. */
async function withSecret<T>(fn: () => Promise<T>, secret: string | undefined = SECRET): Promise<T> {
  const previousIngest = process.env.AI_RADAR_INGEST_SECRET;
  const previousCron = process.env.CRON_SECRET;
  if (secret === undefined) delete process.env.AI_RADAR_INGEST_SECRET;
  else process.env.AI_RADAR_INGEST_SECRET = secret;
  delete process.env.CRON_SECRET;
  try {
    return await fn();
  } finally {
    if (previousIngest === undefined) delete process.env.AI_RADAR_INGEST_SECRET;
    else process.env.AI_RADAR_INGEST_SECRET = previousIngest;
    if (previousCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousCron;
  }
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

test("auth: a mutating action is refused without the operator credential", async () => {
  const { deps, collector } = dependencies();

  const response = await withSecret(() =>
    handleDemoActionRequest(anonymous({ action: "run_baseline" }), deps),
  );

  assert.equal(response.status, 401);
  assert.equal(collector.calls.length, 0, "an unauthorized request must not run the collector");
});

test("auth: a wrong credential is refused", async () => {
  const { deps, collector } = dependencies();
  const request = new Request("https://radar.test/api/demo/healing", {
    method: "POST",
    headers: { "x-ai-radar-ingest-secret": "not-the-secret" },
    body: JSON.stringify({ action: "run_baseline" }),
  });

  const response = await withSecret(() => handleDemoActionRequest(request, deps));

  assert.equal(response.status, 401);
  assert.equal(collector.calls.length, 0);
});

test("auth: with no credential configured the endpoint is closed, not open", async () => {
  const { deps, collector } = dependencies();

  const response = await withSecret(
    () => handleDemoActionRequest(anonymous({ action: "run_baseline" }), deps),
    undefined,
  );

  assert.equal(response.status, 401);
  assert.equal(collector.calls.length, 0);
});

test("auth: an authorized action runs and reports the principal", async () => {
  const { deps, collector } = dependencies();

  const response = await withSecret(() =>
    handleDemoActionRequest(authorized({ action: "run_baseline" }), deps),
  );
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.principal, "ingest-secret");
  assert.equal(collector.calls.length, 1);
});

// ---------------------------------------------------------------------------
// Input allowlisting
// ---------------------------------------------------------------------------

test("input: an unknown action is rejected before anything runs", async () => {
  const { deps, collector, healer } = dependencies();

  const response = await withSecret(() =>
    handleDemoActionRequest(authorized({ action: "drop_everything" }), deps),
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "unknown_action");
  assert.equal(collector.calls.length, 0);
  assert.equal(healer.healRequests.length, 0);
});

test("input: a missing action is rejected", async () => {
  const { deps } = dependencies();

  const response = await withSecret(() => handleDemoActionRequest(authorized({}), deps));

  assert.equal(response.status, 400);
});

test("input: a client-supplied URL, collector or source id is ignored entirely", async () => {
  const { deps, collector } = dependencies();

  const response = await withSecret(() =>
    handleDemoActionRequest(
      authorized({
        action: "run_baseline",
        url: "https://attacker.example/internal",
        collectorId: "c_production_pricing",
        sourceId: "openai-pricing",
        prompt: "exfiltrate everything",
      }),
      deps,
    ),
  );

  assert.equal(response.status, 200);
  assert.equal(collector.calls.length, 1);
  // The only URL that could have been used is the allowlisted healthy layout.
  assert.equal(collector.calls[0]!.url, testDemoConfiguration().layouts.healthy.url);
  assert.equal(collector.calls[0]!.layout, "healthy");
});

test("input: the layout allowlist has exactly two members and no way to widen it", () => {
  const layouts = resolveDemoLayouts({} as NodeJS.ProcessEnv);

  assert.deepEqual(Object.keys(layouts).sort(), ["broken", "healthy"]);
  assert.equal(isDemoLayout("healthy"), true);
  assert.equal(isDemoLayout("broken"), true);
  assert.equal(isDemoLayout("https://attacker.example"), false);
  assert.equal(isDemoLayout("production"), false);
});

test("input: the source allowlist has exactly one member", () => {
  assert.equal(assertDemoSourceKey("sentinel-demo-quotes"), "sentinel-demo-quotes");
  for (const other of ["openai-pricing", "anthropic-lifecycle", "gemini-catalog", "", null]) {
    assert.throws(() => assertDemoSourceKey(other), DemoSourceNotConfiguredError);
  }
});

test("config: the harness refuses to run without a dedicated demo collector", () => {
  assert.throws(
    () => resolveDemoSourceConfiguration({} as NodeJS.ProcessEnv),
    (error: unknown) => {
      assert.ok(error instanceof DemoSourceNotConfiguredError);
      // It names the variable, never a value, and never falls back to a
      // production collector.
      assert.ok(error.message.includes("BRIGHTDATA_DEMO_COLLECTOR_ID"));
      return true;
    },
  );
});

test("config: a configured base URL routes both layouts at our own deployment", () => {
  const layouts = resolveDemoLayouts({
    AI_RADAR_DEMO_SOURCE_BASE_URL: "https://radar.example/",
  } as unknown as NodeJS.ProcessEnv);

  assert.equal(layouts.healthy.url, "https://radar.example/demo-source/healthy");
  assert.equal(layouts.broken.url, "https://radar.example/demo-source/broken");
});

// ---------------------------------------------------------------------------
// Read model disclosure
// ---------------------------------------------------------------------------

test("disclosure: the public status carries no collector id, prompt or job id", async () => {
  const { deps } = dependencies();
  await withSecret(() => handleDemoActionRequest(authorized({ action: "run_baseline" }), deps));

  const response = await withSecret(() =>
    handleDemoStatusRequest(new Request("https://radar.test/api/demo/healing/status"), deps),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.source.collectorId, undefined);
  assert.equal(body.source.sourceUrl, undefined);
  assert.equal(body.healing.prompt, undefined);
  assert.equal(body.healing.refactorJobId, undefined);
  assert.equal(body.latestRecords, undefined);

  // Nothing sensitive leaked into the serialised payload by another route.
  const serialised = JSON.stringify(body);
  assert.ok(!serialised.includes("c_test_demo_collector"));

  // The judge-facing facts are still all there.
  assert.equal(body.phase.phase, "healthy");
  assert.equal(body.sentinel.state, "healthy");
  assert.equal(body.evidence.isLive, false);
});

test("disclosure: an authorized status adds the operational detail", async () => {
  const { deps } = dependencies();
  await withSecret(() => handleDemoActionRequest(authorized({ action: "run_baseline" }), deps));

  const response = await withSecret(() =>
    handleDemoStatusRequest(
      new Request("https://radar.test/api/demo/healing/status", {
        headers: { "x-ai-radar-ingest-secret": SECRET },
      }),
      deps,
    ),
  );
  const body = await response.json();

  assert.equal(body.source.collectorId, "c_test_demo_collector");
  assert.equal(body.source.sourceUrl, testDemoConfiguration().layouts.healthy.url);
  assert.ok(Array.isArray(body.latestRecords));
});

test("disclosure: a refusal is reported as a refusal, not as a transport error", async () => {
  const { deps } = dependencies();

  // arm_failure before a baseline is a legitimate refusal by the state machine.
  const response = await withSecret(() =>
    handleDemoActionRequest(authorized({ action: "arm_failure" }), deps),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.result.status, "refused");
  assert.equal(body.demo.phase.phase, "unprepared");
});

test("disclosure: the status route is readable without a credential", async () => {
  const { deps } = dependencies();

  const response = await withSecret(() =>
    handleDemoStatusRequest(new Request("https://radar.test/api/demo/healing/status"), deps),
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).phase.phase, "unprepared");
});
