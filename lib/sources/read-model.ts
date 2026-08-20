/**
 * Source catalog and source-detail read models.
 *
 * One monitored source, explained: what it is, where it comes from, which
 * collector powers it, what contract it must satisfy, how healthy and how fresh
 * it is, what it has run recently, what it broke on, what healing did about it,
 * what it currently asserts, and how a raw observation became a canonical
 * value.
 *
 * Assembly is pure: everything comes from the read port, so the same logic is
 * exercised in tests against in-memory rows and in production against Supabase.
 */

import type {
  LifecycleSnapshotRow,
  PricingSnapshotRow,
  ProviderRow,
  RunStatus,
  SentinelIncidentRow,
  SentinelSourceHealthRow,
  SentinelStatus,
  SourceRow,
} from "../supabase/types";
import { activeSourceRows } from "./active-fleet";
import { resolveSourceCategory, resolveSourceContractView } from "./contract-view";
import {
  createSourceReadPort,
  type PublicCollectionRunRow,
  type PublicHealingAttemptRow,
  type SourceReadPort,
} from "./port";
import { safeSourceUrl, sanitizeText } from "./sanitize";
import {
  buildLifecycleTransformation,
  buildPricingTransformation,
} from "./transformation";
import type {
  RunValidationStatus,
  SourceContractView,
  SourceDetail,
  SourceHealingAttemptView,
  SourceHealthView,
  SourceIdentity,
  SourceIncidentView,
  SourceObservationView,
  SourceRunView,
  SourceSummary,
} from "./types";

export interface SourceReadModelOptions {
  port?: SourceReadPort;
  now?: () => Date;
}

export interface SourceCatalogOptions extends SourceReadModelOptions {
  /**
   * Includes sources that have been deactivated. Off by default: the catalog
   * describes the fleet that is collected now, and a superseded source would
   * otherwise appear alongside the source that replaced it. Its history stays
   * readable through `getSourceDetail`, which is addressed by id and does not
   * filter.
   */
  includeInactive?: boolean;
}

export interface SourceDetailOptions extends SourceReadModelOptions {
  runLimit?: number;
  incidentLimit?: number;
  healingLimit?: number;
  /** How many snapshot rows to pull for observations and history. */
  observationLimit?: number;
}

export interface SourceCatalog {
  generatedAt: string;
  sources: SourceSummary[];
  summary: {
    totalSources: number;
    enabledSources: number;
    healthy: number;
    degraded: number;
    quarantined: number;
    healing: number;
    needsReview: number;
    stale: number;
  };
}

const MINUTE_MS = 60_000;

function minutesBetween(from: string, to: Date): number | null {
  const parsed = Date.parse(from);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, Math.floor((to.getTime() - parsed) / MINUTE_MS));
}

