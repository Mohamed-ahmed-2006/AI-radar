import type { HealthStatus } from "../types";
import type {
  SentinelHealingView,
  SentinelSourceView,
  SentinelStatus,
  SentinelSummaryView,
} from "./types";

const STATUS_LABELS: Record<SentinelStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  quarantined: "Quarantined",
  healing: "Healing",
  recovered: "Recovered",
  needs_review: "Needs review",
};

export function sentinelStatusLabel(status: SentinelStatus): string {
  return STATUS_LABELS[status];
}

/**
 * How alarming each state is. Drives the fleet verdict, the spotlight choice,
 * and card ordering, so the source needing attention is first on screen.
 */
const STATUS_SEVERITY: Record<SentinelStatus, number> = {
  needs_review: 5,
  quarantined: 4,
  degraded: 3,
  healing: 2,
  recovered: 1,
  healthy: 0,
};

export function sentinelStatusSeverity(status: SentinelStatus): number {
  return STATUS_SEVERITY[status];
}

/** Maps the Sentinel state onto the dashboard-wide health dot vocabulary. */
export function healthForSentinelStatus(status: SentinelStatus): HealthStatus {
  if (status === "healthy" || status === "recovered") return "healthy";
  if (status === "degraded" || status === "healing") return "degraded";
  if (status === "quarantined" || status === "needs_review") return "down";
  return "unknown";
}

export function healingSummaryLabel(healing: SentinelHealingView): string {
  if (healing.attempts === 0) return "No healing attempts";
  if (healing.succeeded) {
    return healing.attempts > 1
      ? `Healed after ${healing.attempts} attempts`
      : "Healed on first attempt";
  }
  return healing.attempts > 1
    ? `${healing.attempts} healing attempts`
    : "Healing attempt in flight";
}

export function sortSentinelSources(
  sources: readonly SentinelSourceView[],
): SentinelSourceView[] {
  return [...sources].sort((left, right) => {
    const bySeverity =
      sentinelStatusSeverity(right.status) - sentinelStatusSeverity(left.status);
    if (bySeverity !== 0) return bySeverity;
    return left.name.localeCompare(right.name);
  });
}

/** The source most worth explaining first, or null when nothing is wrong. */
export function pickSpotlightSourceId(
  sources: readonly SentinelSourceView[],
): string | null {
  const ranked = sortSentinelSources(sources).filter(
    (source) => sentinelStatusSeverity(source.status) > 0,
  );
  return ranked[0]?.sourceId ?? null;
}

/**
 * Counting rules deliberately mirror `getSentinelDashboardReadModel` so the
 * header can never disagree with the backend's own summary.
 */
export function summarizeSentinelSources(
  sources: readonly SentinelSourceView[],
  openIncidents: number,
): SentinelSummaryView {
  const countOf = (status: SentinelStatus) =>
    sources.filter((source) => source.status === status).length;

  const statusCounts: Record<SentinelStatus, number> = {
    healthy: countOf("healthy"),
    degraded: countOf("degraded"),
    quarantined: countOf("quarantined"),
    healing: countOf("healing"),
    recovered: countOf("recovered"),
    needs_review: countOf("needs_review"),
  };

  const counted = sources.filter((source) => source.currentRecordCount !== null);

  return {
    totalSources: sources.length,
    healthySources: statusCounts.healthy + statusCounts.recovered,
    degradedSources: statusCounts.degraded,
    quarantinedSources: statusCounts.quarantined,
    healingSources: statusCounts.healing,
    needsReviewSources: statusCounts.needs_review,
    openIncidents,
    statusCounts,
    providers: new Set(sources.map((source) => source.providerName)).size,
    recordsProtected:
      counted.length === 0
        ? null
        : counted.reduce((total, source) => total + (source.currentRecordCount ?? 0), 0),
    healingAttempts: sources.reduce(
      (total, source) => total + source.healing.attempts,
      0,
    ),
    lastRunAt:
      sources
        .map((source) => source.lastRunAt)
        .filter((value): value is string => value !== null)
        .sort()
        .at(-1) ?? null,
  };
}

export function formatRecordCount(value: number | null): string {
  if (value === null) return "—";
  return `${value.toLocaleString("en-US")} record${value === 1 ? "" : "s"}`;
}
