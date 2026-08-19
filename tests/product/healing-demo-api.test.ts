import test from "node:test";
import assert from "node:assert/strict";

import { GET, POST } from "../../app/api/demo/healing/route";
import { registerHealingDemoBackend } from "../../lib/healing-demo/backend";
import { setHealingDemoAdapter } from "../../lib/product/healing-demo";
import { createFixtureHealingDemoAdapter } from "../../lib/product/healing-demo-fixture";
import { createCanonicalHealingDemoAdapter } from "../../lib/product/healing-demo-read-model";
import {
  issueOperatorSessionToken,
  OPERATOR_SESSION_COOKIE,
} from "../../lib/orchestration/operator-session";
import { resetRateLimits, RATE_LIMIT_POLICIES } from "../../lib/rate-limit";

const OPERATOR_SECRET = "test-operator-secret";

// Mutating demo steps drive a real collector and a real Scraper Studio
// refactor, so the route requires the operator credential. Configuring one here
// is what makes the 401 test below prove a *rejected* credential rather than an
// endpoint that is merely unconfigured.
process.env.AI_RADAR_INGEST_SECRET = OPERATOR_SECRET;
delete process.env.CRON_SECRET;

test.afterEach(() => {
  setHealingDemoAdapter(null);
  registerHealingDemoBackend(null);
  delete process.env.AI_RADAR_HEALING_DEMO_OPEN_CONTROLS;
});

/** A POST carrying the operator credential. */
function operatorPost(body: unknown): Request {
  return new Request("https://radar.test/api/demo/healing", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ai-radar-ingest-secret": OPERATOR_SECRET,
    },
    body: JSON.stringify(body),
  });
}

/** A POST from a caller with no credential at all. */
function anonymousPost(body: unknown): Request {
  return new Request("https://radar.test/api/demo/healing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("GET /api/demo/healing returns unavailable without installing the fixture", async () => {
  setHealingDemoAdapter(createCanonicalHealingDemoAdapter({ port: null }));
  const response = await GET();
  assert.equal(response.status, 200);
  const body = (await response.json()) as { available: boolean; isFixture: boolean; unavailableTitle: string };
  assert.equal(body.available, false);
  assert.equal(body.isFixture, false);
  assert.equal(body.unavailableTitle, "Real healing demo unavailable");
});

test("POST /api/demo/healing rejects actions outside the allowlist", async () => {
  setHealingDemoAdapter(createFixtureHealingDemoAdapter("healthy"));
  const response = await POST(
    operatorPost({ action: "delete_collector", collectorId: "c_evil" }),
  );
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: string };
  assert.match(body.error, /allowlist/i);
});

test("POST ignores URL, collector and source targeting fields", async () => {
  setHealingDemoAdapter(createFixtureHealingDemoAdapter("healthy"));
  const response = await POST(
    operatorPost({
      action: "trigger_failure",
      collectorId: "c_production",
      sourceUrl: "https://evil.example/pricing",
      sourceId: "src-openai-pricing",
    }),
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    phase: string;
    identity: { sourceId: string };
    brightData: { collectorId: string };
  };
  assert.equal(body.phase, "break");
  assert.equal(body.identity.sourceId, "src-healing-demo-isolated");
  assert.equal(body.brightData.collectorId, "c_healing_demo_studio");
});

test("POST approve_preview is a no-op until the preview is valid", async () => {
  setHealingDemoAdapter(createFixtureHealingDemoAdapter("preview_failed"));
  const blocked = await POST(operatorPost({ action: "approve_preview" }));
  const blockedBody = (await blocked.json()) as { phase: string };
  assert.equal(blockedBody.phase, "preview_failed");

  setHealingDemoAdapter(createFixtureHealingDemoAdapter("preview_validated"));
  const allowed = await POST(operatorPost({ action: "approve_preview" }));
  const allowedBody = (await allowed.json()) as { phase: string };
  assert.equal(allowedBody.phase, "approved");
});

test("POST is closed to an unauthenticated caller", async () => {
  setHealingDemoAdapter(createFixtureHealingDemoAdapter("healthy"));
  const response = await POST(anonymousPost({ action: "trigger_failure" }));

  assert.equal(response.status, 401);
  assert.match(((await response.json()) as { error: string }).error, /operator credential/i);
});

