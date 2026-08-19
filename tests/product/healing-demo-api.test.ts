import test from "node:test";
import assert from "node:assert/strict";

import { GET, POST } from "../../app/api/demo/healing/route";
import { registerHealingDemoBackend } from "../../lib/healing-demo/backend";
import { setHealingDemoAdapter } from "../../lib/product/healing-demo";
import { createFixtureHealingDemoAdapter } from "../../lib/product/healing-demo-fixture";
import { createCanonicalHealingDemoAdapter } from "../../lib/product/healing-demo-read-model";

test.afterEach(() => {
  setHealingDemoAdapter(null);
  registerHealingDemoBackend(null);
});

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
    new Request("https://radar.test/api/demo/healing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "delete_collector", collectorId: "c_evil" }),
    }),
  );
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: string };
  assert.match(body.error, /allowlist/i);
});

test("POST ignores URL, collector and source targeting fields", async () => {
  setHealingDemoAdapter(createFixtureHealingDemoAdapter("healthy"));
  const response = await POST(
    new Request("https://radar.test/api/demo/healing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "trigger_failure",
        collectorId: "c_production",
        sourceUrl: "https://evil.example/pricing",
        sourceId: "src-openai-pricing",
      }),
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
  const blocked = await POST(
    new Request("https://radar.test/api/demo/healing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve_preview" }),
    }),
  );
  const blockedBody = (await blocked.json()) as { phase: string };
  assert.equal(blockedBody.phase, "preview_failed");

  setHealingDemoAdapter(createFixtureHealingDemoAdapter("preview_validated"));
  const allowed = await POST(
    new Request("https://radar.test/api/demo/healing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve_preview" }),
    }),
  );
  const allowedBody = (await allowed.json()) as { phase: string };
  assert.equal(allowedBody.phase, "approved");
});
