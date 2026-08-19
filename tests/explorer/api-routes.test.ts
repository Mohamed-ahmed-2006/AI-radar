import test from "node:test";
import assert from "node:assert/strict";

import {
  InMemoryModelExplorerReadPort,
  handleModelCompareRequest,
  handleModelDetailRequest,
  handleModelExplorerRequest,
  parseExplorerFilters,
  type ModelComparison,
  type ModelDetail,
  type ModelExplorerReadPort,
  type ModelExplorerResult,
} from "../../lib/explorer";
import {
  CLAUDE_SONNET_5,
  GEMINI_25_FLASH,
  GPT_5,
  GROK_4,
  explorerData,
  now,
} from "./support/fixtures";

const options = () => ({
  port: new InMemoryModelExplorerReadPort(explorerData()),
  now,
});

function request(url: string): Request {
  return new Request(`https://radar.test${url}`);
}

test("API: the explorer endpoint returns every model with its evidence", async () => {
  const response = await handleModelExplorerRequest(request("/api/models"), options());
  assert.equal(response.status, 200);

  const body = (await response.json()) as ModelExplorerResult;
  assert.equal(body.totalCount, 8);
  assert.equal(body.entries.length, 8);
  assert.equal(body.generatedAt, "2026-08-19T12:00:00.000Z");
  assert.ok(body.facets.providers.length > 0);
});

test("API: filters arrive from the query string, comma or repeated", async () => {
  const filters = parseExplorerFilters(
    new URLSearchParams(
      "provider=openai,anthropic&provider=xai&maxInputPrice=3&minContext=200000" +
        "&visionRequired=true&activeOnly=true&lifecycleState=active&stage=stable&q=claude",
    ),
  );

  assert.deepEqual(filters.providers, ["openai", "anthropic", "xai"]);
  assert.equal(filters.maxInputPrice, 3);
  assert.equal(filters.minContextWindow, 200_000);
  assert.equal(filters.visionRequired, true);
  assert.equal(filters.activeOnly, true);
  assert.deepEqual(filters.lifecycleStates, ["active"]);
  assert.deepEqual(filters.stages, ["stable"]);
  assert.equal(filters.search, "claude");
});

test("API: an unparseable or unknown filter value is ignored, never guessed at", async () => {
  const filters = parseExplorerFilters(
    new URLSearchParams(
      "maxInputPrice=cheap&minContext=-5&visionRequired=maybe&lifecycleState=zombie&sort=nonsense",
    ),
  );

  assert.equal(filters.maxInputPrice, undefined);
  assert.equal(filters.minContextWindow, undefined);
  assert.equal(filters.visionRequired, undefined);
  assert.equal(filters.lifecycleStates, undefined);

  const response = await handleModelExplorerRequest(
    request("/api/models?sort=nonsense"),
    options(),
  );
  assert.equal(response.status, 200);
});

test("API: the explorer endpoint applies filters deterministically", async () => {
  const response = await handleModelExplorerRequest(
    request("/api/models?visionRequired=true&maxInputPrice=2&activeOnly=true"),
    options(),
  );
  const body = (await response.json()) as ModelExplorerResult;

  assert.deepEqual(
    body.entries.map((entry) => entry.canonicalModelId),
    [GEMINI_25_FLASH.id, GPT_5.id],
  );
  assert.equal(body.filteredCount, 2);
  assert.equal(body.totalCount, 8);
});

test("API: the detail endpoint answers 404 for an unknown canonical id", async () => {
  const response = await handleModelDetailRequest(
    request("/api/models/model-missing"),
    "model-missing",
    options(),
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Model not found" });
});

test("API: the detail endpoint returns current evidence with history", async () => {
  const response = await handleModelDetailRequest(
    request("/api/models/model-gpt-5?history=2&changes=5"),
    GPT_5.id,
    options(),
  );
  assert.equal(response.status, 200);

  const body = (await response.json()) as ModelDetail;
  assert.equal(body.current.canonicalModelId, GPT_5.id);
  assert.equal(body.pricingHistory.length, 2);
  assert.equal(body.recentChanges.length, 1);
  assert.deepEqual(body.apiModelIds, ["gpt-5", "gpt-5-2026-01-15"]);
});

test("API: the compare endpoint needs at least two canonical ids", async () => {
  const none = await handleModelCompareRequest(request("/api/models/compare"), options());
  assert.equal(none.status, 400);

  const one = await handleModelCompareRequest(
    request(`/api/models/compare?ids=${GPT_5.id}`),
    options(),
  );
  assert.equal(one.status, 400);
});

test("API: the compare endpoint refuses more models than it will align", async () => {
  const ids = Array.from({ length: 9 }, (_, index) => `model-${index}`).join(",");
  const response = await handleModelCompareRequest(
    request(`/api/models/compare?ids=${ids}`),
    options(),
  );

  assert.equal(response.status, 400);
});

test("API: the compare endpoint aligns the requested canonical models", async () => {
  const response = await handleModelCompareRequest(
    request(`/api/models/compare?ids=${GPT_5.id},${CLAUDE_SONNET_5.id},${GROK_4.id}`),
    options(),
  );
  assert.equal(response.status, 200);

  const body = (await response.json()) as ModelComparison;
  assert.deepEqual(
    body.models.map((entry) => entry.canonicalModelId),
    [GPT_5.id, CLAUDE_SONNET_5.id, GROK_4.id],
  );
  assert.ok(body.rows.every((row) => row.cells.length === 3));
  assert.deepEqual(body.unresolvedIds, []);
});

test("API: an upstream failure never leaks its message to the caller", async () => {
  const brokenPort = new Proxy({} as ModelExplorerReadPort, {
    get() {
      return async () => {
        throw new Error("connection string postgres://user:secret@host/db failed");
      };
    },
  });

  for (const response of [
    await handleModelExplorerRequest(request("/api/models"), { port: brokenPort, now }),
    await handleModelDetailRequest(request("/api/models/x"), GPT_5.id, {
      port: brokenPort,
      now,
    }),
    await handleModelCompareRequest(
      request(`/api/models/compare?ids=${GPT_5.id},${GROK_4.id}`),
      { port: brokenPort, now },
    ),
  ]) {
    assert.equal(response.status, 500);
    const body = (await response.json()) as { error: string };
    assert.ok(!body.error.includes("secret"));
    assert.ok(!body.error.includes("postgres"));
  }
});
