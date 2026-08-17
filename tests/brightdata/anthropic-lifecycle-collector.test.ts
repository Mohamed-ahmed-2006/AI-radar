import assert from "node:assert/strict";
import test from "node:test";

import {
  BrightDataClient,
  DEFAULT_ANTHROPIC_LIFECYCLE_COLLECTOR_ID,
  DEFAULT_ANTHROPIC_LIFECYCLE_SOURCE_URL,
  fetchAnthropicLifecycle,
} from "../../lib/brightdata";
import fixture from "./fixtures/anthropic-lifecycle-fixture.json" with { type: "json" };

test("runs the Anthropic lifecycle collector with its authoritative source", async () => {
  let collectorId = "";
  let triggerBody = "";
  const client = new BrightDataClient({
    apiKey: "dummy-key",
    fetchFn: async (input, init) => {
      const url = new URL(input.toString());
      if (url.pathname.includes("/dca/trigger")) {
        collectorId = url.searchParams.get("collector") ?? "";
        triggerBody = init?.body?.toString() ?? "";
        return new Response(JSON.stringify({ collection_id: "j_anthropic_lifecycle" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  const result = await fetchAnthropicLifecycle({ client, pollIntervalMs: 1, pollTimeoutMs: 100 });
  assert.equal(result.success, true);
  assert.equal(collectorId, DEFAULT_ANTHROPIC_LIFECYCLE_COLLECTOR_ID);
  assert.deepEqual(JSON.parse(triggerBody), [{ url: DEFAULT_ANTHROPIC_LIFECYCLE_SOURCE_URL }]);
  assert.equal(result.data.length, fixture.length);
});
