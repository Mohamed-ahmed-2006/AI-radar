import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchOpenAIPricing,
  BrightDataClient,
  DEFAULT_OPENAI_COLLECTOR_ID,
  DEFAULT_OPENAI_PRICING_SOURCE_URL,
} from "../../lib/brightdata";
import fixtureData from "./fixtures/openai-pricing-fixture.json" with { type: "json" };

test("fetchOpenAIPricing runs collector with default parameters and parses verified fixture", async () => {
  let passedCollectorId = "";
  let passedBody = "";

  const mockFetch: typeof fetch = async (input, init) => {
    const url = input.toString();
    if (url.includes("/dca/trigger")) {
      const parsedUrl = new URL(url);
      passedCollectorId = parsedUrl.searchParams.get("collector") || "";
      passedBody = init?.body ? init.body.toString() : "";
      return new Response(JSON.stringify({ collection_id: "j_openai_run_999" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/dca/dataset")) {
      return new Response(JSON.stringify(fixtureData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("Not found", { status: 404 });
  };

  const client = new BrightDataClient({
    apiKey: "dummy-key",
    fetchFn: mockFetch,
  });

  const result = await fetchOpenAIPricing({
    client,
    pollIntervalMs: 10,
    pollTimeoutMs: 1000,
  });

  assert.equal(result.success, true);
  assert.equal(passedCollectorId, DEFAULT_OPENAI_COLLECTOR_ID);
  assert.deepEqual(JSON.parse(passedBody), [{ url: DEFAULT_OPENAI_PRICING_SOURCE_URL }]);
  assert.equal(result.data.length, 3);
  assert.equal(result.data[0].model_name, "gpt-5.6-sol");
  assert.equal(result.metadata.resultCount, 3);
  assert.equal(result.metadata.status, "success");
});

test("fetchOpenAIPricing respects custom overrides for collectorId and sourceUrl", async () => {
  let passedCollectorId = "";
  let passedBody = "";

  const mockFetch: typeof fetch = async (input, init) => {
    const url = input.toString();
    if (url.includes("/dca/trigger")) {
      const parsedUrl = new URL(url);
      passedCollectorId = parsedUrl.searchParams.get("collector") || "";
      passedBody = init?.body ? init.body.toString() : "";
      return new Response(JSON.stringify({ collection_id: "j_custom_run" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/dca/dataset")) {
      return new Response(JSON.stringify(fixtureData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("Not found", { status: 404 });
  };

  const client = new BrightDataClient({
    apiKey: "dummy-key",
    fetchFn: mockFetch,
  });

  const customCollector = "c_custom_collector_x";
  const customUrl = "https://custom.openai.com/pricing";

  const result = await fetchOpenAIPricing({
    client,
    collectorId: customCollector,
    sourceUrl: customUrl,
    pollIntervalMs: 10,
    pollTimeoutMs: 1000,
  });

  assert.equal(result.success, true);
  assert.equal(passedCollectorId, customCollector);
  assert.deepEqual(JSON.parse(passedBody), [{ url: customUrl }]);
});
