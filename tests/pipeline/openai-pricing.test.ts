import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../../app/api/ingest/openai/route";
import {
  ingestOpenAiPricing,
  ingestAnthropicPricing,
  ingestXaiPricing,
  OpenAiPricingIngestionError,
  type OpenAiCollectorResult,
  type OpenAiPricingPipelineRepository,
} from "../../lib/pipeline";
import type {
  ChangeEventInput,
  CollectionRunRow,
  LatestPricingSnapshotRow,
  ModelRow,
  PricingSnapshotInput,
  ProviderRow,
  SourceRow,
} from "../../lib/supabase";

const timestamp = "2026-08-17T10:00:00.000Z";

function rawRecords(): Record<string, unknown>[] {
  return ["sol", "terra", "luna"].flatMap((model, modelIndex) =>
    ["short", "long"].map((tier, tierIndex) => ({
      input: {}, provider: "OpenAI", model_name: `gpt-5.6-${model}`,
      pricing_mode: "standard", context_tier: tier,
      input_price_per_1m_tokens: modelIndex + tierIndex + 1,
      cached_input_price_per_1m_tokens: 0.5,
      cache_write_price_per_1m_tokens: 0.75,
      output_price_per_1m_tokens: (modelIndex + 1) * (tierIndex + 2),
      pricing_unit: "USD per 1M tokens",
      source_url: "https://developers.openai.com/api/docs/pricing",
    })),
  );
}

function xaiRecords(): Record<string, unknown>[] {
  return Array.from({ length: 7 }, (_, modelIndex) => ["short", "long"].map((context_tier, tierIndex) => ({
    provider: "xAI", model_name: `grok-${modelIndex + 1}`, pricing_mode: "standard", context_tier,
    input_price_per_1m_tokens: modelIndex + tierIndex + 1,
    cached_input_price_per_1m_tokens: 0.5,
    output_price_per_1m_tokens: modelIndex + tierIndex + 3,
    pricing_unit: "USD per 1M tokens",
  }))).flat();
}

function eventConflictKeys(inputs: readonly ChangeEventInput[]): string[] {
  return inputs.map((input) => JSON.stringify([
    input.runId ?? null, input.modelId ?? null, input.changeType,
    input.fieldName ?? null, input.pricingMode ?? null, input.contextTier ?? null,
  ]));
}

function collector(data: unknown[], runId: string, success = true): () => Promise<OpenAiCollectorResult> {
  return async () => ({
    success,
    data,
    metadata: {
      collectorId: "c_msx3bqlyjtv2qustx", runId, startedAt: timestamp,
      completedAt: timestamp, durationMs: 12, resultCount: data.length,
      status: success ? "success" : "failed", error: success ? undefined : "collector unavailable",
    },
    error: success ? undefined : new Error("collector unavailable"),
  });
}

class MemoryRepository implements OpenAiPricingPipelineRepository {
  private nextRun = 1;
  readonly runs: CollectionRunRow[] = [];
  readonly models: ModelRow[] = [];
  readonly events: ChangeEventInput[] = [];
  readonly sources: SourceRow[] = [];
  latest: LatestPricingSnapshotRow[] = [];
  comparable: LatestPricingSnapshotRow[] = [];
  failSnapshots = false;
  failEvents = false;
  private readonly providers: ProviderRow[] = [];

