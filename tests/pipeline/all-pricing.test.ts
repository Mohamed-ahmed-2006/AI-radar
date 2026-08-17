import assert from "node:assert/strict";
import test from "node:test";

import { ingestAllPricing, type ProviderIngestor } from "../../lib/pipeline";

const successfulIngestor: ProviderIngestor = async () => ({
  success: true, collectionRunId: "run-1", externalRunId: "bright-1",
  acceptedCount: 2, rejectedCount: 0, changesDetected: 1, durationMs: 10, idempotent: false,
});

test("multi-provider dispatch retains successful results when one provider fails", async () => {
  const summaries = await ingestAllPricing({
    ingestors: {
      openai: successfulIngestor,
      anthropic: async () => { throw new Error("collector unavailable"); },
      gemini: successfulIngestor,
      xai: successfulIngestor,
    },
  });
  assert.equal(summaries.length, 4);
  assert.deepEqual(summaries.map((summary) => summary.success), [true, false, true, true]);
  assert.equal(summaries[1]?.error, "ingestion_failed");
  assert.equal(summaries[2]?.acceptedCount, 2);
});
