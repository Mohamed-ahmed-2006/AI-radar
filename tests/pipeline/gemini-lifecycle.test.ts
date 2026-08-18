import assert from "node:assert/strict";
import test from "node:test";

import { InMemorySentinelRepository } from "../../lib/sentinel";

import { POST } from "../../app/api/ingest/gemini/lifecycle/route";
import {
  ingestGeminiLifecycle,
  type GeminiLifecyclePipelineRepository,
  type OpenAiCollectorResult,
} from "../../lib/pipeline";
import { SentinelQuarantineError } from "../../lib/pipeline";
import { modelLifecycleProjectionPatch } from "../../lib/supabase";
import type {
  ChangeEventInput,
  CollectionRunRow,
  Json,
  LatestLifecycleSnapshotRow,
  LifecycleSnapshotInput,
  LifecycleSnapshotRow,
  ModelAliasInput,
  ModelAliasRow,
  ModelLifecycleProjectionInput,
  ModelRow,
  ProviderRow,
  RunStatus,
  SourceRow,
} from "../../lib/supabase";

/**
 * The ingestion pipelines run the Sentinel gate inline, so every call needs a
 * Sentinel store. A fresh in-memory one per call keeps each ingestion
 * independent, exactly as a fresh incident history would be.
 */
function sentinel(): InMemorySentinelRepository {
  return new InMemorySentinelRepository();
}

const timestamp = "2026-08-18T12:00:00.000Z";
const sourceUrl = "https://ai.google.dev/gemini-api/docs/deprecations";

function lifecycleRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model_id: "gemini-2.5-pro",
    model_group: "Gemini 2.5 models",
    model_stage: "stable",
    release_date_raw: "June 17, 2025",
    shutdown_not_before_date_raw: "No shutdown date announced",
    recommended_replacement: null,
    product_page_url: null,
    is_shutdown: false,
    input: { url: sourceUrl },
    ...overrides,
  };
}

/**
 * A second, stable model. The authoritative lifecycle contract admits a payload
 * only with at least two records, which is what the real deprecations page
 * always publishes. It never changes, so it emits no change events of its own.
 */
function companionRow(): Record<string, unknown> {
  return lifecycleRow({
    model_id: "gemini-2.5-flash",
    model_group: "Gemini 2.5 models",
  });
}

function collector(rows: unknown[], runId: string): () => Promise<OpenAiCollectorResult> {
  const data = rows.length > 0 ? [...rows, companionRow()] : rows;
  return async () => ({
    success: true,
    data,
    metadata: {
      collectorId: "c_msxqpelk2cpxz8r386",
      runId,
      startedAt: timestamp,
      completedAt: timestamp,
      durationMs: 10,
      resultCount: data.length,
      status: "success",
    },
  });
}

function newModel(id: string, modelName: string): ModelRow {
  return {
    id, provider_id: "provider-gemini", model_name: modelName,
    display_name: null, metadata: {}, is_active: true, lifecycle_state: null,
    deprecated_on: null, retirement_date: null,
    retirement_not_before_date: null, lifecycle_source_id: null,
    lifecycle_observed_at: null, first_seen_at: timestamp,
    last_seen_at: timestamp, created_at: timestamp, updated_at: timestamp,
  };
}

class MemoryGeminiLifecycleRepository implements GeminiLifecyclePipelineRepository {
  readonly models: ModelRow[];
  readonly aliases: ModelAliasRow[] = [];
  readonly runs: CollectionRunRow[] = [];
  readonly snapshots: LifecycleSnapshotRow[] = [];
  readonly events: ChangeEventInput[] = [];
  readonly pricingHistory = [{ id: "price-before" }, { id: "price-current" }];
  private comparable: LatestLifecycleSnapshotRow[] = [];
  private nextRun = 1;

  constructor(models: ModelRow[] = [newModel("model-1", "Gemini 2.5 Pro")]) {
    this.models = models;
  }

