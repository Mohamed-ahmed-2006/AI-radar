import test from "node:test";
import assert from "node:assert/strict";

import { InMemoryModelExplorerReadPort } from "../../lib/explorer";
import {
  handleStackOptimizerGet,
  handleStackOptimizerPost,
  parseOptimizerParams,
  type StackOptimizerResult,
} from "../../lib/optimizer";
import { GEMINI_25_FLASH, explorerData, now } from "../explorer/support/fixtures";

const options = () => ({
  port: new InMemoryModelExplorerReadPort(explorerData()),
  now,
});

function request(url: string, init?: RequestInit): Request {
  return new Request(`https://radar.test${url}`, init);
}

test("API: GET /api/optimizer ranks a stated workload", async () => {
  const response = await handleStackOptimizerGet(
    request("/api/optimizer?inputTokens=100000000&outputTokens=20000000&activeOnly=true"),
    options(),
  );
  assert.equal(response.status, 200);

  const body = (await response.json()) as StackOptimizerResult;
  assert.equal(body.winner?.canonicalModelId, GEMINI_25_FLASH.id);
  assert.equal(body.winner?.cost.totalMonthlyCost, 80);
  assert.equal(body.request.workload.monthlyInputTokens, 100_000_000);
  assert.ok(body.provenance.length > 0);
});

test("API: query aliases used by the product seam are accepted", async () => {
  const parsed = parseOptimizerParams(
    new URLSearchParams(
      "inTokens=10000000&outTokens=1000000&minContext=128000&minMaxOutput=8192" +
        "&vision=1&tools=1&providers=openai,anthropic&active=1&priority=lowest_monthly_cost",
    ),
  ) as {
    workload: { monthlyInputTokens: number; monthlyOutputTokens: number };
    minContextWindow: number;
    visionRequired: boolean;
    toolCallingRequired: boolean;
    providers: string[];
    activeOnly: boolean;
    priority: string;
  };

  assert.equal(parsed.workload.monthlyInputTokens, 10_000_000);
  assert.equal(parsed.workload.monthlyOutputTokens, 1_000_000);
  assert.equal(parsed.minContextWindow, 128_000);
  assert.equal(parsed.visionRequired, true);
  assert.equal(parsed.toolCallingRequired, true);
  assert.deepEqual(parsed.providers, ["openai", "anthropic"]);
  assert.equal(parsed.activeOnly, true);
  assert.equal(parsed.priority, "lowest_total_cost");
});

test("API: POST /api/optimizer accepts the closed JSON schema", async () => {
  const response = await handleStackOptimizerPost(
    request("/api/optimizer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workload: { monthlyInputTokens: 100_000_000, monthlyOutputTokens: 20_000_000 },
        visionRequired: true,
        activeOnly: true,
      }),
    }),
    options(),
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as StackOptimizerResult;
  assert.equal(body.winner?.canonicalModelId, GEMINI_25_FLASH.id);
});

test("API: a malformed optimizer request is 400, never guessed at", async () => {
  const response = await handleStackOptimizerPost(
    request("/api/optimizer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workload: { monthlyInputTokens: -1, monthlyOutputTokens: 1 } }),
    }),
    options(),
  );
  assert.equal(response.status, 400);

  const invalidJson = await handleStackOptimizerPost(
    request("/api/optimizer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    }),
    options(),
  );
  assert.equal(invalidJson.status, 400);
});
