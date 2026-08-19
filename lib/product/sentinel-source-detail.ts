/**
 * The source-detail adapter backed by the backend that exists today: the
 * Sentinel dashboard read model for state, incidents and healing, plus the
 * `source_health` view for the latest run's validation counts.
 *
 * Nothing here queries anything new and nothing is invented. Where the current
 * backend genuinely cannot answer — per-run history beyond the latest run, or
 * the raw collector payload — the section reports itself unavailable with the
 * reason, which is exactly the seam a richer source-detail API fills in.
 */

import type { SentinelView } from "../../components/radar/sentinel/types";
import { sentinelStatusLabel } from "../../components/radar/sentinel/utils";
import type { SentinelStatus } from "../../components/radar/sentinel/types";
import { provenanceFromSource, type ProvenanceValidationStatus } from "./provenance";
import {
  available,
  registerDefaultSourceDetailAdapter,
  type SourceDetailAdapter,
  type SourceDetailCapabilities,
  type SourceDetailView,
  type SourceDirectory,
  type SourceDirectoryEntry,
  type SourceNormalizationExplainer,
  type SourceNormalizationStage,
  type SourceRunRecord,
  type SourceRunStatus,
  unavailable,
} from "./source-detail";

export const SENTINEL_SOURCE_DETAIL_CAPABILITIES: SourceDetailCapabilities = {
  runHistory: true,
  observedData: true,
  incidents: true,
  healingTimeline: true,
  lastKnownGood: true,
  normalization: true,
  // No current backend exposes the raw Bright Data payload to the UI.
  rawPayload: false,
};

/** The latest-run facts the `source_health` view can answer for one source. */
export interface SentinelLatestRun {
  sourceId: string;
  runId: string | null;
  status: SourceRunStatus | null;
  startedAt: string | null;
  completedAt: string | null;
  recordsSeen: number | null;
  recordsAccepted: number | null;
  recordsRejected: number | null;
  errorMessage: string | null;
  isActive: boolean | null;
}

const NO_RUN_HISTORY_REASON =
  "The current backend exposes only the latest collection run per source. Full per-run validation history is not available yet.";

const DEMO_RUN_HISTORY_REASON =
  "Demo simulation runs entirely in memory, so it has no collection-run records.";

function validationStatusFor(status: SentinelStatus): ProvenanceValidationStatus {
  if (status === "healthy" || status === "recovered") return "passing";
  if (status === "healing") return "unknown";
  return "failing";
}

const CONTRACT_BY_CATEGORY: Record<string, string> = {
  pricing: "NormalizedPricingRecord",
  changelog: "NormalizedLifecycleRecord",
  models: "NormalizedLifecycleRecord",
};

function formatCount(value: number | null): string | null {
  if (value === null) return null;
  return `${value.toLocaleString("en-US")} record${value === 1 ? "" : "s"}`;
}

/**
 * Describes the collect → validate → normalize → gate → persist path this
 * source actually travels, annotated with whatever counts the latest run
 * reported. The stages are the pipeline's real shape; the details are omitted
 * when the backend did not report a figure.
 */
function buildNormalization(
  category: string,
  collectorId: string | null,
  run: SentinelLatestRun | null,
  status: SentinelStatus,
): SourceNormalizationExplainer {
  const stages: SourceNormalizationStage[] = [
    {
      id: "collect",
      label: "Collect",
      description: collectorId
        ? `Bright Data collector ${collectorId} fetches the provider's published page and returns a raw payload.`
        : "The collector fetches the provider's published page and returns a raw payload.",
      detail: formatCount(run?.recordsSeen ?? null),
    },
    {
      id: "validate",
      label: "Validate raw payload",
      description:
        "Each raw record is checked against the provider's schema. Records that fail are held back rather than partially applied.",
      detail:
        run?.recordsRejected === null || run?.recordsRejected === undefined
          ? null
          : `${run.recordsRejected.toLocaleString("en-US")} rejected`,
    },
    {
      id: "normalize",
      label: "Normalize",
      description: CONTRACT_BY_CATEGORY[category]
        ? `Valid records are mapped onto the provider-independent ${CONTRACT_BY_CATEGORY[category]} contract.`
        : "Valid records are mapped onto a provider-independent contract.",
      detail: formatCount(run?.recordsAccepted ?? null),
    },
    {
      id: "gate",
      label: "Sentinel gate",
      description:
        "The normalized batch is evaluated against the source contract. A failing batch is quarantined and the last-known-good snapshot keeps serving.",
      detail: sentinelStatusLabel(status),
    },
    {
      id: "persist",
      label: "Snapshot and diff",
      description:
        "Accepted records are stored as an immutable snapshot and compared with the previous one to emit change events.",
      detail: null,
    },
  ];

  return { contractName: CONTRACT_BY_CATEGORY[category] ?? null, stages };
}

