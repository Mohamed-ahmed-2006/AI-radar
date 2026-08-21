/**
 * Projects the Sentinel backend contract onto the view model the screen needs.
 *
 * Both producers are pure functions of backend output, so nothing is invented:
 * a field the backend does not expose stays null and the UI says so.
 */

import type { DemoSimulationResult } from "../../../lib/sentinel/demo-simulator";
import { deriveSentinelSeverity } from "../../../lib/sentinel/state-machine";
import type {
  SentinelDashboardReadModel,
  SentinelIncidentView,
  SentinelReasonCode,
  SentinelSnapshotView,
  SentinelSourceView,
  SentinelStageStatus,
  SentinelStatus,
  SentinelTimelineStage,
  SentinelView,
} from "./types";
import { reasonCodeTitle } from "./reason-codes";
import {
  healthForSentinelStatus,
  pickSpotlightSourceId,
  summarizeSentinelSources,
} from "./utils";

type ReadModelSource = SentinelDashboardReadModel["sources"][number];
type ReadModelIncident = SentinelDashboardReadModel["activeIncidents"][number];
type ReadModelHealing = SentinelDashboardReadModel["recentHealingAttempts"][number];

const HEALING_STAGE_STATUS: Record<string, SentinelStageStatus> = {
  initiated: "active",
  in_progress: "active",
  awaiting_approval: "active",
  candidate_validated: "done",
  approved: "done",
  candidate_rejected: "failed",
  rejected: "failed",
  failed: "failed",
  timed_out: "failed",
};

function healingStageStatus(status: string): SentinelStageStatus {
  return HEALING_STAGE_STATUS[status] ?? "active";
}

/** How far through its lifecycle a healing-attempt row has got. */
const HEALING_PROGRESS: Record<string, number> = {
  initiated: 0,
  in_progress: 1,
  awaiting_approval: 2,
  timed_out: 3,
  failed: 3,
  candidate_rejected: 4,
  rejected: 4,
  candidate_validated: 5,
  approved: 6,
};

/**
 * One timeline stage per healing attempt, not one per state row.
 *
 * An attempt writes a row for each state it passes through — initiated,
 * awaiting_approval, approved — all under the same `attemptNumber`. Rendering
 * them verbatim printed "Healing attempt 1" three times on a card that also
 * said "Healed on first attempt".
 */
function collapseAttempts(
  attempts: readonly ReadModelHealing[],
): ReadModelHealing[] {
  const byAttempt = new Map<string, ReadModelHealing>();
  for (const attempt of attempts) {
    const key = `${attempt.incidentId}|${attempt.attemptNumber}`;
    const held = byAttempt.get(key);
    const progress = HEALING_PROGRESS[attempt.status] ?? 0;
    const heldProgress = held ? (HEALING_PROGRESS[held.status] ?? 0) : -1;
    if (
      !held ||
      progress > heldProgress ||
      (progress === heldProgress && attempt.startedAt > held.startedAt)
    ) {
      byAttempt.set(key, attempt);
    }
  }
  return [...byAttempt.values()].sort(
    (left, right) => left.attemptNumber - right.attemptNumber,
  );
}