  async upsertProvider(input: { slug: string; name: string; homepageUrl?: string | null }): Promise<ProviderRow> {
    return {
      id: "provider-gemini", slug: input.slug, name: input.name,
      homepage_url: input.homepageUrl ?? null, created_at: timestamp,
      updated_at: timestamp,
    };
  }
  async upsertSource(input: { providerId: string; sourceUrl: string; collectorId?: string | null; label?: string | null }): Promise<SourceRow> {
    return {
      id: "source-gemini-lifecycle", provider_id: input.providerId,
      kind: "models", collector_id: input.collectorId ?? null,
      source_url: input.sourceUrl, label: input.label ?? null,
      is_active: true, created_at: timestamp, updated_at: timestamp,
    };
  }
  async startCollectionRun(input: { sourceId: string; externalRunId?: string | null; triggeredBy?: string }): Promise<CollectionRunRow> {
    const existing = this.runs.find((run) => run.external_run_id === (input.externalRunId ?? null));
    if (existing) return existing;
    const run: CollectionRunRow = {
      id: `run-${this.nextRun++}`, source_id: input.sourceId, status: "running",
      external_run_id: input.externalRunId ?? null,
      triggered_by: input.triggeredBy ?? "manual", started_at: timestamp,
      completed_at: null, records_seen: 0, records_accepted: 0,
      records_rejected: 0, error_message: null, error_details: null,
      validation_errors: [], created_at: timestamp,
    };
    this.runs.push(run);
    return run;
  }
  async failCollectionRun(
    runId: string,
    error: { message: string; details?: Json },
    counts: Partial<{ recordsSeen: number; recordsAccepted: number; recordsRejected: number }> = {},
  ): Promise<CollectionRunRow> {
    const run = this.requireRun(runId);
    run.status = "failed";
    run.completed_at = timestamp;
    run.error_message = error.message;
    run.error_details = error.details ?? null;
    run.records_seen = counts.recordsSeen ?? run.records_seen;
    run.records_accepted = counts.recordsAccepted ?? run.records_accepted;
    run.records_rejected = counts.recordsRejected ?? run.records_rejected;
    return run;
  }
  async completeCollectionRun(
    runId: string,
    counts: { recordsSeen: number; recordsAccepted: number; recordsRejected: number },
    status?: Extract<RunStatus, "succeeded" | "partial">,
    validationErrors: Json = [],
  ): Promise<CollectionRunRow> {
    const run = this.requireRun(runId);
    run.status = status ?? (counts.recordsRejected ? "partial" : "succeeded");
    run.completed_at = timestamp;
    run.records_seen = counts.recordsSeen;
    run.records_accepted = counts.recordsAccepted;
    run.records_rejected = counts.recordsRejected;
    run.validation_errors = validationErrors;
    const current = this.snapshots.filter((row) => row.run_id === runId);
    const byApiId = new Map(this.comparable.map((row) => [row.api_model_id, row]));
    current.forEach((row) => byApiId.set(row.api_model_id, this.asLatest(row)));
    this.comparable = [...byApiId.values()];
    return run;
  }
  async listModels(): Promise<ModelRow[]> { return this.models; }
  async upsertModels(inputs: readonly { providerId: string; modelName: string; seenAt: string }[]): Promise<ModelRow[]> {
    return inputs.map((input) => {
      const existing = this.models.find((model) => model.model_name === input.modelName);
      if (existing) return existing;
      const model = newModel(`model-${this.models.length + 1}`, input.modelName);
      this.models.push(model);
      return model;
    });
  }
  async listModelAliases(): Promise<ModelAliasRow[]> { return this.aliases; }
  async upsertModelAliases(inputs: readonly ModelAliasInput[]): Promise<ModelAliasRow[]> {
    return inputs.map((input) => {
      const existing = this.aliases.find((alias) => alias.alias === input.alias);
      if (existing) return existing;
      const row: ModelAliasRow = {
        id: `alias-${this.aliases.length + 1}`, provider_id: input.providerId,
        model_id: input.modelId, source_id: input.sourceId ?? null,
        alias: input.alias, alias_type: input.aliasType,
        first_seen_at: input.seenAt ?? timestamp,
        last_seen_at: input.seenAt ?? timestamp,
        created_at: timestamp, updated_at: timestamp,
      };
      this.aliases.push(row);
      return row;
    });
  }
  async getComparableLifecycleSnapshots(): Promise<LatestLifecycleSnapshotRow[]> {
    return this.comparable;
  }
  async saveLifecycleSnapshots(inputs: readonly LifecycleSnapshotInput[]): Promise<LifecycleSnapshotRow[]> {
    return inputs.map((input) => {
      const existing = this.snapshots.find(
        (row) => row.run_id === input.runId && row.api_model_id === input.apiModelId,
      );
      if (existing) return existing;
      const row: LifecycleSnapshotRow = {
        id: `snapshot-${this.snapshots.length + 1}`, run_id: input.runId,
        source_id: input.sourceId, provider_id: input.providerId,
        model_id: input.modelId, api_model_id: input.apiModelId,
        lifecycle_state: input.lifecycleState,
        deprecated_on: input.deprecatedOn ?? null,
        retirement_date: input.retirementDate ?? null,
        retirement_not_before_date: input.retirementNotBeforeDate ?? null,
        retirement_not_before_observation:
          input.retirementNotBeforeObservation ?? "unobserved",
        recommended_replacement: input.recommendedReplacement ?? null,
        recommended_replacement_model_id: input.recommendedReplacementModelId ?? null,
        recommended_replacement_observed: input.recommendedReplacementObserved ?? false,
        source_metadata: input.sourceMetadata ?? {},
        source_url: input.sourceUrl, raw: input.raw ?? null,
        observed_at: input.observedAt, created_at: timestamp,
        content_hash: "hash",
      };
      this.snapshots.push(row);
      return row;
    });
  }
  async applyModelLifecycleProjections(inputs: readonly ModelLifecycleProjectionInput[]): Promise<ModelRow[]> {
    return inputs.map((input) => {
      const model = this.models.find((candidate) => candidate.id === input.modelId);
      if (!model) throw new Error("missing model");
      Object.assign(model, modelLifecycleProjectionPatch(input));
      return model;
    });
  }
  async saveChangeEvents(inputs: readonly ChangeEventInput[]): Promise<unknown[]> {
    this.events.push(...inputs);
    return [...inputs];
  }
  private asLatest(row: LifecycleSnapshotRow): LatestLifecycleSnapshotRow {
    return {
      ...row,
      model_name: this.models.find((model) => model.id === row.model_id)?.model_name ?? "unknown",
      projected_lifecycle_state:
        this.models.find((model) => model.id === row.model_id)?.lifecycle_state ?? null,
      provider_slug: "gemini",
      provider_name: "Google",
    };
  }
  private requireRun(id: string): CollectionRunRow {
    const run = this.runs.find((candidate) => candidate.id === id);
    if (!run) throw new Error("missing run");
    return run;
  }
}

