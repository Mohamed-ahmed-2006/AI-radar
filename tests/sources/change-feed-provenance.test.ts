import test from "node:test";
import assert from "node:assert/strict";

import { transformChangeEventToEvidence } from "../../lib/intelligence/evidence-builder";
import { TemporalEvidenceSchema } from "../../lib/intelligence/contracts";
import { InMemorySourceReadPort, getProvenance } from "../../lib/sources";
import {
  OPENAI_PROVIDER,
  PRICING_SOURCE,
  changeEvent,
  healthySourceData,
} from "./support/fixtures";

/**
 * The Change Feed reads Antigravity's temporal engine, not a second pipeline.
 * These tests pin the provenance a feed item must carry: what changed, for
 * which model and provider, before → after, when it was observed, from which
 * source — and a reference that resolves through the provenance API.
 */
test("Change Feed: a temporal evidence item carries provider, delta, observation time and source", () => {
  const row = changeEvent({ id: "evt-price" });
  const evidence = transformChangeEventToEvidence(row, {
    sources: [PRICING_SOURCE],
    modelNamesById: new Map([["model-gpt", "gpt-5"]]),
    providerSlugsById: new Map([[OPENAI_PROVIDER.id, OPENAI_PROVIDER.slug]]),
    providerNamesById: new Map([[OPENAI_PROVIDER.id, OPENAI_PROVIDER.name]]),
    externalRunIdsByRunId: new Map([["run-latest", "bd_run-latest"]]),
  });

  // The schema is the contract the feed UI codes against.
  TemporalEvidenceSchema.parse(evidence);

  assert.equal(evidence.changeType, "price_decreased");
  assert.equal(evidence.provider, "openai");
  assert.equal(evidence.providerName, "OpenAI");
  assert.equal(evidence.model, "gpt-5");
  assert.equal(evidence.previousValue, 2.5);
  assert.equal(evidence.currentValue, 1.25);
  assert.equal(evidence.priceDelta?.percentChange, -50);
  assert.equal(evidence.observedAt, row.detected_at);

  assert.equal(evidence.source.url, PRICING_SOURCE.source_url);
  assert.equal(evidence.source.sourceId, PRICING_SOURCE.id);
  assert.equal(evidence.source.collectorId, PRICING_SOURCE.collector_id);
  assert.equal(evidence.provenance.runId, "run-latest");
  assert.equal(evidence.provenance.externalRunId, "bd_run-latest");
  assert.equal(evidence.provenance.previousSnapshotId, "snap-old");
  assert.equal(evidence.provenance.currentSnapshotId, "snap-new");
});

test("Change Feed: a feed item id resolves to full provenance through the provenance API", async () => {
  const port = new InMemorySourceReadPort(healthySourceData());
  const row = changeEvent({ id: "evt-price" });

  const evidence = transformChangeEventToEvidence(row, {
    sources: [PRICING_SOURCE],
    providerSlugsById: new Map([[OPENAI_PROVIDER.id, OPENAI_PROVIDER.slug]]),
  });

  const provenance = await getProvenance(
    { kind: "change_event", id: evidence.id },
    { port },
  );

  assert.ok(provenance, "every feed item must be traceable");
  assert.equal(provenance.source?.id, evidence.source.sourceId);
  assert.equal(provenance.source?.url, evidence.source.url);
  assert.equal(provenance.run?.runId, evidence.provenance.runId);
  assert.equal(provenance.trust.validationState, "validated");
  assert.equal(provenance.trust.authorityDomain, "pricing");
});
