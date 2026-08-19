import test from "node:test";
import assert from "node:assert/strict";

import {
  handleAskGet,
  handleAskPost,
  type GroundedAskResult,
} from "../../lib/ask";
import { InMemoryModelExplorerReadPort } from "../../lib/explorer";
import { getDemoTemporalEvidence } from "../../lib/intelligence/demo-evidence";
import { explorerData, now } from "../explorer/support/fixtures";

const options = () => ({
  port: new InMemoryModelExplorerReadPort(explorerData()),
  now,
  referenceDate: "2026-08-19T12:00:00.000Z",
  loadTemporalEvidence: async () => getDemoTemporalEvidence(),
});

function request(url: string, init?: RequestInit): Request {
  return new Request(`https://radar.test${url}`, init);
}

test("API: GET /api/ask answers a temporal question", async () => {
  const response = await handleAskGet(
    request("/api/ask?q=" + encodeURIComponent("What changed in Claude this month?")),
    options(),
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as GroundedAskResult;
  assert.equal(body.interpretedIntent, "temporal_change_query");
  assert.equal(body.groundedness.isGrounded, true);
  assert.ok(body.provenance.length > 0);
});

test("API: POST /api/ask accepts query as an alias of question", async () => {
  const response = await handleAskPost(
    request("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "What is cheapest for 100M input and 20M output tokens?",
      }),
    }),
    options(),
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as GroundedAskResult;
  assert.equal(body.interpretedIntent, "workload_optimizer_query");
  if (body.structured.kind !== "workload_optimizer_query") {
    assert.fail("expected optimizer structured result");
  }
  assert.ok(body.structured.optimizer.winner?.displayName?.includes("Flash"));
});

test("API: POST /api/ask rejects non-JSON bodies", async () => {
  const response = await handleAskPost(
    request("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    }),
    options(),
  );
  assert.equal(response.status, 400);
});
