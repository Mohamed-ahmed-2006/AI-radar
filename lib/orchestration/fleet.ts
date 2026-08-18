/**
 * Fleet execution: run every configured source that is due, in isolation.
 */

import { randomUUID } from "node:crypto";

import type { SentinelHealer, SentinelRepository } from "../sentinel";
import { listCollectionSources } from "./registry";
import type { OrchestrationRepository } from "./repository";
import { SCHEDULER_TICK } from "./schedule";
import { runCollectionSource } from "./runner";
import type {
  CollectionSourceDefinition,
  CollectionSourceKey,
  FleetRunResult,
  FleetRunStatus,
  SourceRunResult,
} from "./types";

export interface RunCollectionFleetOptions {
  trigger?: string;
  /** Stable per scheduler delivery; a replay of the same id is a no-op. */
  invocationId?: string;
  /** Restrict the run to these sources. Defaults to the whole registry. */
  sourceKeys?: readonly CollectionSourceKey[];
  /** Registry override, for tests and for future dynamic source sets. */
  sources?: readonly CollectionSourceDefinition[];
  force?: boolean;
  repository?: OrchestrationRepository;
  sentinelRepository?: SentinelRepository;
  healer?: SentinelHealer;
  autoHealOverride?: boolean;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Cron deliveries can be retried. Deriving the id from the tick window means a
 * redelivery inside the same window collapses onto the same invocation instead
 * of collecting twice.
 */
export function deriveInvocationId(trigger: string, now: Date, windowMinutes: number): string {
  if (trigger !== "cron") return `${trigger}-${randomUUID()}`;
  const windowMs = Math.max(1, windowMinutes) * 60_000;
  const window = new Date(Math.floor(now.getTime() / windowMs) * windowMs).toISOString();
  return `cron-${window}`;
}

function deriveFleetStatus(results: readonly SourceRunResult[]): FleetRunStatus {
  const executed = results.filter((result) => result.status !== "skipped");
  if (executed.length === 0) return "noop";
  const succeeded = executed.filter((result) => result.status === "succeeded").length;
  if (succeeded === executed.length) return "completed";
  return succeeded === 0 ? "failed" : "partial";
}

/**
 * Sources run sequentially and each one is fully isolated: a thrown error, a
 * quarantine or a timeout in one source can never abort, mask or roll back the
 * sources around it.
 */
export async function runCollectionFleet(
  options: RunCollectionFleetOptions = {},
): Promise<FleetRunResult> {
  const now = options.now ?? (() => new Date());
  const trigger = options.trigger ?? "cron";
  const startedAtDate = now();
  const startedAt = startedAtDate.toISOString();
  const startedMs = Date.now();
  const invocationId =
    options.invocationId ??
    deriveInvocationId(trigger, startedAtDate, SCHEDULER_TICK.intervalMinutes);

  const registry = options.sources ?? listCollectionSources();
  const selected = options.sourceKeys
    ? registry.filter((source) => options.sourceKeys?.includes(source.key))
    : registry;

  const results: SourceRunResult[] = [];
  for (const source of selected) {
    try {
      results.push(
        await runCollectionSource(source, {
          invocationId,
          trigger,
          force: options.force,
          repository: options.repository,
          sentinelRepository: options.sentinelRepository,
          healer: options.healer,
          autoHealOverride: options.autoHealOverride,
          now: options.now,
          sleep: options.sleep,
        }),
      );
    } catch (thrown) {
      // `runCollectionSource` is written not to throw. If it ever does, the
      // fleet still finishes the remaining sources.
      const completedAt = now().toISOString();
      results.push({
        sourceKey: source.key,
        provider: source.provider,
        providerSlug: source.providerSlug,
        sourceType: source.sourceType,
        status: "failed",
        outcome: "persistence_failed",
        attempts: 0,
        startedAt,
        completedAt,
        durationMs: 0,
        orchestrationRunId: null,
        collectionRunId: null,
        externalRunId: null,
        recordsAccepted: 0,
        recordsRejected: 0,
        changesDetected: 0,
        sentinel: null,
        error: {
          code: "unhandled_source_error",
          message: thrown instanceof Error ? thrown.message : String(thrown),
        },
        nextExpectedRunAt: null,
      });
    }
  }

  return {
    invocationId,
    trigger,
    startedAt,
    completedAt: now().toISOString(),
    durationMs: Math.max(0, Date.now() - startedMs),
    status: deriveFleetStatus(results),
    sources: results,
    summary: {
      total: results.length,
      succeeded: results.filter((result) => result.status === "succeeded").length,
      failed: results.filter((result) => result.status === "failed").length,
      quarantined: results.filter((result) => result.status === "quarantined").length,
      skipped: results.filter((result) => result.status === "skipped").length,
    },
  };
}
