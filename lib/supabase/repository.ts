/**
 * Repository layer for the AI Radar intelligence schema.
 *
 * Every function takes an explicit client so callers choose their privileges:
 * writes need `createSupabaseAdminClient()`, reads work with any client.
 */

import type { PostgrestError } from "@supabase/supabase-js";

import type { SupabaseServerClient } from "./server";
import type {
  CapabilitySnapshotRow,
  ChangeEventRow,
  ChangeType,
  CollectionRunRow,
  Json,
  LatestCapabilitySnapshotRow,
  LatestPricingSnapshotRow,
  LatestLifecycleSnapshotRow,
  LifecycleSnapshotRow,
  LifecycleState,
  ModelAliasRow,
  ModelRow,
  PricingSnapshotRow,
  ProviderRow,
  RunStatus,
  RetirementNotBeforeObservation,
  SourceHealthRow,
  SourceKind,
  SourceRow,
} from "./types";


export class RepositoryError extends Error {
  readonly cause: PostgrestError;

  constructor(operation: string, cause: PostgrestError) {
    super(`${operation} failed: ${cause.message}`);
    this.name = "RepositoryError";
    this.cause = cause;
  }
}

function unwrap<T>(
  operation: string,
  result: { data: T | null; error: PostgrestError | null },
): T {
  if (result.error) throw new RepositoryError(operation, result.error);
  if (result.data === null) {
    throw new Error(`${operation} returned no data`);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// providers & sources
// ---------------------------------------------------------------------------

export interface ProviderInput {
  slug: string;
  name: string;
  homepageUrl?: string | null;
}

export async function upsertProvider(
  db: SupabaseServerClient,
  input: ProviderInput,
): Promise<ProviderRow> {
  return unwrap(
    "upsertProvider",
    await db
      .from("providers")
      .upsert(
        {
          slug: input.slug,
          name: input.name,
          homepage_url: input.homepageUrl ?? null,
        },
        { onConflict: "slug" },
      )
      .select()
      .single(),
  );
}

/** Every registered provider, so a read model can name one without a snapshot. */
export async function listProviders(
  db: SupabaseServerClient,
): Promise<ProviderRow[]> {
  return unwrap("listProviders", await db.from("providers").select());
}

export interface SourceInput {
  providerId: string;
  sourceUrl: string;
  kind?: SourceKind;
  /** Bright Data collector id, kept as provenance. */
  collectorId?: string | null;
  label?: string | null;
  isActive?: boolean;
}

export async function upsertSource(
  db: SupabaseServerClient,
  input: SourceInput,
): Promise<SourceRow> {
  return unwrap(
    "upsertSource",
    await db
      .from("sources")
      .upsert(
        {
          provider_id: input.providerId,
          kind: input.kind ?? "pricing",
          collector_id: input.collectorId ?? null,
          source_url: input.sourceUrl,
          label: input.label ?? null,
          is_active: input.isActive ?? true,
        },
        { onConflict: "provider_id,kind,source_url" },
      )
      .select()
      .single(),
  );
}

export async function getSourceByCollectorId(
  db: SupabaseServerClient,
  collectorId: string,
): Promise<SourceRow | null> {
  const { data, error } = await db
    .from("sources")
    .select()
    .eq("collector_id", collectorId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new RepositoryError("getSourceByCollectorId", error);
  return data;
}

// ---------------------------------------------------------------------------
// models
// ---------------------------------------------------------------------------

export interface ModelInput {
  providerId: string;
  modelName: string;
  displayName?: string | null;
  metadata?: Json;
  /** Defaults to now; pass the run's observation time for consistency. */
  seenAt?: string;
}

export async function upsertModel(
  db: SupabaseServerClient,
  input: ModelInput,
): Promise<ModelRow> {
  const [row] = await upsertModels(db, [input]);
  return row;
}

/** Bulk model upsert. `first_seen_at` is deliberately never overwritten. */
export async function upsertModels(
  db: SupabaseServerClient,
  inputs: readonly ModelInput[],
): Promise<ModelRow[]> {
  if (inputs.length === 0) return [];
  const now = new Date().toISOString();
  return unwrap(
    "upsertModels",
    await db
      .from("models")
      .upsert(
        inputs.map((input) => ({
          provider_id: input.providerId,
          model_name: input.modelName,
          display_name: input.displayName ?? null,
          metadata: input.metadata ?? {},
          last_seen_at: input.seenAt ?? now,
        })),
        { onConflict: "provider_id,model_name" },
      )
      .select(),
  );
}

// Deliberately absent: a "deactivate models missing from this collection"
// helper. Absence from any collector — pricing or otherwise — is not evidence
// about a model's lifecycle. `is_active` and the lifecycle columns are written
// only by `applyModelLifecycleProjections`, from an authoritative source.

export async function listModels(
  db: SupabaseServerClient,
  options: { providerId?: string; activeOnly?: boolean } = {},
): Promise<ModelRow[]> {
  let query = db.from("models").select().order("model_name");
  if (options.providerId) query = query.eq("provider_id", options.providerId);
  if (options.activeOnly) query = query.eq("is_active", true);
  return unwrap("listModels", await query);
}

export interface ModelAliasInput {
  providerId: string;
  modelId: string;
  sourceId?: string | null;
  alias: string;
  aliasType: ModelAliasRow["alias_type"];
  seenAt?: string;
}

export async function listModelAliases(
  db: SupabaseServerClient,
  providerId: string,
): Promise<ModelAliasRow[]> {
  return unwrap(
    "listModelAliases",
    await db.from("model_aliases").select().eq("provider_id", providerId),
  );
}

export async function upsertModelAliases(
  db: SupabaseServerClient,
  inputs: readonly ModelAliasInput[],
): Promise<ModelAliasRow[]> {
  if (inputs.length === 0) return [];
  const now = new Date().toISOString();
  return unwrap(
    "upsertModelAliases",
    await db.from("model_aliases").upsert(
      inputs.map((input) => ({
        provider_id: input.providerId,
        model_id: input.modelId,
        source_id: input.sourceId ?? null,
        alias: input.alias,
        alias_type: input.aliasType,
        last_seen_at: input.seenAt ?? now,
      })),
      { onConflict: "provider_id,alias_type,alias" },
    ).select(),
  );
}

export interface ModelLifecycleProjectionInput {
  modelId: string;
  sourceId: string;
  lifecycleState: LifecycleState | null;
  deprecatedOn: string | null;
  retirementDate: string | null;
  retirementNotBeforeDate: string | null;
  retirementNotBeforeObservation?: RetirementNotBeforeObservation;
  observedAt: string;
}

/**
 * Builds the projection patch. A date the authoritative source did not publish
 * this run is *omitted*, not nulled: a page-layout regression that drops a
 * column must never erase a deprecation date we already trust. A correction is
 * still possible, because any non-null value is written through.
 *
 * The two retirement columns move as a pair. They are mutually exclusive in the
 * schema, so writing only one of them could otherwise leave a stale lower bound
 * next to a new exact date and fail the check constraint.
 */
export function modelLifecycleProjectionPatch(
  input: ModelLifecycleProjectionInput,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    lifecycle_source_id: input.sourceId,
    lifecycle_observed_at: input.observedAt,
    last_seen_at: input.observedAt,
  };
  if (input.lifecycleState !== null) {
    patch.lifecycle_state = input.lifecycleState;
    // Only an explicit retired observation takes a model out of circulation.
    patch.is_active = input.lifecycleState !== "retired";
  }
  if (input.deprecatedOn !== null) patch.deprecated_on = input.deprecatedOn;
  if (input.retirementDate !== null) {
    patch.retirement_date = input.retirementDate;
    patch.retirement_not_before_date = null;
  } else if (
    input.retirementNotBeforeObservation === "date" &&
    input.retirementNotBeforeDate !== null
  ) {
    patch.retirement_date = null;
    patch.retirement_not_before_date = input.retirementNotBeforeDate;
  } else if (input.retirementNotBeforeObservation === "explicitly_unannounced") {
    patch.retirement_not_before_date = null;
  }
  return patch;
}

/** This is the sole repository operation that writes current lifecycle state. */
export async function applyModelLifecycleProjections(
  db: SupabaseServerClient,
  inputs: readonly ModelLifecycleProjectionInput[],
): Promise<ModelRow[]> {
  const rows: ModelRow[] = [];
  for (const input of inputs) {
    rows.push(unwrap(
      "applyModelLifecycleProjections",
      await db
        .from("models")
        .update(modelLifecycleProjectionPatch(input) as never)
        .eq("id", input.modelId)
        .select()
        .single(),
    ));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// collection runs
// ---------------------------------------------------------------------------

export interface StartRunInput {
  sourceId: string;
  /** Bright Data snapshot id. Makes the run itself idempotent when present. */
  externalRunId?: string | null;
  triggeredBy?: string;
}

/**
 * Opens a run. If `externalRunId` was already recorded for this source the
 * existing run is returned instead, so re-delivering a snapshot is safe.
 */
export async function startCollectionRun(
  db: SupabaseServerClient,
  input: StartRunInput,
): Promise<CollectionRunRow> {
  if (input.externalRunId) {
    const { data, error } = await db
      .from("collection_runs")
      .select()
      .eq("source_id", input.sourceId)
      .eq("external_run_id", input.externalRunId)
      .maybeSingle();
    if (error) throw new RepositoryError("startCollectionRun", error);
    if (data) return data;
  }

  return unwrap(
    "startCollectionRun",
    await db
      .from("collection_runs")
      .insert({
        source_id: input.sourceId,
        status: "running",
        external_run_id: input.externalRunId ?? null,
        triggered_by: input.triggeredBy ?? "manual",
        // Both ends of a run must come from one clock. `completed_at` is written
        // by the application, so `started_at` is too: leaving it to the column
        // default would compare the database clock against the application's and
        // fail `collection_runs_completed_after_start` under any negative skew.
        // `orchestration_runs` already supplies its own `started_at` this way.
        started_at: new Date().toISOString(),
      })
      .select()
      .single(),
  );
}

export interface RunCounts {
  recordsSeen: number;
  recordsAccepted: number;
  recordsRejected: number;
}

/**
 * Closes a run. Status defaults to `succeeded`, or `partial` when some records
 * were rejected.
 */
export async function completeCollectionRun(
  db: SupabaseServerClient,
  runId: string,
  counts: RunCounts,
  status?: Extract<RunStatus, "succeeded" | "partial">,
  validationErrors: Json = [],
): Promise<CollectionRunRow> {
  return unwrap(
    "completeCollectionRun",
    await db
      .from("collection_runs")
      .update({
        status: status ?? (counts.recordsRejected > 0 ? "partial" : "succeeded"),
        completed_at: new Date().toISOString(),
        records_seen: counts.recordsSeen,
        records_accepted: counts.recordsAccepted,
        records_rejected: counts.recordsRejected,
        validation_errors: validationErrors,
      })
      .eq("id", runId)
      .select()
      .single(),
  );
}

export async function failCollectionRun(
  db: SupabaseServerClient,
  runId: string,
  error: { message: string; details?: Json },
  counts?: Partial<RunCounts>,
): Promise<CollectionRunRow> {
  return unwrap(
    "failCollectionRun",
    await db
      .from("collection_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: error.message,
        error_details: error.details ?? null,
        ...(counts?.recordsSeen !== undefined && {
          records_seen: counts.recordsSeen,
        }),
        ...(counts?.recordsAccepted !== undefined && {
          records_accepted: counts.recordsAccepted,
        }),
        ...(counts?.recordsRejected !== undefined && {
          records_rejected: counts.recordsRejected,
        }),
      })
      .eq("id", runId)
      .select()
      .single(),
  );
}

/** A collection run without the service-role-only diagnostic columns. */
export type PublicCollectionRunRow = Omit<
  CollectionRunRow,
  "error_details" | "validation_errors"
>;

export async function getLatestRunForSource(
  db: SupabaseServerClient,
  sourceId: string,
): Promise<PublicCollectionRunRow | null> {
  // Explicit column list, not `select *`: `error_details` and
  // `validation_errors` carry collector diagnostics and are not granted to the
  // anon role this client may be using.
  const { data, error } = await db
    .from("collection_runs")
    .select(
      "id, source_id, status, external_run_id, triggered_by, started_at," +
      " completed_at, records_seen, records_accepted, records_rejected," +
      " error_message, created_at",
    )
    .eq("source_id", sourceId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new RepositoryError("getLatestRunForSource", error);
  return data as PublicCollectionRunRow | null;
}

/** Latest run per source, for the scraper-health panel. */
export async function getSourceHealth(
  db: SupabaseServerClient,
): Promise<SourceHealthRow[]> {
  return unwrap("getSourceHealth", await db.from("source_health").select());
}

// ---------------------------------------------------------------------------
// pricing snapshots
// ---------------------------------------------------------------------------

export interface PricingSnapshotInput {
  runId: string;
  sourceId: string;
  providerId: string;
  modelId: string;
  pricingMode?: string;
  contextTier?: string;
  inputPricePer1mTokens?: number | null;
  cachedInputPricePer1mTokens?: number | null;
  cacheWritePricePer1mTokens?: number | null;
  outputPricePer1mTokens?: number | null;
  currency?: string;
  pricingUnit?: string;
  sourceUrl?: string | null;
  /** Priced fields this provider exposes that we do not model as columns. */
  extra?: Json;
  /** Verbatim collector record, for audit. */
  raw?: Json;
  observedAt?: string;
}

export interface LifecycleSnapshotInput {
  runId: string;
  sourceId: string;
  providerId: string;
  modelId: string;
  apiModelId: string;
  lifecycleState: LifecycleState | null;
  deprecatedOn?: string | null;
  retirementDate?: string | null;
  retirementNotBeforeDate?: string | null;
  retirementNotBeforeObservation?: RetirementNotBeforeObservation;
  recommendedReplacement?: string | null;
  recommendedReplacementModelId?: string | null;
  recommendedReplacementObserved?: boolean;
  sourceMetadata?: Json;
  sourceUrl: string;
  raw?: Json;
  observedAt: string;
}

export async function saveLifecycleSnapshots(
  db: SupabaseServerClient,
  inputs: readonly LifecycleSnapshotInput[],
): Promise<LifecycleSnapshotRow[]> {
  if (inputs.length === 0) return [];
  return unwrap(
    "saveLifecycleSnapshots",
    await db.from("lifecycle_snapshots").upsert(
      inputs.map((input) => ({
        run_id: input.runId,
        source_id: input.sourceId,
        provider_id: input.providerId,
        model_id: input.modelId,
        api_model_id: input.apiModelId,
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
        source_url: input.sourceUrl,
        raw: input.raw ?? null,
        observed_at: input.observedAt,
      })),
      { onConflict: "run_id,api_model_id" },
    ).select(),
  );
}

export async function getComparableLifecycleSnapshots(
  db: SupabaseServerClient,
  options: { providerSlug?: string; sourceId?: string } = {},
): Promise<LatestLifecycleSnapshotRow[]> {
  let query = db
    .from("latest_comparable_lifecycle_snapshots")
    .select()
    .order("api_model_id");
  if (options.providerSlug) query = query.eq("provider_slug", options.providerSlug);
  if (options.sourceId) query = query.eq("source_id", options.sourceId);
  return unwrap("getComparableLifecycleSnapshots", await query);
}

export async function getLatestLifecycleSnapshots(
  db: SupabaseServerClient,
  options: { providerSlug?: string; sourceId?: string } = {},
): Promise<LatestLifecycleSnapshotRow[]> {
  let query = db.from("latest_lifecycle_snapshots").select().order("api_model_id");
  if (options.providerSlug) query = query.eq("provider_slug", options.providerSlug);
  if (options.sourceId) query = query.eq("source_id", options.sourceId);
  return unwrap("getLatestLifecycleSnapshots", await query);
}

// ---------------------------------------------------------------------------
// capability snapshots
// ---------------------------------------------------------------------------

export interface CapabilitySnapshotInput {
  runId: string;
  sourceId: string;
  providerId: string;
  modelId: string;
  apiModelId: string;
  displayName?: string | null;
  modelFamily?: string | null;
  modelStage?: string | null;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  supportsVision?: boolean | null;
  supportsToolCalling?: boolean | null;
  inputModalities?: string[];
  outputModalities?: string[];
  supportedFeatures?: string[];
  sourceUrl: string;
  extra?: Json;
  raw?: Json | null;
  observedAt?: string;
}

export async function saveCapabilitySnapshots(
  db: SupabaseServerClient,
  inputs: readonly CapabilitySnapshotInput[],
): Promise<CapabilitySnapshotRow[]> {
  if (inputs.length === 0) return [];
  return unwrap(
    "saveCapabilitySnapshots",
    await db.from("capability_snapshots").upsert(
      inputs.map((input) => ({
        run_id: input.runId,
        source_id: input.sourceId,
        provider_id: input.providerId,
        model_id: input.modelId,
        api_model_id: input.apiModelId,
        display_name: input.displayName ?? null,
        model_family: input.modelFamily ?? null,
        model_stage: input.modelStage ?? null,
        context_window: input.contextWindow ?? null,
        max_output_tokens: input.maxOutputTokens ?? null,
        supports_vision: input.supportsVision ?? null,
        supports_tool_calling: input.supportsToolCalling ?? null,
        input_modalities: input.inputModalities ?? [],
        output_modalities: input.outputModalities ?? [],
        supported_features: input.supportedFeatures ?? [],
        source_url: input.sourceUrl,
        extra: input.extra ?? {},
        raw: input.raw ?? null,
        ...(input.observedAt && { observed_at: input.observedAt }),
      })),
      { onConflict: "run_id,model_id,api_model_id" },
    ).select(),
  );
}

export async function getComparableCapabilitySnapshots(
  db: SupabaseServerClient,
  options: { providerSlug?: string; sourceId?: string } = {},
): Promise<LatestCapabilitySnapshotRow[]> {
  let query = db
    .from("latest_comparable_capability_snapshots")
    .select()
    .order("api_model_id");
  if (options.providerSlug) query = query.eq("provider_slug", options.providerSlug);
  if (options.sourceId) query = query.eq("source_id", options.sourceId);
  return unwrap("getComparableCapabilitySnapshots", await query);
}

export async function getLatestCapabilitySnapshots(
  db: SupabaseServerClient,
  options: { providerSlug?: string; sourceId?: string } = {},
): Promise<LatestCapabilitySnapshotRow[]> {
  let query = db.from("latest_capability_snapshots").select().order("api_model_id");
  if (options.providerSlug) query = query.eq("provider_slug", options.providerSlug);
  if (options.sourceId) query = query.eq("source_id", options.sourceId);
  return unwrap("getLatestCapabilitySnapshots", await query);
}

export async function getCapabilityHistory(
  db: SupabaseServerClient,
  modelId: string,
  options: { limit?: number } = {},
): Promise<CapabilitySnapshotRow[]> {
  const query = db
    .from("capability_snapshots")
    .select()
    .eq("model_id", modelId)
    .order("observed_at", { ascending: false })
    .limit(options.limit ?? 100);
  return unwrap("getCapabilityHistory", await query);
}


export async function savePricingSnapshot(
  db: SupabaseServerClient,
  input: PricingSnapshotInput,
): Promise<PricingSnapshotRow> {
  const [row] = await savePricingSnapshots(db, [input]);
  return row;
}

/**
 * Persists snapshots for a run. Repeating the same run is a no-op: the natural
 * key (run, model, pricing mode, context tier) upserts in place, while a new
 * run always writes new rows so history is preserved.
 */
export async function savePricingSnapshots(
  db: SupabaseServerClient,
  inputs: readonly PricingSnapshotInput[],
): Promise<PricingSnapshotRow[]> {
  if (inputs.length === 0) return [];
  return unwrap(
    "savePricingSnapshots",
    await db
      .from("pricing_snapshots")
      .upsert(
        inputs.map((input) => ({
          run_id: input.runId,
          source_id: input.sourceId,
          provider_id: input.providerId,
          model_id: input.modelId,
          pricing_mode: input.pricingMode ?? "standard",
          context_tier: input.contextTier ?? "default",
          input_price_per_1m_tokens: input.inputPricePer1mTokens ?? null,
          cached_input_price_per_1m_tokens:
            input.cachedInputPricePer1mTokens ?? null,
          cache_write_price_per_1m_tokens:
            input.cacheWritePricePer1mTokens ?? null,
          output_price_per_1m_tokens: input.outputPricePer1mTokens ?? null,
          currency: input.currency ?? "USD",
          pricing_unit: input.pricingUnit ?? "USD per 1M tokens",
          source_url: input.sourceUrl ?? null,
          extra: input.extra ?? {},
          raw: input.raw ?? null,
          ...(input.observedAt && { observed_at: input.observedAt }),
        })),
        { onConflict: "run_id,model_id,pricing_mode,context_tier" },
      )
      .select(),
  );
}

export interface LatestPricingQuery {
  providerSlug?: string;
  sourceId?: string;
  modelIds?: readonly string[];
  pricingMode?: string;
  contextTier?: string;
  limit?: number;
}

/** Current price for every (model, pricing mode, context tier). */
export async function getLatestPricingSnapshots(
  db: SupabaseServerClient,
  options: LatestPricingQuery = {},
): Promise<LatestPricingSnapshotRow[]> {
  let query = db
    .from("latest_pricing_snapshots")
    .select()
    .order("provider_slug")
    .order("model_name");
  if (options.providerSlug) {
    query = query.eq("provider_slug", options.providerSlug);
  }
  if (options.sourceId) query = query.eq("source_id", options.sourceId);
  if (options.modelIds?.length) query = query.in("model_id", options.modelIds);
  if (options.pricingMode) query = query.eq("pricing_mode", options.pricingMode);
  if (options.contextTier) query = query.eq("context_tier", options.contextTier);
  if (options.limit) query = query.limit(options.limit);
  return unwrap("getLatestPricingSnapshots", await query);
}

/**
 * The most recent snapshot for one model variant, excluding an in-flight run.
 * Change detection uses this as the "before" side of a diff.
 */
export async function getLatestPricingSnapshotForModel(
  db: SupabaseServerClient,
  modelId: string,
  options: {
    pricingMode?: string;
    contextTier?: string;
    excludeRunId?: string;
  } = {},
): Promise<PricingSnapshotRow | null> {
  let query = db
    .from("pricing_snapshots")
    .select()
    .eq("model_id", modelId)
    .eq("pricing_mode", options.pricingMode ?? "standard")
    .eq("context_tier", options.contextTier ?? "default")
    .order("observed_at", { ascending: false })
    .limit(1);
  if (options.excludeRunId) query = query.neq("run_id", options.excludeRunId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new RepositoryError("getLatestPricingSnapshotForModel", error);
  return data;
}

/** Full price history for a model, newest first. */
export async function getPricingHistory(
  db: SupabaseServerClient,
  modelId: string,
  options: { pricingMode?: string; contextTier?: string; limit?: number } = {},
): Promise<PricingSnapshotRow[]> {
  let query = db
    .from("pricing_snapshots")
    .select()
    .eq("model_id", modelId)
    .order("observed_at", { ascending: false })
    .limit(options.limit ?? 100);
  if (options.pricingMode) query = query.eq("pricing_mode", options.pricingMode);
  if (options.contextTier) query = query.eq("context_tier", options.contextTier);
  return unwrap("getPricingHistory", await query);
}

// ---------------------------------------------------------------------------
// change events
// ---------------------------------------------------------------------------

export interface ChangeEventInput {
  providerId: string;
  changeType: ChangeType;
  sourceId?: string | null;
  runId?: string | null;
  modelId?: string | null;
  fieldName?: string | null;
  pricingMode?: string | null;
  contextTier?: string | null;
  oldValue?: Json;
  newValue?: Json;
  previousSnapshotId?: string | null;
  currentSnapshotId?: string | null;
  previousLifecycleSnapshotId?: string | null;
  currentLifecycleSnapshotId?: string | null;
  summary?: string | null;
  detectedAt?: string;
}

/**
 * Latest price state from completed runs only. Change detection intentionally
 * excludes failed runs because snapshots can persist before event persistence
 * fails in the current non-transactional ingestion workflow.
 */
export async function getComparablePricingSnapshots(
  db: SupabaseServerClient,
  options: LatestPricingQuery = {},
): Promise<LatestPricingSnapshotRow[]> {
  let query = db
    .from("latest_comparable_pricing_snapshots")
    .select()
    .order("provider_slug")
    .order("model_name");
  if (options.providerSlug) query = query.eq("provider_slug", options.providerSlug);
  if (options.sourceId) query = query.eq("source_id", options.sourceId);
  if (options.modelIds?.length) query = query.in("model_id", options.modelIds);
  if (options.pricingMode) query = query.eq("pricing_mode", options.pricingMode);
  if (options.contextTier) query = query.eq("context_tier", options.contextTier);
  if (options.limit) query = query.limit(options.limit);
  return unwrap("getComparablePricingSnapshots", await query);
}

function changeEventConflictIdentity(input: ChangeEventInput): string {
  return JSON.stringify([
    input.runId ?? null,
    input.modelId ?? null,
    input.changeType,
    input.fieldName ?? null,
    input.pricingMode ?? null,
    input.contextTier ?? null,
  ]);
}

function changeEventSemanticValue(input: ChangeEventInput): string {
  return JSON.stringify({
    providerId: input.providerId,
    sourceId: input.sourceId ?? null,
    runId: input.runId ?? null,
    modelId: input.modelId ?? null,
    changeType: input.changeType,
    fieldName: input.fieldName ?? null,
    pricingMode: input.pricingMode ?? null,
    contextTier: input.contextTier ?? null,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    previousSnapshotId: input.previousSnapshotId ?? null,
    currentSnapshotId: input.currentSnapshotId ?? null,
    previousLifecycleSnapshotId: input.previousLifecycleSnapshotId ?? null,
    currentLifecycleSnapshotId: input.currentLifecycleSnapshotId ?? null,
    summary: input.summary ?? null,
    detectedAt: input.detectedAt ?? null,
  });
}

/**
 * Guarantees a single row for each database conflict identity in an upsert
 * batch. Exact repeats are idempotent; non-identical repeats fail before any
 * database call so tier-specific changes can never be silently discarded.
 */
export function dedupeChangeEventInputs(
  inputs: readonly ChangeEventInput[],
): ChangeEventInput[] {
  const unique = new Map<string, ChangeEventInput>();
  for (const input of inputs) {
    const key = changeEventConflictIdentity(input);
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, input);
      continue;
    }
    if (changeEventSemanticValue(existing) !== changeEventSemanticValue(input)) {
      throw new Error(`Non-identical change events share database identity ${key}`);
    }
  }
  return [...unique.values()];
}

export async function saveChangeEvent(
  db: SupabaseServerClient,
  input: ChangeEventInput,
): Promise<ChangeEventRow> {
  const [row] = await saveChangeEvents(db, [input]);
  return row;
}

/**
 * Persists detected changes. Re-running change detection over the same run
 * upserts rather than duplicating, via the complete event identity including
 * a pricing mode/context tier whenever the event is tier-scoped.
 */
export async function saveChangeEvents(
  db: SupabaseServerClient,
  inputs: readonly ChangeEventInput[],
): Promise<ChangeEventRow[]> {
  const uniqueInputs = dedupeChangeEventInputs(inputs);
  if (uniqueInputs.length === 0) return [];
  return unwrap(
    "saveChangeEvents",
    await db
      .from("change_events")
      .upsert(
        uniqueInputs.map((input) => ({
          provider_id: input.providerId,
          source_id: input.sourceId ?? null,
          run_id: input.runId ?? null,
          model_id: input.modelId ?? null,
          change_type: input.changeType,
          field_name: input.fieldName ?? null,
          pricing_mode: input.pricingMode ?? null,
          context_tier: input.contextTier ?? null,
          old_value: input.oldValue ?? null,
          new_value: input.newValue ?? null,
          previous_snapshot_id: input.previousSnapshotId ?? null,
          current_snapshot_id: input.currentSnapshotId ?? null,
          previous_lifecycle_snapshot_id: input.previousLifecycleSnapshotId ?? null,
          current_lifecycle_snapshot_id: input.currentLifecycleSnapshotId ?? null,
          summary: input.summary ?? null,
          ...(input.detectedAt && { detected_at: input.detectedAt }),
        })),
        {
          onConflict:
            "run_id,model_id,change_type,field_name,pricing_mode,context_tier",
        },
      )
      .select(),
  );
}

export async function getRecentChangeEvents(
  db: SupabaseServerClient,
  options: {
    providerId?: string;
    modelId?: string;
    changeTypes?: readonly ChangeType[];
    since?: string;
    limit?: number;
  } = {},
): Promise<ChangeEventRow[]> {
  let query = db
    .from("change_events")
    .select()
    .order("detected_at", { ascending: false })
    .limit(options.limit ?? 50);
  if (options.providerId) query = query.eq("provider_id", options.providerId);
  if (options.modelId) query = query.eq("model_id", options.modelId);
  if (options.since) query = query.gte("detected_at", options.since);
  if (options.changeTypes?.length) {
    query = query.in("change_type", options.changeTypes);
  }
  return unwrap("getRecentChangeEvents", await query);
}