function humanise(value: string): string {
  const spaced = value.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function reasonSummary(codes: readonly SentinelReasonCode[]): string | undefined {
  if (codes.length === 0) return undefined;
  return codes.map(reasonCodeTitle).join(" · ");
}

/** A quarantined, healing or needs-review source is not serving its last run. */
function isHoldingBack(status: SentinelStatus): boolean {
  return status === "quarantined" || status === "healing" || status === "needs_review";
}

function buildLiveTimeline(
  source: ReadModelSource,
  incident: SentinelIncidentView | null,
  attempts: readonly ReadModelHealing[],
  hasLastKnownGood: boolean,
): SentinelTimelineStage[] {
  const stages: SentinelTimelineStage[] = [];

  if (source.lastRunAt) {
    stages.push({
      id: `${source.sourceId}-run`,
      label: "Collection run",
      detail:
        source.lastRunStatus !== null
          ? `${humanise(source.lastRunStatus)} · ${source.currentRecordCount} records accepted`
          : `${source.currentRecordCount} records accepted`,
      at: source.lastRunAt,
      status: "done",
    });
  }

  if (incident) {
    stages.push({
      id: `${source.sourceId}-anomaly`,
      label: "Anomaly detected",
      detail: reasonSummary(incident.reasonCodes) ?? incident.summary ?? undefined,
      at: incident.createdAt,
      status: "failed",
    });

    if (isHoldingBack(source.status) && (incident.recordsInvalid ?? 0) > 0) {
      stages.push({
        id: `${source.sourceId}-quarantine`,
        label: "Bad snapshot quarantined",
        detail: hasLastKnownGood
          ? `${incident.recordsInvalid} of ${incident.recordsSeen} records held; serving last-known-good`
          : `${incident.recordsInvalid} of ${incident.recordsSeen} records held`,
        at: incident.createdAt,
        status: "done",
      });
    }
  }

  for (const attempt of attempts) {
    stages.push({
      id: `${source.sourceId}-heal-${attempt.id}`,
      label: `Healing attempt ${attempt.attemptNumber}`,
      detail:
        attempt.candidatePassedValidation === true
          ? "Candidate validated against the source contract"
          : humanise(attempt.status),
      at: attempt.startedAt,
      status: healingStageStatus(attempt.status),
    });
  }

  const lastCompleted = attempts
    .map((attempt) => attempt.completedAt)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);

  if (source.status === "recovered") {
    stages.push({
      id: `${source.sourceId}-recovered`,
      label: "Recovered",
      detail: "Validated candidate promoted; quarantine cleared",
      at: lastCompleted ?? source.lastRunAt,
      status: "done",
    });
  } else if (source.status === "needs_review") {
    stages.push({
      id: `${source.sourceId}-review`,
      label: "Needs review",
      detail: "Autonomous healing exhausted its retry budget",
      at: lastCompleted ?? incident?.createdAt ?? source.lastRunAt,
      status: "failed",
    });
  }

  return stages;
}

function toIncidentView(
  source: ReadModelSource,
  detailed: ReadModelIncident | undefined,
): SentinelIncidentView | null {
  if (detailed) {
    return {
      id: detailed.id,
      status: detailed.status,
      severity: detailed.severity,
      reasonCodes: detailed.reasonCodes,
      summary: detailed.summary,
      recordsSeen: detailed.recordsSeen,
      recordsValid: detailed.recordsValid,
      recordsInvalid: detailed.recordsInvalid,
      healingAttemptCount: detailed.healingAttemptCount,
      createdAt: detailed.createdAt,
    };
  }
  // The per-source projection carries less detail; record counts are unknown
  // from it, so they stay null rather than being guessed. `latestIncident` is
  // used deliberately: a recovered source has no active incident but its
  // resolved one is the evidence of what it recovered from. Callers read
  // `incident.status` to tell the two apart.
  const fallback = source.activeIncident ?? source.latestIncident;
  if (!fallback) return null;
  return {
    id: fallback.id,
    status: fallback.status,
    severity: fallback.severity,
    reasonCodes: fallback.reasonCodes,
    summary: null,
    recordsSeen: null,
    recordsValid: null,
    recordsInvalid: null,
    healingAttemptCount: fallback.healingAttemptCount,
    createdAt: fallback.createdAt,
  };
}

export function buildSentinelViewFromReadModel(
  model: SentinelDashboardReadModel,
  generatedAt: string = new Date().toISOString(),
): SentinelView {
  const sources = model.sources.map<SentinelSourceView>((source) => {
    const incident = toIncidentView(
      source,
      model.activeIncidents.find(
        (candidate) => candidate.sourceId === source.sourceId,
      ),
    );
    const attempts = collapseAttempts(
      model.recentHealingAttempts.filter(
        (attempt) => attempt.sourceId === source.sourceId,
      ),
    );
    const latestAttempt = attempts.at(-1) ?? null;

    const lastKnownGood: SentinelSnapshotView | null =
      source.lastKnownGoodCount === null
        ? null
        : {
            label: "Last-known-good",
            runId: null,
            observedAt: source.lastKnownGoodAt,
            recordCount: source.lastKnownGoodCount,
            invalidCount: null,
          };

    const rejectedCandidate: SentinelSnapshotView | null =
      incident && (incident.recordsInvalid ?? 0) > 0
        ? {
            label: isHoldingBack(source.status)
              ? "Quarantined candidate"
              : "Rejected records",
            runId: source.lastRunId,
            observedAt: incident.createdAt,
            recordCount: incident.recordsSeen,
            invalidCount: incident.recordsInvalid,
          }
        : null;

    return {
      sourceId: source.sourceId,
      name: source.label ?? `${source.providerName} ${humanise(source.kind)}`,
      providerName: source.providerName,
      kind: source.kind,
      collectorId: source.collectorId,
      sourceUrl: source.sourceUrl,
      status: source.status,
      health: healthForSentinelStatus(source.status),
      lastRunAt: source.lastRunAt,
      stalenessMinutes: source.stalenessMinutes,
      currentRecordCount: source.currentRecordCount,
      lastRunStatus: source.lastRunStatus,
      lastKnownGood,
      rejectedCandidate,
      incident,
      healing: {
        attempts: incident?.healingAttemptCount ?? attempts.length,
        latestStatus: latestAttempt?.status ?? null,
        succeeded: source.status === "recovered",
      },
      timeline: buildLiveTimeline(source, incident, attempts, lastKnownGood !== null),
    };
  });

  return {
    isDemo: false,
    demoScenario: null,
    generatedAt,
    sources,
    spotlightSourceId: pickSpotlightSourceId(sources),
    summary: summarizeSentinelSources(
      sources,
      model.summary.openIncidents,
      model.summary.resolvedIncidents,
    ),
  };
}

