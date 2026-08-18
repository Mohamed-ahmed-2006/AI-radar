import test from "node:test";
import assert from "node:assert/strict";

import {
  InMemorySourceReadPort,
  getProvenance,
  parseProvenanceReference,
} from "../../lib/sources";
import {
  ANTHROPIC_PROVIDER,
  CLAUDE_MODEL,
  LIFECYCLE_SOURCE,
  PRICING_SOURCE,
  changeEvent,
  healthySourceData,
  incident,
  lifecycleSnapshot,
  minutesAgo,
  run,
  sentinelHealth,
} from "./support/fixtures";

test("Provenance: a price resolves to provider, source, collector, run and trust state", async () => {
  const port = new InMemorySourceReadPort(healthySourceData());

  const record = await getProvenance(
    { kind: "pricing_snapshot", id: "snap-new" },
    { port },
  );
  assert.ok(record);

  assert.equal(record.provider.slug, "openai");
  assert.equal(record.provider.name, "OpenAI");
  assert.equal(record.source?.id, PRICING_SOURCE.id);
  assert.equal(record.source?.url, PRICING_SOURCE.source_url);
  assert.equal(record.source?.collectorId, "c_openai_pricing");
  assert.equal(record.source?.category, "pricing");
  assert.equal(record.snapshotId, "snap-new");
  assert.equal(record.observedAt, minutesAgo(60));
  assert.equal(record.run?.runId, "run-latest");
  assert.equal(record.run?.externalRunId, "bd_run-latest");
  assert.equal(record.run?.status, "succeeded");
  assert.equal(record.trust.validationState, "validated");
  assert.equal(record.trust.authorityDomain, "pricing");
  assert.equal(record.trust.isAuthoritative, false);
  assert.equal(record.trust.sentinelStatus, "healthy");
});

test("Provenance: a lifecycle assertion resolves to its authoritative source", async () => {
  const port = new InMemorySourceReadPort({
    sources: [LIFECYCLE_SOURCE],
    providers: [ANTHROPIC_PROVIDER],
    models: [CLAUDE_MODEL],
    runs: [run({ id: "run-lc", source_id: LIFECYCLE_SOURCE.id, started_at: minutesAgo(90) })],
    lifecycleSnapshots: [lifecycleSnapshot({ id: "lc-1", run_id: "run-lc" })],
    sentinelHealth: [
      sentinelHealth({
        source_id: LIFECYCLE_SOURCE.id,
        provider_id: ANTHROPIC_PROVIDER.id,
        provider_slug: "anthropic",
        kind: "models",
        sentinel_health_status: "healthy",
      }),
    ],
  });

  const record = await getProvenance(
    { kind: "lifecycle_snapshot", id: "lc-1" },
    { port },
  );

  assert.equal(record?.source?.category, "lifecycle");
  assert.equal(record?.trust.authorityDomain, "lifecycle");
  assert.equal(record?.trust.isAuthoritative, true);
  assert.equal(record?.trust.validationState, "validated");
  assert.equal(record?.source?.collectorId, "c_anthropic_lifecycle");
  assert.equal(record?.observedAt, minutesAgo(90));
});

test("Provenance: a temporal change event carries the snapshots the diff was taken between", async () => {
  const port = new InMemorySourceReadPort(healthySourceData());

  const record = await getProvenance({ kind: "change_event", id: "evt-price" }, { port });
  assert.ok(record);

  assert.equal(record.reference.kind, "change_event");
  assert.equal(record.source?.id, PRICING_SOURCE.id);
  assert.equal(record.snapshotId, "snap-new");
  assert.deepEqual(record.transition, {
    previousSnapshotId: "snap-old",
    currentSnapshotId: "snap-new",
  });
  // Observed time is the observation instant, not the detection instant.
  assert.equal(record.observedAt, minutesAgo(60));
  assert.equal(record.run?.externalRunId, "bd_run-latest");
});

test("Provenance: evidence from a run Sentinel is holding open reads as quarantined", async () => {
  const data = healthySourceData();
  const port = new InMemorySourceReadPort({
    ...data,
    runs: [
      run({
        id: "run-bad",
        source_id: PRICING_SOURCE.id,
        started_at: minutesAgo(20),
        status: "partial",
        records_rejected: 4,
      }),
      ...(data.runs ?? []),
    ],
    pricingSnapshots: [
      ...(data.pricingSnapshots ?? []),
      {
        ...(data.pricingSnapshots ?? [])[0]!,
        id: "snap-suspect",
        run_id: "run-bad",
        observed_at: minutesAgo(20),
        content_hash: "hash-suspect",
      },
    ],
    incidents: [
      incident({
        id: "inc-1",
        source_id: PRICING_SOURCE.id,
        run_id: "run-bad",
        status: "open",
      }),
    ],
    sentinelHealth: [
      sentinelHealth({
        source_id: PRICING_SOURCE.id,
        active_incident_id: "inc-1",
        active_incident_status: "open",
        sentinel_health_status: "quarantined",
      }),
    ],
  });

  const quarantined = await getProvenance(
    { kind: "pricing_snapshot", id: "snap-suspect" },
    { port },
  );
  assert.equal(quarantined?.trust.validationState, "quarantined");
  assert.equal(quarantined?.trust.sentinelStatus, "quarantined");

  // The evidence behind the last good value is unaffected by the open incident.
  const good = await getProvenance({ kind: "pricing_snapshot", id: "snap-new" }, { port });
  assert.equal(good?.trust.validationState, "validated");
});

test("Provenance: a change event whose source row is gone still resolves what it can", async () => {
  const data = healthySourceData();
  const port = new InMemorySourceReadPort({
    ...data,
    changeEvents: [changeEvent({ id: "evt-orphan", source_id: null, run_id: null })],
  });

  const record = await getProvenance({ kind: "change_event", id: "evt-orphan" }, { port });
  assert.ok(record);
  assert.equal(record.source, null);
  assert.equal(record.run, null);
  assert.equal(record.trust.validationState, "unknown");
});

test("Provenance: unknown references resolve to null and malformed ones are rejected", async () => {
  const port = new InMemorySourceReadPort(healthySourceData());

  assert.equal(
    await getProvenance({ kind: "pricing_snapshot", id: "missing" }, { port }),
    null,
  );
  assert.equal(await getProvenance({ kind: "change_event", id: "missing" }, { port }), null);

  assert.equal(parseProvenanceReference("collector_secret", "abc"), null);
  assert.equal(parseProvenanceReference("pricing_snapshot", ""), null);
  assert.equal(parseProvenanceReference(null, "abc"), null);
  assert.deepEqual(parseProvenanceReference("change_event", " evt-1 "), {
    kind: "change_event",
    id: "evt-1",
  });
});
