import assert from "node:assert/strict";
import test from "node:test";

import {
  ingestAnthropicLifecycle,
  type AnthropicLifecyclePipelineRepository,
  type OpenAiCollectorResult,
} from "../../lib/pipeline";
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

const timestamp = "2026-08-17T12:00:00.000Z";
const sourceUrl = "https://platform.claude.com/docs/en/about-claude/model-deprecations";

function lifecycleRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    product_page_url: sourceUrl,
    input: { url: sourceUrl },
    api_model_name: "claude-opus-4-1-20250805",
    current_state: "Active",
    tentative_retirement_date: "Not sooner than August 5, 2027",
    ...overrides,
  };
}

function collector(data: unknown[], runId: string): () => Promise<OpenAiCollectorResult> {
  return async () => ({
    success: true,
    data,
    metadata: {
      collectorId: "c_msxj0fk3153bu9oz7l",
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
    id, provider_id: "provider-anthropic", model_name: modelName,
    display_name: null, metadata: {}, is_active: true, lifecycle_state: null,
    deprecated_on: null, retirement_date: null,
    retirement_not_before_date: null, lifecycle_source_id: null,
    lifecycle_observed_at: null, first_seen_at: timestamp,
    last_seen_at: timestamp, created_at: timestamp, updated_at: timestamp,
  };
}

class MemoryLifecycleRepository implements AnthropicLifecyclePipelineRepository {
  readonly models: ModelRow[] = [newModel("model-1", "Claude Opus 4.1")];
  readonly aliases: ModelAliasRow[] = [];
  readonly runs: CollectionRunRow[] = [];
  readonly snapshots: LifecycleSnapshotRow[] = [];
  readonly events: ChangeEventInput[] = [];
  readonly pricingHistory = [{ id: "price-before" }, { id: "price-current" }];
  validationErrors: Json = [];
  private comparable: LatestLifecycleSnapshotRow[] = [];
  private nextRun = 1;

  async upsertProvider(input: { slug: string; name: string; homepageUrl?: string | null }): Promise<ProviderRow> {
    return {
      id: "provider-anthropic", slug: input.slug, name: input.name,
      homepage_url: input.homepageUrl ?? null, created_at: timestamp, updated_at: timestamp,
    };
  }
  async upsertSource(input: { providerId: string; sourceUrl: string; collectorId?: string | null; label?: string | null }): Promise<SourceRow> {
    return {
      id: "source-lifecycle", provider_id: input.providerId, kind: "models",
      collector_id: input.collectorId ?? null, source_url: input.sourceUrl,
      label: input.label ?? null, is_active: true, created_at: timestamp,
      updated_at: timestamp,
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
    run.status = "failed"; run.completed_at = timestamp; run.error_message = error.message;
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
    run.completed_at = timestamp; run.records_seen = counts.recordsSeen;
    run.records_accepted = counts.recordsAccepted; run.records_rejected = counts.recordsRejected;
    run.validation_errors = validationErrors; this.validationErrors = validationErrors;
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
      if (existing) { existing.last_seen_at = input.seenAt ?? timestamp; return existing; }
      const alias: ModelAliasRow = {
        id: `alias-${this.aliases.length + 1}`, provider_id: input.providerId,
        model_id: input.modelId, source_id: input.sourceId ?? null,
        alias: input.alias, alias_type: input.aliasType,
        first_seen_at: input.seenAt ?? timestamp, last_seen_at: input.seenAt ?? timestamp,
        created_at: timestamp, updated_at: timestamp,
      };
      this.aliases.push(alias);
      return alias;
    });
  }
  async getComparableLifecycleSnapshots(): Promise<LatestLifecycleSnapshotRow[]> {
    return this.comparable;
  }
  async saveLifecycleSnapshots(inputs: readonly LifecycleSnapshotInput[]): Promise<LifecycleSnapshotRow[]> {
    return inputs.map((input) => {
      const existing = this.snapshots.find((row) => row.run_id === input.runId && row.api_model_id === input.apiModelId);
      if (existing) return existing;
      const row: LifecycleSnapshotRow = {
        id: `lifecycle-${this.snapshots.length + 1}`, run_id: input.runId,
        source_id: input.sourceId, provider_id: input.providerId,
        model_id: input.modelId, api_model_id: input.apiModelId,
        lifecycle_state: input.lifecycleState, deprecated_on: input.deprecatedOn ?? null,
        retirement_date: input.retirementDate ?? null,
        retirement_not_before_date: input.retirementNotBeforeDate ?? null,
        source_url: input.sourceUrl, raw: input.raw ?? null,
        observed_at: input.observedAt, created_at: timestamp, content_hash: "hash",
      };
      this.snapshots.push(row);
      return row;
    });
  }
  async applyModelLifecycleProjections(inputs: readonly ModelLifecycleProjectionInput[]): Promise<ModelRow[]> {
    return inputs.map((input) => {
      const model = this.models.find((candidate) => candidate.id === input.modelId);
      if (!model) throw new Error("missing model");
      // Applies the production patch, so the fake cannot drift from the real
      // "an unpublished date is omitted, not nulled" projection semantics.
      Object.assign(model, modelLifecycleProjectionPatch(input));
      return model;
    });
  }
  async saveChangeEvents(inputs: readonly ChangeEventInput[]): Promise<unknown[]> {
    const keys = new Set(this.events.map((event) => JSON.stringify([
      event.runId, event.modelId, event.changeType, event.fieldName,
    ])));
    inputs.forEach((input) => {
      const key = JSON.stringify([input.runId, input.modelId, input.changeType, input.fieldName]);
      if (!keys.has(key)) { this.events.push(input); keys.add(key); }
    });
    return [...inputs];
  }
  private asLatest(row: LifecycleSnapshotRow): LatestLifecycleSnapshotRow {
    return {
      ...row,
      model_name: this.models.find((model) => model.id === row.model_id)?.model_name ?? "unknown",
      provider_slug: "anthropic",
      provider_name: "Anthropic",
    };
  }
  private requireRun(id: string): CollectionRunRow {
    const run = this.runs.find((candidate) => candidate.id === id);
    if (!run) throw new Error("missing run");
    return run;
  }
}

test("authoritative transitions emit once, preserve history, and never delete pricing", async () => {
  const repository = new MemoryLifecycleRepository();
  const active = lifecycleRow();
  const first = await ingestAnthropicLifecycle({
    repository, collect: collector([active], "external-1"), now: () => new Date(timestamp),
  });
  assert.equal(first.changesDetected, 0);
  assert.equal(repository.models.length, 1);
  assert.equal(repository.models[0].model_name, "Claude Opus 4.1");
  assert.equal(repository.models[0].lifecycle_state, "active");

  const deprecated = lifecycleRow({ current_state: "Deprecated", deprecated_date: "August 17, 2026" });
  const transition = await ingestAnthropicLifecycle({
    repository, collect: collector([deprecated], "external-2"), now: () => new Date(timestamp),
  });
  assert.equal(transition.changesDetected, 2);
  assert(repository.events.some((event) =>
    event.changeType === "lifecycle_changed" &&
    event.fieldName === "lifecycleState" &&
    event.oldValue === "active" && event.newValue === "deprecated"));

  const repeated = await ingestAnthropicLifecycle({
    repository, collect: collector([deprecated], "external-3"), now: () => new Date(timestamp),
  });
  assert.equal(repeated.changesDetected, 0);

  const retired = lifecycleRow({
    current_state: "Retired",
    deprecated_date: "August 17, 2026",
    tentative_retirement_date: "December 17, 2026",
  });
  await ingestAnthropicLifecycle({
    repository, collect: collector([retired], "external-4"), now: () => new Date(timestamp),
  });
  assert.equal(repository.models[0].lifecycle_state, "retired");
  assert.equal(repository.models[0].is_active, false);
  assert.equal(repository.snapshots.length, 4);
  assert.equal(repository.pricingHistory.length, 2);

  await ingestAnthropicLifecycle({
    repository, collect: collector([], "external-5"), now: () => new Date(timestamp),
  });
  assert.equal(repository.models[0].lifecycle_state, "retired");
  assert.equal(repository.snapshots.length, 4);
});

test("malformed lifecycle records are rejected and audited without invented state", async () => {
  const repository = new MemoryLifecycleRepository();
  const result = await ingestAnthropicLifecycle({
    repository,
    collect: collector([lifecycleRow(), lifecycleRow({ current_state: "Inactive" })], "external-partial"),
    now: () => new Date(timestamp),
  });
  assert.equal(result.acceptedCount, 1);
  assert.equal(result.rejectedCount, 1);
  assert.equal(repository.runs[0].status, "partial");
  assert(Array.isArray(repository.validationErrors));
});

test("a scrape that stops publishing a date does not erase the stored one", async () => {
  const repository = new MemoryLifecycleRepository();
  const deprecated = lifecycleRow({
    current_state: "Deprecated",
    deprecated_date: "August 17, 2026",
    tentative_retirement_date: "Not sooner than August 5, 2027",
  });
  await ingestAnthropicLifecycle({
    repository, collect: collector([deprecated], "external-1"), now: () => new Date(timestamp),
  });
  assert.equal(repository.models[0].deprecated_on, "2026-08-17");
  assert.equal(repository.models[0].retirement_not_before_date, "2027-08-05");

  // A page-layout regression drops both date columns. The state is still
  // authoritative, but the missing dates are silence, not a retraction.
  const withoutDates = lifecycleRow({ current_state: "Deprecated" });
  delete (withoutDates as Record<string, unknown>).tentative_retirement_date;
  await ingestAnthropicLifecycle({
    repository, collect: collector([withoutDates], "external-2"), now: () => new Date(timestamp),
  });
  assert.equal(repository.models[0].lifecycle_state, "deprecated");
  assert.equal(repository.models[0].deprecated_on, "2026-08-17", "deprecation date survived");
  assert.equal(
    repository.models[0].retirement_not_before_date,
    "2027-08-05",
    "retirement lower bound survived",
  );

  // An explicit exact date still replaces the lower bound, as a pair, so the
  // mutually exclusive check constraint can never see both set.
  const exact = lifecycleRow({
    current_state: "Retired",
    deprecated_date: "August 17, 2026",
    tentative_retirement_date: "December 17, 2026",
  });
  await ingestAnthropicLifecycle({
    repository, collect: collector([exact], "external-3"), now: () => new Date(timestamp),
  });
  assert.equal(repository.models[0].retirement_date, "2026-12-17");
  assert.equal(repository.models[0].retirement_not_before_date, null);
  assert.equal(repository.models[0].is_active, false);
});

test("legacy and deprecated states leave a model available", async () => {
  for (const state of ["Active", "Legacy", "Deprecated"] as const) {
    const repository = new MemoryLifecycleRepository();
    await ingestAnthropicLifecycle({
      repository,
      collect: collector([lifecycleRow({ current_state: state })], `external-${state}`),
      now: () => new Date(timestamp),
    });
    assert.equal(repository.models[0].lifecycle_state, state.toLowerCase());
    assert.equal(repository.models[0].is_active, true, `${state} must stay available`);
  }
});
