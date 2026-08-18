import assert from "node:assert/strict";
import test from "node:test";

import {
  BrightDataClient,
  DEFAULT_GEMINI_LIFECYCLE_COLLECTOR_ID,
  DEFAULT_GEMINI_LIFECYCLE_SOURCE_URL,
  fetchGeminiLifecycle,
} from "../../lib/brightdata";
import fixture from "./fixtures/gemini-lifecycle-fixture.json" with { type: "json" };

test("runs the Gemini lifecycle collector with its authoritative source", async () => {
  let triggerBody: unknown;
  const client = new BrightDataClient({
    apiKey: "test",
    fetchFn: async (input, init) => {
      const url = String(input);
      if (url.includes("/dca/trigger")) {
        assert.match(url, new RegExp(`collector=${DEFAULT_GEMINI_LIFECYCLE_COLLECTOR_ID}`));
        triggerBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ collection_id: "j_gemini_lifecycle" }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify(fixture), { status: 200 });
    },
  });

  const result = await fetchGeminiLifecycle({ client, pollIntervalMs: 1, pollTimeoutMs: 100 });
  assert.equal(result.success, true);
  assert.deepEqual(triggerBody, [{ url: DEFAULT_GEMINI_LIFECYCLE_SOURCE_URL }]);
  assert.equal(result.data.length, fixture.length);
});
