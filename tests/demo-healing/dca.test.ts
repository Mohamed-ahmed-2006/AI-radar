/**
 * The Bright Data DCA transport and the healer built on it.
 *
 * These tests pin the wire contract: which paths are called, what the approval
 * and rejection bodies actually say, and how Bright Data's status vocabulary
 * maps onto a decision. Getting this wrong would not fail loudly during a live
 * run — it would silently approve or discard the wrong thing — so it is checked
 * against a scripted transport rather than assumed.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  DCA_AWAITING_APPROVAL_STATUS,
  DCA_PROMPT_MAX_LENGTH,
  DcaTemplateClient,
  normaliseRefactorProgress,
} from "../../lib/brightdata/dca";
import {
  BrightDataAuthError,
  BrightDataConfigError,
  BrightDataRateLimitError,
} from "../../lib/brightdata/errors";
import { BrightDataDemoHealer, buildDemoHealingPrompt } from "../../lib/demo-healing/healer";
import type { SentinelEvaluationResult } from "../../lib/sentinel/types";

interface Call {
  url: string;
  method: string;
  body: unknown;
  authorization: string | null;
}

/** A fetch double that records calls and replays scripted responses. */
function scriptedFetch(responses: (() => Response)[]) {
  const calls: Call[] = [];
  let index = 0;
  const fetchFn: typeof fetch = async (input, init) => {
    const request = new Request(input as RequestInfo, init);
    calls.push({
      url: request.url,
      method: request.method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      authorization: request.headers.get("authorization"),
    });
    const next = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    return next();
  };
  return { fetchFn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function client(responses: (() => Response)[]) {
  const { fetchFn, calls } = scriptedFetch(responses);
  return {
    calls,
    instance: new DcaTemplateClient({
      apiKey: "test-key",
      baseUrl: "https://api.brightdata.test",
      fetchFn,
    }),
  };
}

// ---------------------------------------------------------------------------
// Status vocabulary
// ---------------------------------------------------------------------------

test("dca: 'pending_answer' is the approval gate", () => {
  const progress = normaliseRefactorProgress({
    status: DCA_AWAITING_APPROVAL_STATUS,
    step: "step_preview_runner",
    completed_steps: ["planner", "code_fixer"],
    preview_result: [{ quote_text: "x", author: "y" }],
    diff: { template_b: { steps: [1, 2, 3] } },
  });

  assert.equal(progress.phase, "awaiting_approval");
  assert.equal(progress.rawStatus, "pending_answer");
  assert.equal(progress.previewResult!.length, 1);
  assert.equal(progress.diffSummary, "Proposed template has 3 extraction step(s).");
  assert.deepEqual(progress.completedSteps, ["planner", "code_fixer"]);
});

test("dca: terminal statuses map to done and failed", () => {
  assert.equal(normaliseRefactorProgress({ status: "done" }).phase, "done");
  assert.equal(normaliseRefactorProgress({ status: "success" }).phase, "done");
  for (const status of ["failed", "error", "cancelled"]) {
    assert.equal(normaliseRefactorProgress({ status }).phase, "failed", status);
  }
});

test("dca: an unrecognised status is treated as still running, never as success", () => {
  for (const status of ["", "queued", "user_intent_analyzer", "whatever"]) {
    assert.equal(normaliseRefactorProgress({ status }).phase, "running", status);
  }
  assert.equal(normaliseRefactorProgress(null).phase, "running");
  assert.equal(normaliseRefactorProgress({}).previewResult, null);
});

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

test("dca: a refactor is POSTed to the collector's refactor_template path", async () => {
  const { instance, calls } = client([() => json({ id: "ia-123" })]);

  const result = await instance.requestRefactor("c_demo_1", "re-derive the selectors");

  assert.equal(result.jobId, "ia-123");
  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.url, "https://api.brightdata.test/dca/collectors/c_demo_1/refactor_template");
  assert.equal(calls[0]!.authorization, "Bearer test-key");
  assert.deepEqual(calls[0]!.body, { prompt: "re-derive the selectors", custom_input: [] });
});

test("dca: a refactor binds to the failing input when one is supplied", async () => {
  const { instance, calls } = client([() => json({ id: "ia-124" })]);

  await instance.requestRefactor("c_demo_1", "the layout changed", [
    { url: "https://radar.test/demo-source/broken" },
  ]);

  // Without this the repair is generated against the template's stored input,
  // which is the layout that still works, so it never sees what broke.
  assert.deepEqual(calls[0]!.body, {
    prompt: "the layout changed",
    custom_input: [{ url: "https://radar.test/demo-source/broken" }],
  });
});

test("dca: an over-long prompt is truncated to the documented limit", async () => {
  const { instance, calls } = client([() => json({ id: "ia-1" })]);

  await instance.requestRefactor("c_demo_1", "x".repeat(DCA_PROMPT_MAX_LENGTH + 500));

  const body = calls[0]!.body as { prompt: string };
  assert.equal(body.prompt.length, DCA_PROMPT_MAX_LENGTH);
});

test("dca: the collector id is URL-encoded rather than interpolated raw", async () => {
  const { instance, calls } = client([() => json({ id: "ia-1" })]);

  await instance.requestRefactor("c demo/../other", "prompt");

  assert.ok(calls[0]!.url.includes("c%20demo%2F..%2Fother"));
  assert.ok(!calls[0]!.url.includes("/../"));
});

test("dca: approval sends message:true with auto_save so the template is committed", async () => {
  const { instance, calls } = client([() => json({})]);

  await instance.resumeRefactor("c_demo_1", true);

  assert.equal(calls[0]!.url, "https://api.brightdata.test/dca/collectors/c_demo_1/resume_automation_job");
  assert.deepEqual(calls[0]!.body, { message: true, auto_save: true });
});

test("dca: rejection sends message:false and never auto_save", async () => {
  const { instance, calls } = client([() => json({})]);

  await instance.resumeRefactor("c_demo_1", false);

  assert.deepEqual(calls[0]!.body, { message: false });
  assert.equal((calls[0]!.body as Record<string, unknown>).auto_save, undefined);
});

test("dca: HTTP faults become the shared Bright Data error taxonomy", async () => {
  const auth = client([() => new Response("nope", { status: 401 })]);
  await assert.rejects(() => auth.instance.getRefactorProgress("c_1"), BrightDataAuthError);

  const limited = client([() => new Response("slow down", { status: 429 })]);
  await assert.rejects(
    () => limited.instance.requestRefactor("c_1", "p"),
    BrightDataRateLimitError,
  );
});

test("dca: a missing API key fails before any network call", async () => {
  const { fetchFn, calls } = scriptedFetch([() => json({})]);
  const previous = process.env.BRIGHTDATA_API_KEY;
  delete process.env.BRIGHTDATA_API_KEY;
  try {
    const instance = new DcaTemplateClient({
      apiKey: "",
      baseUrl: "https://api.brightdata.test",
      fetchFn,
    });
    await assert.rejects(() => instance.requestRefactor("c_1", "p"), BrightDataConfigError);
    assert.equal(calls.length, 0, "no request may be made without a credential");
  } finally {
    if (previous !== undefined) process.env.BRIGHTDATA_API_KEY = previous;
  }
});

// ---------------------------------------------------------------------------
// Polling behaviour
// ---------------------------------------------------------------------------

function healerWith(responses: (() => Response)[]) {
  const { fetchFn, calls } = scriptedFetch(responses);
  return {
    calls,
    healer: new BrightDataDemoHealer({
      client: new DcaTemplateClient({
        apiKey: "test-key",
        baseUrl: "https://api.brightdata.test",
        fetchFn,
      }),
    }),
  };
}

const noSleep = { sleep: async () => undefined, pollIntervalMs: 0 };

test("healer: polls until Bright Data offers the gate, then stops", async () => {
  const { healer, calls } = healerWith([
    () => json({ status: "running", step: "planner" }),
    () => json({ status: "running", step: "code_fixer" }),
    () =>
      json({
        status: "pending_answer",
        preview_result: [{ quote_text: "a real quotation here", author: "Someone" }],
      }),
    () => json({ status: "done" }),
  ]);

  const outcome = await healer.waitForGate("c_1", noSleep);

  assert.equal(outcome.kind, "awaiting_approval");
  assert.equal(calls.length, 3, "polling stops at the gate rather than running on");
  if (outcome.kind === "awaiting_approval") assert.equal(outcome.previewRecords.length, 1);
});

test("healer: a single failed poll is not treated as a failed refactor", async () => {
  let call = 0;
  const { fetchFn } = scriptedFetch([
    () => {
      call += 1;
      if (call === 1) throw new Error("transient network blip");
      return json({ status: "pending_answer", preview_result: [] });
    },
  ]);
  const healer = new BrightDataDemoHealer({
    client: new DcaTemplateClient({ apiKey: "k", baseUrl: "https://x.test", fetchFn }),
  });

  const outcome = await healer.waitForGate("c_1", noSleep);
  assert.equal(outcome.kind, "awaiting_approval");
});

test("healer: a genuine failure status is reported, never mistaken for a gate", async () => {
  const { healer } = healerWith([() => json({ status: "failed" })]);

  const outcome = await healer.waitForGate("c_1", noSleep);

  assert.equal(outcome.kind, "failed");
  if (outcome.kind === "failed") assert.ok(outcome.error.includes("failed"));
});

test("healer: a refactor that never decides times out rather than hanging", async () => {
  let clock = 0;
  const { healer } = healerWith([() => json({ status: "running", step: "planner" })]);

  const outcome = await healer.waitForGate("c_1", {
    ...noSleep,
    timeoutMs: 50,
    now: () => (clock += 20),
  });

  assert.equal(outcome.kind, "timed_out");
  if (outcome.kind === "timed_out") assert.equal(outcome.lastStep, "planner");
});

test("healer: refuses to start a refactor with no collector or an empty prompt", async () => {
  const { healer, calls } = healerWith([() => json({ id: "ia-1" })]);

  await assert.rejects(() => healer.requestHeal({ collectorId: "  ", prompt: "p" }));
  await assert.rejects(() => healer.requestHeal({ collectorId: "c_1", prompt: "   " }));
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// The repair prompt
// ---------------------------------------------------------------------------

function evaluation(overrides: Partial<SentinelEvaluationResult>): SentinelEvaluationResult {
  return {
    status: "quarantined",
    isHealthy: false,
    shouldQuarantine: true,
    reasonCodes: [],
    summary: "",
    recordsSeen: 10,
    recordsValid: 0,
    recordsInvalid: 10,
    validRecords: [],
    invalidRecords: [],
    issues: [],
    ...overrides,
  } as SentinelEvaluationResult;
}

test("prompt: describes the symptom Sentinel observed, and the required shape", () => {
  const prompt = buildDemoHealingPrompt(
    evaluation({ reasonCodes: ["SCHEMA_VALIDATION_FAILURE"] }),
    { sourceUrl: "https://demo.test/page" },
  );

  assert.ok(prompt.includes("https://demo.test/page"));
  assert.ok(prompt.includes("missing required fields"));
  assert.ok(prompt.includes("quote_text"));
  assert.ok(prompt.includes("author"));
  assert.ok(prompt.includes("tags"));
  assert.ok(prompt.length <= DCA_PROMPT_MAX_LENGTH);
});

test("prompt: each failure mode produces its own description", () => {
  const zero = buildDemoHealingPrompt(evaluation({ reasonCodes: ["ZERO_RECORDS"] }), {
    sourceUrl: "https://demo.test/",
  });
  assert.ok(zero.includes("zero records"));

  const latch = buildDemoHealingPrompt(
    evaluation({ reasonCodes: ["SEMANTIC_INVARIANT_VIOLATION"] }),
    { sourceUrl: "https://demo.test/" },
  );
  assert.ok(latch.includes("identical"));

  // An unrecognised anomaly still produces a usable prompt rather than a blank.
  const unknown = buildDemoHealingPrompt(evaluation({ reasonCodes: [] }), {
    sourceUrl: "https://demo.test/",
  });
  assert.ok(unknown.includes("unknown anomaly"));
});

test("prompt: never asks for anything but the demo record shape", () => {
  const prompt = buildDemoHealingPrompt(evaluation({ reasonCodes: ["ZERO_RECORDS"] }), {
    sourceUrl: "https://demo.test/",
  });

  assert.ok(prompt.includes("Do not return page headings"));
  assert.ok(!prompt.toLowerCase().includes("pricing"));
});
