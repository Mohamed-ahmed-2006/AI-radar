/**
 * The trusted Change Feed must not present a claim whose only backing is an
 * observation the source contract would refuse today.
 *
 * Gemini 2.5 Flash-Lite was collected once from a Spanish rendering of its page
 * (`?hl=es-419`), and that admission produced four events saying the model had
 * lost vision, tool calling and half its input modalities. The observation is
 * inadmissible now, so the events it produced are excluded at read time — while
 * the rows stay in `change_events` for audit.
 *
 * The rule is narrow on purpose: it tests the *producing observation*, never the
 * shape of the change. A provider genuinely turning a capability off keeps its
 * event, because that event is backed by an admissible observation.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { withoutSupersededCapabilityEvidence } from "../../lib/intelligence/read-model";
import type { ChangeEventRow, SupabaseServerClient } from "../../lib/supabase";

const BASE = "https://ai.google.dev/gemini-api/docs/models";

/** The snapshot rows the filter resolves provenance from. */
const SNAPSHOTS = [
  { id: "snap-localized", raw: { source_url: `${BASE}/gemini-2.5-flash-lite?hl=es-419` } },
  { id: "snap-canonical", raw: { source_url: `${BASE}/gemini-2.5-flash-lite` } },
  { id: "snap-reversal", raw: { source_url: `${BASE}/gemini-3.7-flash` } },
];

function fakeDb(): SupabaseServerClient {
  return {
    from() {
      const api = {
        select: () => api,
        in: (_column: string, ids: string[]) =>
          Promise.resolve({
            data: SNAPSHOTS.filter((row) => ids.includes(row.id)),
            error: null,
          }),
      };
      return api;
    },
  } as unknown as SupabaseServerClient;
}

function event(id: string, snapshotId: string | null, field: string): ChangeEventRow {
  return {
    id,
    provider_id: "prov-gemini",
    source_id: "src-gemini-catalog",
    run_id: "run-1",
    model_id: "model-1",
    change_type: "capability_changed",
    field_name: field,
    pricing_mode: null,
    context_tier: null,
    old_value: null,
    new_value: null,
    previous_snapshot_id: null,
    current_snapshot_id: null,
    previous_lifecycle_snapshot_id: null,
    current_lifecycle_snapshot_id: null,
    previous_capability_snapshot_id: null,
    current_capability_snapshot_id: snapshotId,
    summary: null,
    detected_at: "2026-08-21T11:34:31.000Z",
    created_at: "2026-08-21T11:34:31.000Z",
  };
}

test("an event produced by a localized capability observation is excluded", async () => {
  const rows = [event("bad-vision", "snap-localized", "supportsVision")];
  const kept = await withoutSupersededCapabilityEvidence(fakeDb(), rows);
  assert.deepEqual(kept, []);
});

test("an event produced by a canonical observation is kept", async () => {
  const rows = [event("good-vision", "snap-canonical", "supportsVision")];
  const kept = await withoutSupersededCapabilityEvidence(fakeDb(), rows);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].id, "good-vision");
});

/**
 * The distinction the rule exists to preserve: a later reversal backed by a
 * valid observation is real intelligence and must survive, even though it has
 * exactly the shape a "hide anything reversed" rule would suppress.
 */
test("a genuine later reversal survives when its observation is admissible", async () => {
  const rows = [
    event("bad-vision", "snap-localized", "supportsVision"),
    event("correction", "snap-canonical", "supportsVision"),
    event("real-reversal", "snap-reversal", "supportsVision"),
  ];
  const kept = await withoutSupersededCapabilityEvidence(fakeDb(), rows);
  assert.deepEqual(
    kept.map((row) => row.id),
    ["correction", "real-reversal"],
  );
});

test("events with no capability provenance are never filtered", async () => {
  const rows = [event("pricing-event", null, "inputPricePer1MTokens")];
  const kept = await withoutSupersededCapabilityEvidence(fakeDb(), rows);
  assert.equal(kept.length, 1);
});

/** The filter narrows the feed; it must never be the reason the feed is empty. */
test("an unreadable snapshot read leaves the feed exactly as it was", async () => {
  const failing = {
    from: () => ({
      select: () => ({ in: () => Promise.resolve({ data: null, error: { message: "denied" } }) }),
    }),
  } as unknown as SupabaseServerClient;
  const rows = [event("bad-vision", "snap-localized", "supportsVision")];
  assert.equal((await withoutSupersededCapabilityEvidence(failing, rows)).length, 1);
});