test("Gemini lifecycle transitions, withdrawals, replacements, and history are authoritative", async () => {
  const repository = new MemoryGeminiLifecycleRepository();
  const first = await ingestGeminiLifecycle({ sentinelRepository: sentinel(),
    repository,
    collect: collector([lifecycleRow()], "gemini-1"),
    now: () => new Date(timestamp),
  });
  assert.equal(first.changesDetected, 0, "first observation has no fake events");
  assert.equal(repository.models[0].model_name, "Gemini 2.5 Pro", "pricing identity reused");
  assert.equal(repository.models[0].lifecycle_state, null, "no active state invented");

  const scheduled = lifecycleRow({
    shutdown_not_before_date_raw: "May 7, 2027",
    recommended_replacement: "gemini-3-pro-preview",
  });
  const second = await ingestGeminiLifecycle({ sentinelRepository: sentinel(),
    repository,
    collect: collector([scheduled], "gemini-2"),
    now: () => new Date(timestamp),
  });
  assert.equal(second.changesDetected, 3);
  assert.equal(repository.models[0].lifecycle_state, "deprecated");
  assert.equal(repository.models[0].retirement_date, null);
  assert.equal(repository.models[0].retirement_not_before_date, "2027-05-07");

  const repeat = await ingestGeminiLifecycle({ sentinelRepository: sentinel(),
    repository,
    collect: collector([scheduled], "gemini-3"),
    now: () => new Date(timestamp),
  });
  assert.equal(repeat.changesDetected, 0);

  const replacementChanged = { ...scheduled, recommended_replacement: "gemini-3.1-pro-preview" };
  const third = await ingestGeminiLifecycle({ sentinelRepository: sentinel(),
    repository,
    collect: collector([replacementChanged], "gemini-4"),
    now: () => new Date(timestamp),
  });
  assert.equal(third.changesDetected, 1);
  assert.equal(repository.events.at(-1)?.fieldName, "recommendedReplacement");

  const withdrawn = lifecycleRow({ recommended_replacement: "gemini-3.1-pro-preview" });
  const fourth = await ingestGeminiLifecycle({ sentinelRepository: sentinel(),
    repository,
    collect: collector([withdrawn], "gemini-5"),
    now: () => new Date(timestamp),
  });
  assert.equal(fourth.changesDetected, 1);
  assert.equal(repository.events.at(-1)?.fieldName, "retirementNotBeforeDate");
  assert.equal(repository.events.at(-1)?.newValue, null);
  assert.equal(repository.models[0].lifecycle_state, "deprecated", "withdrawal preserves state");
  assert.equal(repository.models[0].retirement_not_before_date, null);

  const retired = lifecycleRow({ is_shutdown: true });
  await ingestGeminiLifecycle({ sentinelRepository: sentinel(),
    repository,
    collect: collector([retired], "gemini-6"),
    now: () => new Date(timestamp),
  });
  assert.equal(repository.models[0].lifecycle_state, "retired");
  assert.equal(repository.models[0].is_active, false);
  assert.equal(repository.snapshots.length, 12, "history remains append-only");
  assert.equal(repository.pricingHistory.length, 2, "pricing history is isolated");

  // An empty scrape is refused by Sentinel before persistence.
  await assert.rejects(
    () => ingestGeminiLifecycle({ sentinelRepository: sentinel(),
      repository,
      collect: collector([], "gemini-7"),
      now: () => new Date(timestamp),
    }),
    SentinelQuarantineError,
  );
  assert.equal(repository.models[0].lifecycle_state, "retired", "missing row changes nothing");
  assert.equal(repository.snapshots.length, 12);
});

