/**
 * Trusted capability history must not list an observation the contract now
 * refuses.
 *
 * Gemini 2.5 Flash-Lite's Spanish-page observation sat in its history as an
 * ordinary past state, reading as a period when the model genuinely lacked
 * vision and tool calling. The current facts were already correct; the history
 * beneath them still told the story the rule exists to prevent.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { getModelDetail } from "../../lib/explorer/read-model";
import { InMemoryModelExplorerReadPort } from "../../lib/explorer";
import {
  GOOGLE,
  GEMINI_CATALOG_SOURCE,
  GEMINI_25_FLASH,
  capability,
  explorerData,
  minutesAgo,
  now,
} from "./support/fixtures";

const BASE = "https://ai.google.dev/gemini-api/docs/models";

/** The locale-contaminated observation, exactly as it was admitted. */
const LOCALIZED = capability({
  id: "cap-localized",
  model_id: GEMINI_25_FLASH.id,
  provider_id: GOOGLE.id,
  source_id: GEMINI_CATALOG_SOURCE.id,
  api_model_id: "gemini-2.5-flash",
  supports_vision: false,
  supports_tool_calling: null,
  input_modalities: ["video", "audio"],
  output_modalities: [],
  raw: { source_url: `${BASE}/gemini-2.5-flash?hl=es-419` },
  observed_at: minutesAgo(200),
});

/** A genuine earlier state from the canonical page. */
const CANONICAL_EARLIER = capability({
  id: "cap-canonical-earlier",
  model_id: GEMINI_25_FLASH.id,
  provider_id: GOOGLE.id,
  source_id: GEMINI_CATALOG_SOURCE.id,
  api_model_id: "gemini-2.5-flash",
  supports_vision: true,
  supports_tool_calling: true,
  input_modalities: ["text", "image"],
  output_modalities: ["text"],
  raw: { source_url: `${BASE}/gemini-2.5-flash` },
  observed_at: minutesAgo(400),
});

function port() {
  const data = explorerData();
  return new InMemoryModelExplorerReadPort({
    ...data,
    capabilitySnapshots: [...data.capabilitySnapshots, CANONICAL_EARLIER, LOCALIZED],
  });
}

test("an inadmissible observation is withheld from trusted capability history", async () => {
  const detail = await getModelDetail(GEMINI_25_FLASH.id, { port: port(), now });
  assert.ok(detail);
  const ids = detail.capabilityHistory.map((entry) => entry.snapshotId);
  assert.equal(ids.includes("cap-localized"), false);
});

/** Only the inadmissible one goes: real history is not collateral damage. */
test("genuine historical observations remain in trusted capability history", async () => {
  const detail = await getModelDetail(GEMINI_25_FLASH.id, { port: port(), now });
  assert.ok(detail);
  const ids = detail.capabilityHistory.map((entry) => entry.snapshotId);
  assert.equal(ids.includes("cap-canonical-earlier"), true);
  assert.ok(detail.capabilityHistory.length > 0);
});

/**
 * Withheld from the projection, never removed from the source of truth: the
 * port still returns the row, which is what keeps the audit path intact.
 */
test("the inadmissible row is still available to the audit path", async () => {
  const rows = await port().listCapabilityHistory(GEMINI_25_FLASH.id);
  assert.ok(rows.some((row) => row.id === "cap-localized"));
});