/**
 * Projects the backend's deterministic hero simulation. The simulation runs
 * entirely in memory, so this path needs no database and mutates nothing.
 */
export function buildSentinelViewFromDemo(
  result: DemoSimulationResult,
  generatedAt: string = new Date().toISOString(),
): SentinelView {
  const steps = result.timeline;
  const finalStep = steps.at(-1) ?? null;
  const anomalyStep = steps.find((step) => step.incidentRecorded) ?? null;
  const reasonCodes = (anomalyStep?.incidentReasonCodes ?? []) as SentinelReasonCode[];
  const sourceId = `demo-${result.provider.toLowerCase()}`;

  const incident: SentinelIncidentView | null = anomalyStep
    ? {
        id: `${sourceId}-incident`,
        status: result.finalStatus === "recovered" ? "resolved" : "open",
        severity: deriveSentinelSeverity(reasonCodes),
        reasonCodes,
        summary: anomalyStep.summary,
        recordsSeen: anomalyStep.recordsSeen,
        recordsValid: anomalyStep.recordsAccepted,
        recordsInvalid: anomalyStep.recordsSeen - anomalyStep.recordsAccepted,
        healingAttemptCount: steps.filter((step) => step.healingState).length > 0 ? 1 : 0,
        createdAt: anomalyStep.timestamp,
      }
    : null;

  const source: SentinelSourceView = {
    sourceId,
    name: `${result.provider} Pricing`,
    providerName: result.provider,
    kind: "pricing",
    collectorId: null,
    sourceUrl: null,
    status: result.finalStatus,
    health: healthForSentinelStatus(result.finalStatus),
    lastRunAt: finalStep?.timestamp ?? null,
    stalenessMinutes: null,
    currentRecordCount: finalStep?.recordsAccepted ?? null,
    lastRunStatus: null,
    lastKnownGood:
      finalStep?.lastKnownGoodCount == null
        ? null
        : {
            label: "Last-known-good",
            runId: null,
            observedAt: anomalyStep?.timestamp ?? null,
            recordCount: finalStep.lastKnownGoodCount,
            invalidCount: null,
          },
    rejectedCandidate:
      anomalyStep && anomalyStep.recordsSeen > anomalyStep.recordsAccepted
        ? {
            label: "Quarantined candidate",
            runId: null,
            observedAt: anomalyStep.timestamp,
            recordCount: anomalyStep.recordsSeen,
            invalidCount: anomalyStep.recordsSeen - anomalyStep.recordsAccepted,
          }
        : null,
    incident,
    healing: {
      attempts: steps.filter((step) => step.healingState).length > 0 ? 1 : 0,
      latestStatus: [...steps].reverse().find((step) => step.healingState)?.healingState ?? null,
      succeeded: result.finalStatus === "recovered",
    },
    timeline: steps.map((step) => ({
      id: `${sourceId}-step-${step.step}`,
      label: step.stepName,
      detail: step.summary,
      at: step.timestamp,
      // Only the detection step reads as a failure; the healing steps that
      // follow it are progress, not further breakage.
      status: step.sourceStatus === "quarantined" ? "failed" : "done",
    })),
  };

  return {
    isDemo: true,
    demoScenario: result.scenarioName,
    generatedAt,
    sources: [source],
    spotlightSourceId: sourceId,
    summary: summarizeSentinelSources(
      [source],
      incident && incident.status !== "resolved" ? 1 : 0,
      incident && incident.status === "resolved" ? 1 : 0,
    ),
  };
}