test("POST is closed to a wrong credential", async () => {
  setHealingDemoAdapter(createFixtureHealingDemoAdapter("healthy"));
  const response = await POST(
    new Request("https://radar.test/api/demo/healing", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ai-radar-ingest-secret": "not-the-secret",
      },
      body: JSON.stringify({ action: "trigger_failure" }),
    }),
  );

  assert.equal(response.status, 401);
});

test("POST opens to anyone only under the explicit server-side opt-in", async () => {
  process.env.AI_RADAR_HEALING_DEMO_OPEN_CONTROLS = "1";
  setHealingDemoAdapter(createFixtureHealingDemoAdapter("healthy"));

  const response = await POST(anonymousPost({ action: "trigger_failure" }));

  assert.equal(response.status, 200);
  // The opt-in relaxes who may press the button, never what the button can do.
  const body = (await response.json()) as {
    phase: string;
    brightData: { collectorId: string };
  };
  assert.equal(body.phase, "break");
  assert.equal(body.brightData.collectorId, "c_healing_demo_studio");
});

test("the allowlist still holds under the open-controls opt-in", async () => {
  process.env.AI_RADAR_HEALING_DEMO_OPEN_CONTROLS = "1";
  setHealingDemoAdapter(createFixtureHealingDemoAdapter("healthy"));

  const response = await POST(
    anonymousPost({ action: "delete_collector", collectorId: "c_evil" }),
  );

  assert.equal(response.status, 400);
});

test("an operator session unlocks the controls without the open-controls flag", async () => {
  // The property the public deployment depends on: a browser holding only a
  // cookie — no header secret, no AI_RADAR_HEALING_DEMO_OPEN_CONTROLS — can
  // drive the demo, and an anonymous visitor still cannot.
  assert.equal(process.env.AI_RADAR_HEALING_DEMO_OPEN_CONTROLS, undefined);
  setHealingDemoAdapter(createFixtureHealingDemoAdapter("healthy"));
  resetRateLimits();

  const token = issueOperatorSessionToken(OPERATOR_SECRET);
  assert.ok(token, "the ingest secret must be able to open a session");

  const response = await POST(
    new Request("https://radar.test/api/demo/healing", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${OPERATOR_SESSION_COOKIE}=${encodeURIComponent(token)}`,
        // A distinct address so this case owns its own rate-limit budget.
        "x-forwarded-for": "198.51.100.10",
      },
      body: JSON.stringify({ action: "trigger_failure" }),
    }),
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as { phase: string };
  assert.equal(body.phase, "break");
});

test("an anonymous caller is told an unlock exists, never what the credential is", async () => {
  setHealingDemoAdapter(createFixtureHealingDemoAdapter("healthy"));
  resetRateLimits();

  const response = await POST(anonymousPost({ action: "trigger_failure" }));

  assert.equal(response.status, 401);
  const body = (await response.json()) as { error: string; unlockAvailable: boolean };
  assert.equal(body.unlockAvailable, true);
  assert.equal(JSON.stringify(body).includes(OPERATOR_SECRET), false);
});

test("steps that spend Bright Data quota are rate limited even for an operator", async () => {
  setHealingDemoAdapter(createFixtureHealingDemoAdapter("healthy"));
  resetRateLimits();

  const limit = RATE_LIMIT_POLICIES.healingDemoExpensive.limit;
  const attempt = () =>
    POST(
      new Request("https://radar.test/api/demo/healing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ai-radar-ingest-secret": OPERATOR_SECRET,
          "x-forwarded-for": "198.51.100.20",
        },
        body: JSON.stringify({ action: "establish_baseline" }),
      }),
    );

  for (let index = 0; index < limit; index += 1) {
    const allowed = await attempt();
    assert.notEqual(allowed.status, 429, `attempt ${index + 1} should be permitted`);
  }

  const refused = await attempt();
  assert.equal(refused.status, 429);
  assert.ok(Number(refused.headers.get("retry-after")) > 0);

  // A cheap action is on its own budget and is unaffected.
  const cheap = await POST(
    new Request("https://radar.test/api/demo/healing", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ai-radar-ingest-secret": OPERATOR_SECRET,
        "x-forwarded-for": "198.51.100.20",
      },
      body: JSON.stringify({ action: "trigger_failure" }),
    }),
  );
  assert.notEqual(cheap.status, 429);
});