  async upsertProvider(input: { slug: string; name: string; homepageUrl?: string | null }): Promise<ProviderRow> {
    const existing = this.providers.find((provider) => provider.slug === input.slug);
    if (existing) return existing;
    const provider: ProviderRow = {
      id: `provider-${input.slug}`, slug: input.slug, name: input.name,
      homepage_url: input.homepageUrl ?? null, created_at: timestamp, updated_at: timestamp,
    };
    this.providers.push(provider);
    return provider;
  }
  async upsertSource(input: { providerId: string; sourceUrl: string; collectorId?: string | null; label?: string | null }): Promise<SourceRow> {
    const existing = this.sources.find((source) => source.provider_id === input.providerId && source.source_url === input.sourceUrl);
    if (existing) return existing;
    const source: SourceRow = {
      id: `source-${this.sources.length + 1}`, provider_id: input.providerId, kind: "pricing", collector_id: input.collectorId ?? null,
      source_url: input.sourceUrl, label: input.label ?? null, is_active: true, created_at: timestamp, updated_at: timestamp,
    };
    this.sources.push(source);
    return source;
  }
  async startCollectionRun(input: { sourceId: string; externalRunId?: string | null; triggeredBy?: string }): Promise<CollectionRunRow> {
    const existing = this.runs.find((run) => run.external_run_id === (input.externalRunId ?? null));
    if (existing) return existing;
    const run: CollectionRunRow = {
      id: `run-${this.nextRun++}`, source_id: input.sourceId, status: "running", external_run_id: input.externalRunId ?? null,
      triggered_by: input.triggeredBy ?? "manual", started_at: timestamp, completed_at: null, records_seen: 0, records_accepted: 0,
      records_rejected: 0, error_message: null, error_details: null, created_at: timestamp,
    };
    this.runs.push(run);
    return run;
  }
  async failCollectionRun(runId: string, error: { message: string }, counts: Partial<{ recordsSeen: number; recordsAccepted: number; recordsRejected: number }> = {}): Promise<CollectionRunRow> {
    const run = this.requireRun(runId);
    run.status = "failed"; run.completed_at = timestamp; run.error_message = error.message;
    run.records_seen = counts.recordsSeen ?? run.records_seen;
    run.records_accepted = counts.recordsAccepted ?? run.records_accepted;
    run.records_rejected = counts.recordsRejected ?? run.records_rejected;
    return run;
  }
  async completeCollectionRun(runId: string, counts: { recordsSeen: number; recordsAccepted: number; recordsRejected: number }): Promise<CollectionRunRow> {
    const run = this.requireRun(runId);
    run.status = counts.recordsRejected ? "partial" : "succeeded"; run.completed_at = timestamp;
    run.records_seen = counts.recordsSeen; run.records_accepted = counts.recordsAccepted; run.records_rejected = counts.recordsRejected;
    this.comparable = [...this.latest];
    return run;
  }
  async upsertModels(inputs: readonly { providerId: string; modelName: string; seenAt: string }[]): Promise<ModelRow[]> {
    return inputs.map((input) => {
      let model = this.models.find((item) => item.provider_id === input.providerId && item.model_name === input.modelName);
      if (!model) {
        model = { id: `model-${this.models.length + 1}`, provider_id: input.providerId, model_name: input.modelName, display_name: null, metadata: {}, is_active: true, first_seen_at: input.seenAt, last_seen_at: input.seenAt, created_at: timestamp, updated_at: timestamp };
        this.models.push(model);
      }
      model.last_seen_at = input.seenAt;
      return model;
    });
  }
  async listModels(): Promise<ModelRow[]> { return this.models; }
  async getComparablePricingSnapshots(): Promise<LatestPricingSnapshotRow[]> { return this.comparable; }
  async savePricingSnapshots(inputs: readonly PricingSnapshotInput[]): Promise<{ id: string; model_id: string; pricing_mode: string; context_tier: string }[]> {
    if (this.failSnapshots) throw new Error("database write failed");
    this.latest = inputs.map((input, index) => {
      const model = this.models.find((item) => item.id === input.modelId);
      if (!model) throw new Error("missing model");
      return {
        id: `snapshot-${input.runId}-${index}`, run_id: input.runId, source_id: input.sourceId, provider_id: input.providerId, model_id: input.modelId,
        pricing_mode: input.pricingMode ?? "standard", context_tier: input.contextTier ?? "default", input_price_per_1m_tokens: input.inputPricePer1mTokens ?? null,
        cached_input_price_per_1m_tokens: input.cachedInputPricePer1mTokens ?? null, cache_write_price_per_1m_tokens: input.cacheWritePricePer1mTokens ?? null,
        output_price_per_1m_tokens: input.outputPricePer1mTokens ?? null, currency: input.currency ?? "USD", pricing_unit: input.pricingUnit ?? "USD per 1M tokens",
        source_url: input.sourceUrl ?? null, extra: {}, raw: null, observed_at: input.observedAt ?? timestamp, created_at: timestamp, content_hash: "hash",
        model_name: model.model_name,
        provider_slug: this.providers.find((provider) => provider.id === input.providerId)?.slug ?? "unknown",
        provider_name: this.providers.find((provider) => provider.id === input.providerId)?.name ?? "Unknown",
      };
    });
    return this.latest.map((row) => ({ id: row.id, model_id: row.model_id, pricing_mode: row.pricing_mode, context_tier: row.context_tier }));
  }
  async saveChangeEvents(inputs: readonly ChangeEventInput[]): Promise<unknown[]> {
    if (this.failEvents) throw new Error("change event write failed");
    this.events.push(...inputs);
    return [...inputs];
  }
  private requireRun(id: string): CollectionRunRow {
    const run = this.runs.find((item) => item.id === id);
    if (!run) throw new Error("missing run");
    return run;
  }
}

