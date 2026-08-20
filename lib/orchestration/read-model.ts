/**
 * Orchestration status read model.
 *
 * Answers, per configured source: when it last tried, when it last succeeded,
 * when it is next expected, whether it is running right now, what the latest
 * result and duration were — and it reports one source failing without hiding
 * the sources that succeeded.
 *
 * Collector ids and Bright Data credentials never appear here; a boolean says
 * whether a collector is configured and nothing more.
 */

import {
  getSentinelDashboardReadModel,
  type SentinelDashboardReadModel,
} from "../sentinel";
import type { OrchestrationRunRow } from "../supabase/types";
import { listCollectionSources } from "./registry";
import {
  createOrchestrationRepository,
  type OrchestrationRepository,
} from "./repository";
import { SCHEDULER_TICK, computeNextRunAt } from "./schedule";
import type { CollectionSourceDefinition, CollectionSourceKey } from "./types";

export interface OrchestrationRunSummary {
  orchestrationRunId: string;
  status: OrchestrationRunRow["status"];
  outcome: string | null;
  trigger: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  attempts: number;
  recordsAccepted: number;
  recordsRejected: number;
  changesDetected: number;
  collectionRunId: string | null;
  reasonCodes: string[];
  /** Only populated for diagnostic (authorized) reads. */
  errorMessage?: string | null;
}

export interface OrchestrationSourceStatus {
  sourceKey: CollectionSourceKey;
  provider: string;
  providerSlug: string;
  sourceType: string;
  sourceUrl: string;
  enabled: boolean;
  collectorConfigured: boolean;
  schedule: { cadenceMinutes: number; cronHint: string };
  timeoutMs: number;
  maxAttempts: number;
  running: boolean;
  lastAttempt: OrchestrationRunSummary | null;
  lastSuccess: OrchestrationRunSummary | null;
  latestResult: OrchestrationRunSummary | null;
  nextExpectedRunAt: string | null;
  consecutiveFailures: number;
  needsAttention: boolean;
  sentinel: {
    status: string;
    activeIncidentId: string | null;
    reasonCodes: string[];
    healingAttemptCount: number;
    lastKnownGoodCount: number | null;
  } | null;
}

export interface OrchestrationReadModel {
  generatedAt: string;
  scheduler: {
    mechanism: "scheduled-workflow";
    path: string;
    cronExpression: string;
    tickIntervalMinutes: number;
    authorizationRequired: true;
  };
  sources: OrchestrationSourceStatus[];
  summary: {
    totalSources: number;
    enabledSources: number;
    running: number;
    succeeding: number;
    failing: number;
    quarantined: number;
    neverRun: number;
    needsAttention: number;
    lastFleetRunAt: string | null;
    nextExpectedRunAt: string | null;
  };
}

export interface GetOrchestrationReadModelOptions {
  repository?: OrchestrationRepository;
  sources?: readonly CollectionSourceDefinition[];
  /** Injectable so a Sentinel outage cannot take the status endpoint down. */
  loadSentinel?: () => Promise<SentinelDashboardReadModel>;
  /** Include operator-only fields such as raw error messages. */
  includeDiagnostics?: boolean;
  now?: () => Date;
}

function toSummary(
  row: OrchestrationRunRow,
  includeDiagnostics: boolean,
): OrchestrationRunSummary {
  return {
    orchestrationRunId: row.id,
    status: row.status,
    outcome: row.outcome,
    trigger: row.trigger,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    attempts: row.attempt_count,
    recordsAccepted: row.records_accepted,
    recordsRejected: row.records_rejected,
    changesDetected: row.changes_detected,
    collectionRunId: row.collection_run_id,
    reasonCodes: row.reason_codes ?? [],
    ...(includeDiagnostics ? { errorMessage: row.error_message } : {}),
  };
}

function countConsecutiveFailures(runs: readonly OrchestrationRunRow[]): number {
  let count = 0;
  for (const run of runs) {
    if (run.status === "running" || run.status === "skipped") continue;
    if (run.status === "succeeded") break;
    count += 1;
  }
  return count;
}

function matchSentinelSource(
  sentinel: SentinelDashboardReadModel | null,
  source: CollectionSourceDefinition,
): SentinelDashboardReadModel["sources"][number] | null {
  if (!sentinel) return null;
  return (
    sentinel.sources.find((candidate) => candidate.sourceUrl === source.sourceUrl) ??
    sentinel.sources.find(
      (candidate) =>
        candidate.providerSlug === source.providerSlug && candidate.kind === source.sourceKind,
    ) ??
    null
  );
}