export function buildSourceDirectoryFromSentinel(view: SentinelView): SourceDirectory {
  const entries = view.sources.map<SourceDirectoryEntry>((source) => ({
    sourceId: source.sourceId,
    name: source.name,
    providerName: source.providerName,
    category: source.kind,
    collectorId: source.collectorId,
    status: source.status,
    statusLabel: sentinelStatusLabel(source.status),
    health: source.health,
    lastRunAt: source.lastRunAt,
    stalenessMinutes: source.stalenessMinutes,
    recordCount: source.currentRecordCount,
    hasOpenIncident:
      source.incident !== null &&
      source.incident.status !== "resolved" &&
      source.incident.status !== "dismissed",
  }));

  return {
    entries,
    isDemo: view.isDemo,
    demoScenario: view.demoScenario,
    generatedAt: view.generatedAt,
  };
}

/**
 * Projects one source onto the UI contract. Pure: given the same Sentinel view
 * and run rows it always produces the same detail, which is what lets the
 * screen be tested without a database.
 */
export function buildSourceDetailFromSentinel(
  view: SentinelView,
  sourceId: string,
  runs: readonly SentinelLatestRun[] = [],
): SourceDetailView | null {
  const source = view.sources.find((candidate) => candidate.sourceId === sourceId);
  if (!source) return null;

  const run = runs.find((candidate) => candidate.sourceId === sourceId) ?? null;
  const lastSuccessAt =
    run && run.status === "succeeded" ? run.completedAt : null;

  const runRecord: SourceRunRecord | null = run
    ? {
        id: run.runId ?? `${sourceId}-latest-run`,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        recordsSeen: run.recordsSeen,
        recordsAccepted: run.recordsAccepted,
        recordsRejected: run.recordsRejected,
        errorMessage: run.errorMessage,
      }
    : null;

  const incidents = source.incident ? [source.incident] : [];

  return {
    identity: {
      sourceId: source.sourceId,
      name: source.name,
      providerName: source.providerName,
      providerSlug: null,
      category: source.kind,
      collectorId: source.collectorId,
      sourceUrl: source.sourceUrl,
      isActive: run?.isActive ?? null,
    },
    health: {
      status: source.status,
      statusLabel: sentinelStatusLabel(source.status),
      health: source.health,
      recordCount: source.currentRecordCount,
    },
    freshness: {
      lastRunAt: source.lastRunAt,
      lastSuccessAt,
      stalenessMinutes: source.stalenessMinutes,
      // No source declares an expected collection interval yet.
      expectedIntervalMinutes: null,
    },
    lastKnownGood: source.lastKnownGood
      ? available(source.lastKnownGood)
      : unavailable(
          "No last-known-good snapshot has been recorded for this source yet.",
        ),
    runHistory: runRecord
      ? available([runRecord])
      : unavailable(view.isDemo ? DEMO_RUN_HISTORY_REASON : NO_RUN_HISTORY_REASON),
    observedData:
      run && (run.recordsSeen !== null || run.recordsAccepted !== null)
        ? available({
            observedRecords: run.recordsSeen,
            trustedRecords: run.recordsAccepted,
            rejectedRecords: run.recordsRejected,
          })
        : unavailable(
            "Observed and trusted record counts are reported per collection run; none is available for this source.",
          ),
    incidents:
      incidents.length > 0
        ? available(incidents)
        : unavailable("No Sentinel incident has been raised for this source."),
    healingTimeline:
      source.timeline.length > 0
        ? available(source.timeline)
        : unavailable("Nothing has been recorded for this source yet."),
    normalization: available(
      buildNormalization(source.kind, source.collectorId, run, source.status),
    ),
    provenance: provenanceFromSource({
      sourceLabel: source.name,
      sourceUrl: source.sourceUrl,
      sourceKind: source.kind,
      collectorId: source.collectorId,
      observedAt: source.lastRunAt,
      runId: run?.runId ?? null,
      validation: {
        label: sentinelStatusLabel(source.status),
        status: validationStatusFor(source.status),
      },
      isDemo: view.isDemo,
    }),
    isDemo: view.isDemo,
    demoScenario: view.demoScenario,
    generatedAt: view.generatedAt,
  };
}

export interface SentinelSourceDetailAdapterOptions {
  loadView: () => Promise<SentinelView>;
  loadRuns: () => Promise<SentinelLatestRun[]>;
}

export function createSentinelSourceDetailAdapter(
  options: SentinelSourceDetailAdapterOptions,
): SourceDetailAdapter {
  return {
    id: "sentinel-source-health-v1",
    label: "Sentinel source health",
    capabilities: SENTINEL_SOURCE_DETAIL_CAPABILITIES,
    async listSources() {
      return buildSourceDirectoryFromSentinel(await options.loadView());
    },
    async getSourceDetail(sourceId) {
      const [view, runs] = await Promise.all([options.loadView(), options.loadRuns()]);
      return buildSourceDetailFromSentinel(view, sourceId, runs);
    },
  };
}

registerDefaultSourceDetailAdapter(() =>
  createSentinelSourceDetailAdapter({
    loadView: async () => {
      const { getSentinelView } = await import("../sentinel/ui-data");
      return getSentinelView();
    },
    loadRuns: async () => {
      const { loadSentinelLatestRuns } = await import("./source-runs");
      return loadSentinelLatestRuns();
    },
  }),
);