test("pricing pipeline persists six records, detects changes, and never deactivates models", async () => {
  const repository = new MemoryRepository();
  const first = await ingestOpenAiPricing({ repository, collect: collector(rawRecords(), "external-1"), now: () => new Date(timestamp) });
  assert.deepEqual({ accepted: first.acceptedCount, rejected: first.rejectedCount, changes: first.changesDetected }, { accepted: 6, rejected: 0, changes: 3 });
  assert.equal(new Set(eventConflictKeys(repository.events)).size, repository.events.length);
  assert(repository.events.every((event) => event.changeType !== "model_added" || event.contextTier === null));

  const same = await ingestOpenAiPricing({ repository, collect: collector(rawRecords(), "external-2"), now: () => new Date(timestamp) });
  assert.equal(same.changesDetected, 0);

  const increased = rawRecords(); increased[0].input_price_per_1m_tokens = 99;
  const increase = await ingestOpenAiPricing({ repository, collect: collector(increased, "external-3"), now: () => new Date(timestamp) });
  assert.equal(increase.changesDetected, 1);

  const decreased = rawRecords(); decreased[0].input_price_per_1m_tokens = 0.25;
  const decrease = await ingestOpenAiPricing({ repository, collect: collector(decreased, "external-4"), now: () => new Date(timestamp) });
  assert.equal(decrease.changesDetected, 1);

  const removed = await ingestOpenAiPricing({ repository, collect: collector(decreased.slice(1), "external-5"), now: () => new Date(timestamp) });
  assert.equal(removed.changesDetected, 1);
  assert.equal(repository.events.at(-1)?.changeType, "model_removed");
  assert(repository.models.every((model) => model.is_active));

  const malformed = await ingestOpenAiPricing({ repository, collect: collector([...decreased.slice(1), { provider: "OpenAI" }], "external-6"), now: () => new Date(timestamp) });
  assert.equal(malformed.rejectedCount, 1);

  const replay = await ingestOpenAiPricing({ repository, collect: collector(decreased.slice(1), "external-5"), now: () => new Date(timestamp) });
  assert.equal(replay.idempotent, true);
  assert.equal(repository.runs.length, 6);
});

test("pipeline records Bright Data and persistence failures as failed runs", async () => {
  const collectorFailure = new MemoryRepository();
  await assert.rejects(
    () => ingestOpenAiPricing({ repository: collectorFailure, collect: collector([], "external-failed", false) }),
    OpenAiPricingIngestionError,
  );
  assert.equal(collectorFailure.runs[0]?.status, "failed");

  const persistenceFailure = new MemoryRepository();
  persistenceFailure.failSnapshots = true;
  await assert.rejects(
    () => ingestOpenAiPricing({ repository: persistenceFailure, collect: collector(rawRecords(), "external-db") }),
    OpenAiPricingIngestionError,
  );
  assert.equal(persistenceFailure.runs[0]?.status, "failed");
});

