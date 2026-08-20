import assert from "node:assert/strict";
import test from "node:test";

import { InMemorySourceReadPort } from "../../lib/sources/in-memory-port";
import { getSourceCatalog, getSourceDetail } from "../../lib/sources/read-model";
import { resolveSourceContractView } from "../../lib/sources/contract-view";
import {
  buildSourceDetailFromReadModel,
  buildSourceDirectoryFromReadModel,
  createSourceReadModelAdapter,
  SOURCE_READ_MODEL_CAPABILITIES,
} from "../../lib/product/source-detail-read-model";
import { getSourceDetailAdapter, supportedSections } from "../../lib/product";
import { provenanceFromRecord, provenanceRows } from "../../lib/product/provenance";
import type { ProvenanceRecord } from "../../lib/sources/types";
import {
  healthySourceData,
  NOW,
  PRICING_SOURCE,
} from "../sources/support/fixtures";

async function loadDetail() {
  const port = new InMemorySourceReadPort(healthySourceData());
  const detail = await getSourceDetail(PRICING_SOURCE.id, { port, now: () => NOW });
  assert.ok(detail, "fixture source should resolve");
  return detail;
}

test("the read-model adapter is the installed default", () => {
  assert.equal(getSourceDetailAdapter().id, "source-detail-read-model-v1");
});

test("the read-model adapter answers the sections Sentinel alone could not", async () => {
  const detail = buildSourceDetailFromReadModel(await loadDetail());

  // Full per-run history, not just the latest run.
  assert.equal(detail.runHistory.available, true);
  assert.ok(
    detail.runHistory.available && detail.runHistory.data.length > 1,
    "the richer backend should expose more than one run",
  );
  const [latest] = detail.runHistory.available ? detail.runHistory.data : [];
  assert.equal(latest.recordsSeen, 12);
  assert.equal(latest.recordsAccepted, 12);
  assert.equal(latest.recordsRejected, 0);

  // Identity, health and freshness all come through.
  assert.equal(detail.identity.sourceId, PRICING_SOURCE.id);
  assert.equal(detail.identity.collectorId, PRICING_SOURCE.collector_id);
  assert.equal(detail.identity.sourceUrl, PRICING_SOURCE.source_url);
  assert.equal(detail.health.status, "healthy");
  assert.equal(detail.health.health, "healthy");
  assert.equal(typeof detail.freshness.lastRunAt, "string");
  assert.equal(typeof detail.freshness.lastSuccessAt, "string");

  // Observed vs trusted, incidents and healing are all answerable.
  assert.equal(detail.observedData.available, true);
  assert.equal(detail.incidents.available, true);
  assert.equal(detail.healingTimeline.available, true);
});

test("normalization explains the contract and the raw to normalized step", async () => {
  const detail = buildSourceDetailFromReadModel(await loadDetail());
  assert.equal(detail.normalization.available, true);
  if (!detail.normalization.available) return;

  const ids = detail.normalization.data.stages.map((stage) => stage.id);
  assert.deepEqual(ids, [
    "collect",
    "validate",
    "normalize",
    "gate",
    "persist",
    "contract-registry",
  ]);

  const collect = detail.normalization.data.stages[0];
  assert.match(collect.description, new RegExp(PRICING_SOURCE.collector_id!));

  // The normalize stage carries the worked raw -> normalized example.
  const normalize = detail.normalization.data.stages[2];
  assert.match(normalize.detail ?? "", /→/);
});

test("a section the backend cannot answer stays explicit rather than fabricated", async () => {
  const backend = await loadDetail();
  const stripped = buildSourceDetailFromReadModel({
    ...backend,
    contract: null,
    transformation: null,
    runs: [],
    health: { ...backend.health, lastKnownGoodRunId: null, lastKnownGoodAt: null },
  });

  assert.equal(stripped.normalization.available, false);
  assert.equal(stripped.observedData.available, false);
  assert.equal(stripped.lastKnownGood.available, false);
  for (const section of [stripped.normalization, stripped.observedData, stripped.lastKnownGood]) {
    assert.ok(
      !section.available && section.reason.length > 0,
      "an unavailable section must say why",
    );
  }

  // Run history is still answerable; the honest answer is simply none.
  assert.equal(stripped.runHistory.available, true);
  assert.deepEqual(stripped.runHistory.available ? stripped.runHistory.data : null, []);

  // Nothing invented a record count either.
  assert.equal(stripped.provenance.confidence, null);
});