test("Gemini lifecycle external-run replay is idempotent", async () => {
  const repository = new MemoryGeminiLifecycleRepository();
  await ingestGeminiLifecycle({ sentinelRepository: sentinel(),
    repository,
    collect: collector([lifecycleRow()], "same-run"),
    now: () => new Date(timestamp),
  });
  const replay = await ingestGeminiLifecycle({ sentinelRepository: sentinel(),
    repository,
    collect: collector([lifecycleRow()], "same-run"),
    now: () => new Date(timestamp),
  });
  assert.equal(replay.idempotent, true);
  assert.equal(repository.snapshots.length, 2);
});

test("Gemini lifecycle ambiguity fails closed and audits the failed run", async () => {
  const repository = new MemoryGeminiLifecycleRepository([
    newModel("model-1", "Gemini 1.5 Pro"),
    newModel("model-2", "gemini-1-5-pro"),
  ]);
  await assert.rejects(() => ingestGeminiLifecycle({ sentinelRepository: sentinel(),
    repository,
    collect: collector([lifecycleRow({ model_id: "gemini-1.5-pro-002" })], "ambiguous"),
    now: () => new Date(timestamp),
  }), /Ambiguous Gemini model identity/);
  assert.equal(repository.runs[0].status, "failed");
});

test("Gemini lifecycle endpoint uses the protected ingestion convention", async () => {
  const previous = process.env.AI_RADAR_INGEST_SECRET;
  process.env.AI_RADAR_INGEST_SECRET = "gemini-secret";
  try {
    const response = await POST(new Request(
      "http://localhost/api/ingest/gemini/lifecycle",
      { method: "POST" },
    ));
    assert.equal(response.status, 401);
    assert.equal(JSON.stringify(await response.json()).includes("gemini-secret"), false);
  } finally {
    if (previous === undefined) delete process.env.AI_RADAR_INGEST_SECRET;
    else process.env.AI_RADAR_INGEST_SECRET = previous;
  }
});