test("retry recovers events after a failed event batch without duplicating snapshots", async () => {
  const repository = new MemoryRepository();
  repository.failEvents = true;
  await assert.rejects(
    () => ingestXaiPricing({ repository, collect: collector(xaiRecords().slice(0, 2), "xai-retry"), now: () => new Date(timestamp) }),
    OpenAiPricingIngestionError,
  );
  assert.equal(repository.runs[0]?.status, "failed");
  assert.equal(repository.latest.length, 2);
  assert.equal(repository.events.length, 0);

  repository.failEvents = false;
  const retry = await ingestXaiPricing({
    repository, collect: collector(xaiRecords().slice(0, 2), "xai-retry"), now: () => new Date(timestamp),
  });
  assert.equal(retry.idempotent, false);
  assert.equal(repository.runs[0]?.status, "succeeded");
  assert.equal(repository.latest.length, 2);
  assert.equal(repository.events.filter((event) => event.changeType === "model_added").length, 1);
});

test("xAI-style short and long records emit one model event per model and retain tier-specific price changes", async () => {
  const repository = new MemoryRepository();
  const first = await ingestXaiPricing({
    repository, collect: collector(xaiRecords(), "xai-first"), now: () => new Date(timestamp),
  });
  assert.equal(first.changesDetected, 7);
  assert.equal(repository.events.filter((event) => event.changeType === "model_added").length, 7);
  assert.equal(new Set(eventConflictKeys(repository.events)).size, repository.events.length);

  repository.events.length = 0;
  const increased = xaiRecords().map((record) => ({
    ...record,
    input_price_per_1m_tokens: (record.input_price_per_1m_tokens as number) + 1,
  }));
  const second = await ingestXaiPricing({
    repository, collect: collector(increased, "xai-second"), now: () => new Date(timestamp),
  });
  assert.equal(second.changesDetected, 14);
  const priceChanges = repository.events.filter((event) => event.changeType === "price_increased");
  assert.equal(priceChanges.length, 14);
  assert.equal(new Set(eventConflictKeys(priceChanges)).size, 14);
  assert(priceChanges.some((event) => event.contextTier === "short"));
  assert(priceChanges.some((event) => event.contextTier === "long"));
});

test("Anthropic uses the shared pipeline with its own provider and source provenance", async () => {
  const repository = new MemoryRepository();
  const result = await ingestAnthropicPricing({
    repository,
    collect: collector([{
      provider: "Anthropic", model_name: "Claude Sonnet 5", pricing_mode: "standard", context_tier: "standard",
      input_price_per_1m_tokens: 2, cached_input_price_per_1m_tokens: 0.2,
      cache_write_price_per_1m_tokens: 2.5, output_price_per_1m_tokens: 10,
      pricing_unit: "per_1m_tokens",
    }], "anthropic-run"),
    now: () => new Date(timestamp),
  });
  assert.equal(result.acceptedCount, 1);
  assert.equal(repository.models[0]?.provider_id, "provider-anthropic");
  assert.equal(repository.sources[0]?.collector_id, "c_msxbuggp1czbtysx06");
});

test("ingest endpoint rejects absent or incorrect secrets without returning secret material", async () => {
  const previous = process.env.AI_RADAR_INGEST_SECRET;
  process.env.AI_RADAR_INGEST_SECRET = "correct-secret";
  try {
    for (const request of [new Request("http://localhost/api/ingest/openai", { method: "POST" }), new Request("http://localhost/api/ingest/openai", { method: "POST", headers: { "x-ai-radar-ingest-secret": "wrong-secret" } })]) {
      const response = await POST(request);
      assert.equal(response.status, 401);
      assert.equal(JSON.stringify(await response.json()).includes("correct-secret"), false);
    }
  } finally {
    if (previous === undefined) delete process.env.AI_RADAR_INGEST_SECRET;
    else process.env.AI_RADAR_INGEST_SECRET = previous;
  }
});