test("the adapter declares the sections it can fill", async () => {
  const port = new InMemorySourceReadPort(healthySourceData());
  const adapter = createSourceReadModelAdapter({
    loadCatalog: async () => {
      const catalog = await getSourceCatalog({ port, now: () => NOW });
      return { sources: catalog.sources, generatedAt: catalog.generatedAt };
    },
    loadDetail: async (sourceId) => getSourceDetail(sourceId, { port, now: () => NOW }),
  });

  const sections = supportedSections(adapter.capabilities);
  assert.ok(sections.includes("runHistory"));
  assert.ok(sections.includes("incidents"));
  assert.ok(sections.includes("healingTimeline"));
  // The read model publishes sanitized field evidence, never the raw payload.
  assert.equal(SOURCE_READ_MODEL_CAPABILITIES.rawPayload, false);
  assert.equal(sections.includes("rawPayload"), false);

  const directory = await adapter.listSources();
  assert.equal(directory.entries.length, 1);
  assert.equal(directory.entries[0].collectorId, PRICING_SOURCE.collector_id);
  assert.equal(directory.isDemo, false);

  assert.equal(await adapter.getSourceDetail("src-does-not-exist"), null);
});

test("the directory reports demo state honestly", async () => {
  const port = new InMemorySourceReadPort(healthySourceData());
  const catalog = await getSourceCatalog({ port, now: () => NOW });
  const directory = buildSourceDirectoryFromReadModel(catalog.sources, catalog.generatedAt);
  assert.equal(directory.isDemo, false);
  assert.equal(directory.demoScenario, null);
});

test("ProvenanceDisclosure can consume a backend provenance record", () => {
  const record: ProvenanceRecord = {
    reference: { kind: "pricing_snapshot", id: "snap-new" },
    provider: { id: "prov-openai", slug: "openai", name: "OpenAI" },
    source: {
      id: PRICING_SOURCE.id,
      name: "OpenAI pricing page",
      url: PRICING_SOURCE.source_url,
      kind: "pricing",
      category: "pricing",
      collectorId: PRICING_SOURCE.collector_id,
      enabled: true,
    },
    observedAt: "2026-08-18T11:00:00.000Z",
    run: {
      runId: "run-latest",
      externalRunId: "j_abc",
      status: "succeeded",
      startedAt: "2026-08-18T10:59:00.000Z",
      completedAt: "2026-08-18T11:00:00.000Z",
    },
    snapshotId: "snap-new",
    trust: {
      validationState: "validated",
      sentinelStatus: "healthy",
      authorityDomain: "pricing",
      isAuthoritative: true,
    },
    transition: null,
  };

  const provenance = provenanceFromRecord(record);
  assert.equal(provenance.trust, "official");
  assert.equal(provenance.collectorId, PRICING_SOURCE.collector_id);
  assert.equal(provenance.runId, "run-latest");
  assert.equal(provenance.externalRunId, "j_abc");
  assert.equal(provenance.snapshotId, "snap-new");
  assert.equal(provenance.validation?.status, "passing");
  // The backend does not score confidence, so none is invented.
  assert.equal(provenance.confidence, null);

  // Rendering goes through the one shared row builder, not a second copy.
  const ids = provenanceRows(provenance).map((row) => row.id);
  assert.deepEqual(ids, [
    "source",
    "source-url",
    "observed-at",
    "collector",
    "validation",
    "trust",
    "run",
    "external-run",
    "snapshot",
  ]);
});

test("a quarantined record reads as failing without claiming authority", () => {
  const provenance = provenanceFromRecord({
    reference: { kind: "change_event", id: "evt-1" },
    provider: { id: "prov-xai", slug: "xai", name: "xAI" },
    source: null,
    observedAt: "2026-08-18T11:00:00.000Z",
    run: null,
    snapshotId: null,
    trust: {
      validationState: "quarantined",
      sentinelStatus: "quarantined",
      authorityDomain: null,
      isAuthoritative: false,
    },
    transition: { previousSnapshotId: "snap-old", currentSnapshotId: "snap-new" },
  });

  assert.equal(provenance.trust, "unverified");
  assert.equal(provenance.authority, null);
  assert.equal(provenance.validation?.status, "failing");
  assert.equal(provenance.snapshotId, "snap-new");
  assert.equal(provenance.previousSnapshotId, "snap-old");
});

test("a catalog source resolves its catalog contract, not the lifecycle one", () => {
  // Lifecycle and catalog sources are both kind `models`, and Gemini runs one
  // of each, so the collector identity is what separates them.
  const catalog = resolveSourceContractView(
    "models",
    "gemini",
    "src-gemini-catalog",
    "c_msz708an1gawux0njo",
    "https://ai.google.dev/gemini-api/docs/models",
  );
  assert.ok(catalog, "a catalog source must be governed by a contract");
  assert.equal(catalog.authorityDomain, "catalog");
  assert.ok(catalog.requiredFields.includes("model_id"));

  const lifecycle = resolveSourceContractView(
    "models",
    "gemini",
    "src-gemini-lifecycle",
    "c_gemini_lifecycle",
    "https://ai.google.dev/gemini-api/docs/deprecations",
  );
  assert.ok(lifecycle);
  assert.equal(lifecycle.authorityDomain, "lifecycle");
});