function defaultSourceName(
  providerName: string,
  kind: string,
  category: string,
): string {
  const subject = category === "lifecycle" ? "model lifecycle" : kind;
  return `${providerName} ${subject}`;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

function buildIdentity(source: SourceRow, provider: ProviderRow | null): SourceIdentity {
  const providerSlug = provider?.slug ?? "unknown";
  const providerName = provider?.name ?? providerSlug;
  const category = resolveSourceCategory(
    source.kind,
    providerSlug,
    source.collector_id,
    source.source_url,
  );

  return {
    sourceId: source.id,
    providerId: source.provider_id,
    providerSlug,
    providerName,
    name:
      sanitizeText(source.label, 120) ??
      defaultSourceName(providerName, source.kind, category),
    kind: source.kind,
    category,
    sourceUrl: safeSourceUrl(source.source_url),
    collectorId: source.collector_id,
    enabled: source.is_active,
  };
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/** Sentinel state fallback for a source with no view row (never collected). */
function deriveStatusFromRun(status: RunStatus | null): SentinelStatus {
  if (status === "succeeded") return "healthy";
  if (status === "partial") return "degraded";
  if (status === "failed") return "quarantined";
  return "healthy";
}

interface BuildHealthInput {
  sentinel: SentinelSourceHealthRow | null;
  runs: readonly PublicCollectionRunRow[];
  incidents?: readonly SentinelIncidentRow[];
  contract: SourceContractView | null;
  now: Date;
}

function buildHealthView(input: BuildHealthInput): SourceHealthView {
  const { sentinel, runs, contract, now } = input;
  const lastAttempt = runs[0] ?? null;
  const lastSuccess = runs.find((run) => run.status === "succeeded") ?? null;
  const latestIncident = input.incidents?.[0] ?? null;

  const lastAttemptedRunAt =
    sentinel?.last_run_completed_at ??
    sentinel?.last_run_started_at ??
    lastAttempt?.completed_at ??
    lastAttempt?.started_at ??
    null;
  const lastSuccessfulRunAt = lastSuccess
    ? (lastSuccess.completed_at ?? lastSuccess.started_at)
    : null;

  const maxStalenessMinutes = contract?.freshness.maxStalenessMinutes ?? null;
  const ageMinutes = lastSuccessfulRunAt
    ? minutesBetween(lastSuccessfulRunAt, now)
    : null;

  let freshnessStatus: SourceHealthView["freshness"]["status"] = "unknown";
  if (ageMinutes !== null && maxStalenessMinutes !== null) {
    if (ageMinutes > maxStalenessMinutes) freshnessStatus = "stale";
    else if (ageMinutes > maxStalenessMinutes / 2) freshnessStatus = "aging";
    else freshnessStatus = "fresh";
  }

  const staleAfter =
    lastSuccessfulRunAt && maxStalenessMinutes !== null
      ? new Date(
          Date.parse(lastSuccessfulRunAt) + maxStalenessMinutes * MINUTE_MS,
        ).toISOString()
      : null;

  const activeIncident = sentinel?.active_incident_id
    ? {
        incidentId: sentinel.active_incident_id,
        status: sentinel.active_incident_status ?? "open",
        severity: sentinel.active_incident_severity ?? "warning",
        reasonCodes: sentinel.active_reason_codes ?? [],
        healingAttemptCount: sentinel.healing_attempt_count ?? 0,
        openedAt: latestIncident?.created_at ?? null,
      }
    : null;

  const currentRecordCount =
    sentinel?.last_run_records_accepted ?? lastAttempt?.records_accepted ?? null;

  const expectedRecordCount =
    latestIncident?.expected_count ??
    sentinel?.last_known_good_count ??
    contract?.recordCountDrift.minExpectedCount ??
    null;

  return {
    status:
      sentinel?.sentinel_health_status ??
      deriveStatusFromRun(lastAttempt?.status ?? null),
    freshness: {
      status: freshnessStatus,
      ageMinutes,
      maxStalenessMinutes,
      staleAfter,
    },
    lastAttemptedRunAt,
    lastAttemptedRunId: sentinel?.last_run_id ?? lastAttempt?.id ?? null,
    lastAttemptedRunStatus: sentinel?.last_run_status ?? lastAttempt?.status ?? null,
    lastSuccessfulRunAt,
    lastSuccessfulRunId: lastSuccess?.id ?? null,
    lastKnownGoodRunId: latestIncident?.last_known_good_run_id ?? null,
    lastKnownGoodAt:
      sentinel?.last_known_good_at ?? latestIncident?.last_known_good_at ?? null,
    lastKnownGoodCount:
      sentinel?.last_known_good_count ?? latestIncident?.last_known_good_count ?? null,
    currentRecordCount,
    expectedRecordCount,
    activeIncident,
  };
}

// ---------------------------------------------------------------------------
// Runs, incidents, healing
// ---------------------------------------------------------------------------

export function deriveRunValidationStatus(
  run: Pick<PublicCollectionRunRow, "status" | "records_rejected">,
): RunValidationStatus {
  if (run.status === "running") return "pending";
  if (run.status === "failed") return "failed";
  return run.records_rejected > 0 ? "partial" : "passed";
}

function toRunView(run: PublicCollectionRunRow): SourceRunView {
  const durationMs =
    run.completed_at !== null
      ? Math.max(0, Date.parse(run.completed_at) - Date.parse(run.started_at))
      : null;

  return {
    runId: run.id,
    externalRunId: run.external_run_id,
    status: run.status,
    validationStatus: deriveRunValidationStatus(run),
    triggeredBy: run.triggered_by,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    durationMs: Number.isNaN(durationMs) ? null : durationMs,
    recordsSeen: run.records_seen,
    recordsAccepted: run.records_accepted,
    recordsRejected: run.records_rejected,
    failureReason: sanitizeText(run.error_message),
  };
}

function toIncidentView(incident: SentinelIncidentRow): SourceIncidentView {
  return {
    incidentId: incident.id,
    runId: incident.run_id,
    status: incident.status,
    severity: incident.severity,
    reasonCodes: incident.reason_codes ?? [],
    summary: sanitizeText(incident.summary),
    recordsSeen: incident.records_seen,
    recordsValid: incident.records_valid,
    recordsInvalid: incident.records_invalid,
    expectedCount: incident.expected_count,
    lastKnownGoodCount: incident.last_known_good_count,
    lastKnownGoodRunId: incident.last_known_good_run_id,
    lastKnownGoodAt: incident.last_known_good_at,
    healingAttemptCount: incident.healing_attempt_count,
    // An incident still holding the source out of the canonical tables.
    quarantined:
      incident.status === "open" ||
      incident.status === "healing" ||
      incident.status === "needs_review",
    createdAt: incident.created_at,
    updatedAt: incident.updated_at,
    resolvedAt: incident.resolved_at,
  };
}

export function deriveHealingOutcome(
  status: string,
): SourceHealingAttemptView["outcome"] {
  switch (status) {
    case "initiated":
    case "in_progress":
    case "awaiting_approval":
      return "in_progress";
    case "candidate_validated":
    case "approved":
      return "recovered";
    case "candidate_rejected":
    case "rejected":
      return "rejected";
    case "timed_out":
      return "needs_review";
    default:
      return "failed";
  }
}

function toHealingView(
  attempt: PublicHealingAttemptRow,
): SourceHealingAttemptView {
  return {
    attemptId: attempt.id,
    incidentId: attempt.incident_id,
    attemptNumber: attempt.attempt_number,
    collectorId: attempt.collector_id,
    status: attempt.status,
    refactorJobId: attempt.refactor_job_id,
    candidateRecordsCount: attempt.candidate_records_count,
    candidatePassedValidation: attempt.candidate_passed_validation,
    outcome: deriveHealingOutcome(attempt.status),
    startedAt: attempt.started_at,
    completedAt: attempt.completed_at,
  };
}

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

function pricingObservation(
  snapshot: PricingSnapshotRow,
  modelName: string | null,
): SourceObservationView {
  return {
    snapshotId: snapshot.id,
    runId: snapshot.run_id,
    modelId: snapshot.model_id,
    modelName,
    observedAt: snapshot.observed_at,
    values: {
      pricingMode: snapshot.pricing_mode,
      contextTier: snapshot.context_tier,
      inputPricePer1MTokens: snapshot.input_price_per_1m_tokens,
      cachedInputPricePer1MTokens: snapshot.cached_input_price_per_1m_tokens,
      cacheWritePricePer1MTokens: snapshot.cache_write_price_per_1m_tokens,
      outputPricePer1MTokens: snapshot.output_price_per_1m_tokens,
      currency: snapshot.currency,
      pricingUnit: snapshot.pricing_unit,
    },
  };
}

function lifecycleObservation(
  snapshot: LifecycleSnapshotRow,
  modelName: string | null,
): SourceObservationView {
  return {
    snapshotId: snapshot.id,
    runId: snapshot.run_id,
    modelId: snapshot.model_id,
    modelName,
    observedAt: snapshot.observed_at,
    values: {
      apiModelId: snapshot.api_model_id,
      lifecycleState: snapshot.lifecycle_state,
      deprecatedOn: snapshot.deprecated_on,
      retirementDate: snapshot.retirement_date,
      retirementNotBeforeDate: snapshot.retirement_not_before_date,
      retirementNotBeforeObservation: snapshot.retirement_not_before_observation,
      recommendedReplacement: snapshot.recommended_replacement,
    },
  };
}

/** Newest observation per identity key, preserving input ordering. */
function latestPerKey(
  observations: readonly SourceObservationView[],
  key: (observation: SourceObservationView) => string,
): SourceObservationView[] {
  const seen = new Set<string>();
  const result: SourceObservationView[] = [];
  for (const observation of observations) {
    const identity = key(observation);
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(observation);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export async function getSourceCatalog(
  options: SourceCatalogOptions = {},
): Promise<SourceCatalog> {
  const port = options.port ?? createSourceReadPort();
  const now = (options.now ?? (() => new Date()))();

  const [allSources, providers, sentinelRows, recentRuns] = await Promise.all([
    port.listSources(),
    port.listProviders(),
    port.listSentinelHealth(),
    port.listRecentRuns(),
  ]);

  const sources = options.includeInactive === true ? allSources : activeSourceRows(allSources);

  const providersById = new Map(providers.map((provider) => [provider.id, provider]));
  const sentinelBySource = new Map(sentinelRows.map((row) => [row.source_id, row]));
  const runsBySource = new Map<string, PublicCollectionRunRow[]>();
  for (const run of recentRuns) {
    const bucket = runsBySource.get(run.source_id);
    if (bucket) bucket.push(run);
    else runsBySource.set(run.source_id, [run]);
  }

  const summaries = sources.map((source): SourceSummary => {
    const identity = buildIdentity(source, providersById.get(source.provider_id) ?? null);
    const contract = resolveSourceContractView(
      source.kind,
      identity.providerSlug,
      source.id,
      source.collector_id,
      source.source_url,
    );
    const runs = (runsBySource.get(source.id) ?? [])
      .slice()
      .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));

    return {
      identity,
      health: buildHealthView({
        sentinel: sentinelBySource.get(source.id) ?? null,
        runs,
        contract,
        now,
      }),
      contract,
    };
  });

  summaries.sort((a, b) =>
    a.identity.providerSlug === b.identity.providerSlug
      ? a.identity.name.localeCompare(b.identity.name)
      : a.identity.providerSlug.localeCompare(b.identity.providerSlug),
  );

  const countByStatus = (status: SentinelStatus) =>
    summaries.filter((summary) => summary.health.status === status).length;

  return {
    generatedAt: now.toISOString(),
    sources: summaries,
    summary: {
      totalSources: summaries.length,
      enabledSources: summaries.filter((summary) => summary.identity.enabled).length,
      healthy: countByStatus("healthy") + countByStatus("recovered"),
      degraded: countByStatus("degraded"),
      quarantined: countByStatus("quarantined"),
      healing: countByStatus("healing"),
      needsReview: countByStatus("needs_review"),
      stale: summaries.filter((summary) => summary.health.freshness.status === "stale")
        .length,
    },
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

/** Returns null when no such source exists, so the route can answer 404. */
export async function getSourceDetail(
  sourceId: string,
  options: SourceDetailOptions = {},
): Promise<SourceDetail | null> {
  const port = options.port ?? createSourceReadPort();
  const now = (options.now ?? (() => new Date()))();
  const runLimit = options.runLimit ?? 20;
  const incidentLimit = options.incidentLimit ?? 20;
  const healingLimit = options.healingLimit ?? 20;
  const observationLimit = options.observationLimit ?? 50;

  const source = await port.getSource(sourceId);
  if (!source) return null;

  const [provider, sentinelRows, runs, incidents, healing] = await Promise.all([
    port.getProvider(source.provider_id),
    port.listSentinelHealth(),
    port.listRuns(sourceId, runLimit),
    port.listIncidents(sourceId, incidentLimit),
    port.listHealingAttempts(sourceId, healingLimit),
  ]);

  const identity = buildIdentity(source, provider);
  const contract = resolveSourceContractView(
    source.kind,
    identity.providerSlug,
    source.id,
    source.collector_id,
    source.source_url,
  );

  const isLifecycle = identity.category === "lifecycle";
  const [pricingSnapshots, lifecycleSnapshots] = await Promise.all([
    isLifecycle
      ? Promise.resolve<PricingSnapshotRow[]>([])
      : port.listPricingSnapshots(sourceId, observationLimit),
    isLifecycle
      ? port.listLifecycleSnapshots(sourceId, observationLimit)
      : Promise.resolve<LifecycleSnapshotRow[]>([]),
  ]);

  const modelIds = isLifecycle
    ? lifecycleSnapshots.map((snapshot) => snapshot.model_id)
    : pricingSnapshots.map((snapshot) => snapshot.model_id);
  const models = await port.listModelsByIds(modelIds);
  const modelNamesById = new Map(models.map((model) => [model.id, model.model_name]));

  const history = isLifecycle
    ? lifecycleSnapshots.map((snapshot) =>
        lifecycleObservation(snapshot, modelNamesById.get(snapshot.model_id) ?? null),
      )
    : pricingSnapshots.map((snapshot) =>
        pricingObservation(snapshot, modelNamesById.get(snapshot.model_id) ?? null),
      );

  const observations = isLifecycle
    ? latestPerKey(
        history,
        (observation) =>
          `${observation.modelId}|${String(observation.values.apiModelId ?? "")}`,
      )
    : latestPerKey(
        history,
        (observation) =>
          `${observation.modelId}|${String(observation.values.pricingMode ?? "")}|${String(
            observation.values.contextTier ?? "",
          )}`,
      );

  const newestPricing = pricingSnapshots[0] ?? null;
  const newestLifecycle = lifecycleSnapshots[0] ?? null;
  const transformation = isLifecycle
    ? newestLifecycle
      ? buildLifecycleTransformation(
          newestLifecycle,
          modelNamesById.get(newestLifecycle.model_id) ?? null,
        )
      : null
    : newestPricing
      ? buildPricingTransformation(
          newestPricing,
          modelNamesById.get(newestPricing.model_id) ?? null,
        )
      : null;

  return {
    generatedAt: now.toISOString(),
    identity,
    contract,
    health: buildHealthView({
      sentinel: sentinelRows.find((row) => row.source_id === sourceId) ?? null,
      runs,
      incidents,
      contract,
      now,
    }),
    runs: runs.map(toRunView),
    incidents: incidents.map(toIncidentView),
    healing: healing.map(toHealingView),
    observations,
    history,
    transformation,
    counts: {
      runs: runs.length,
      incidents: incidents.length,
      healingAttempts: healing.length,
      observations: observations.length,
    },
  };
}