export async function getOrchestrationReadModel(
  options: GetOrchestrationReadModelOptions = {},
): Promise<OrchestrationReadModel> {
  const now = options.now ?? (() => new Date());
  const repository = options.repository ?? createOrchestrationRepository();
  const sources = options.sources ?? listCollectionSources();
  const includeDiagnostics = options.includeDiagnostics ?? false;

  const [recentRuns, successfulRuns] = await Promise.all([
    repository.listRecentRuns(),
    repository.listLatestSuccessfulRuns(),
  ]);

  // A Sentinel read failure degrades this payload; it never fails it.
  let sentinel: SentinelDashboardReadModel | null = null;
  try {
    sentinel = await (options.loadSentinel ?? getSentinelDashboardReadModel)();
  } catch {
    sentinel = null;
  }

  const statuses = sources.map((source): OrchestrationSourceStatus => {
    const runs = recentRuns
      .filter((run) => run.source_key === source.key)
      .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
    const lastAttempt = runs[0] ?? null;
    const lastCompleted = runs.find((run) => run.status !== "running") ?? null;
    const lastSuccess =
      successfulRuns.find((run) => run.source_key === source.key) ??
      runs.find((run) => run.status === "succeeded") ??
      null;
    const running = runs.some(
      (run) => run.status === "running" && Date.parse(run.lease_expires_at) > now().getTime(),
    );
    const consecutiveFailures = countConsecutiveFailures(runs);
    const sentinelSource = matchSentinelSource(sentinel, source);

    return {
      sourceKey: source.key,
      provider: source.provider,
      providerSlug: source.providerSlug,
      sourceType: source.sourceType,
      sourceUrl: source.sourceUrl,
      enabled: source.enabled,
      collectorConfigured: source.collectorId.trim().length > 0,
      schedule: source.schedule,
      timeoutMs: source.timeoutMs,
      maxAttempts: source.retry.maxAttempts,
      running,
      lastAttempt: lastAttempt ? toSummary(lastAttempt, includeDiagnostics) : null,
      lastSuccess: lastSuccess ? toSummary(lastSuccess, includeDiagnostics) : null,
      latestResult: lastCompleted ? toSummary(lastCompleted, includeDiagnostics) : null,
      nextExpectedRunAt: source.enabled
        ? computeNextRunAt(lastAttempt?.started_at ?? null, source.schedule.cadenceMinutes)
        : null,
      consecutiveFailures,
      needsAttention:
        consecutiveFailures >= source.failureIsolation.alertAfterConsecutiveFailures ||
        lastCompleted?.status === "quarantined",
      sentinel: sentinelSource
        ? {
            status: sentinelSource.status,
            activeIncidentId: sentinelSource.activeIncident?.id ?? null,
            reasonCodes: sentinelSource.activeIncident?.reasonCodes ?? [],
            healingAttemptCount: sentinelSource.activeIncident?.healingAttemptCount ?? 0,
            lastKnownGoodCount: sentinelSource.lastKnownGoodCount,
          }
        : null,
    };
  });

  const nextExpected = statuses
    .map((status) => status.nextExpectedRunAt)
    .filter((value): value is string => value !== null)
    .sort()[0] ?? null;

  return {
    generatedAt: now().toISOString(),
    scheduler: {
      mechanism: "scheduled-workflow",
      path: SCHEDULER_TICK.path,
      cronExpression: SCHEDULER_TICK.cronExpression,
      tickIntervalMinutes: SCHEDULER_TICK.intervalMinutes,
      authorizationRequired: true,
    },
    sources: statuses,
    summary: {
      totalSources: statuses.length,
      enabledSources: statuses.filter((status) => status.enabled).length,
      running: statuses.filter((status) => status.running).length,
      succeeding: statuses.filter((status) => status.latestResult?.status === "succeeded").length,
      failing: statuses.filter((status) => status.latestResult?.status === "failed").length,
      quarantined: statuses.filter((status) => status.latestResult?.status === "quarantined")
        .length,
      neverRun: statuses.filter((status) => status.lastAttempt === null).length,
      needsAttention: statuses.filter((status) => status.needsAttention).length,
      lastFleetRunAt:
        recentRuns
          .map((run) => run.started_at)
          .sort()
          .at(-1) ?? null,
      nextExpectedRunAt: nextExpected,
    },
  };
}
