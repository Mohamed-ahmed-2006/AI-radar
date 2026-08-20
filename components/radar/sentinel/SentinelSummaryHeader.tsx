import { StatCard } from "../ui/StatCard";
import { formatAbsoluteTime } from "../utils";
import { SentinelStatusBadge } from "./SentinelStatusBadge";
import type { SentinelStatus, SentinelSummaryView } from "./types";
import { sentinelStatusLabel, sentinelStatusSeverity } from "./utils";

const fleetOrder: SentinelStatus[] = [
  "healthy",
  "recovered",
  "healing",
  "degraded",
  "quarantined",
  "needs_review",
];

const fleetColor: Record<SentinelStatus, string> = {
  healthy: "bg-radar-signal",
  recovered: "bg-radar-signal/60",
  healing: "bg-radar-info",
  degraded: "bg-radar-warn",
  quarantined: "bg-radar-danger",
  needs_review: "bg-radar-danger/60",
};

function fleetStatus(summary: SentinelSummaryView): SentinelStatus {
  return fleetOrder.reduce<SentinelStatus>(
    (worst, status) =>
      summary.statusCounts[status] > 0 &&
      sentinelStatusSeverity(status) > sentinelStatusSeverity(worst)
        ? status
        : worst,
    "healthy",
  );
}

function headline(summary: SentinelSummaryView): string {
  if (summary.totalSources === 0) return "No sources monitored";
  const attention =
    summary.quarantinedSources +
    summary.degradedSources +
    summary.needsReviewSources +
    summary.healingSources;
  if (attention === 0) {
    return summary.statusCounts.recovered > 0
      ? "All sources trusted again"
      : "All sources healthy";
  }
  return `${attention} of ${summary.totalSources} sources need attention`;
}

function headlineTone(summary: SentinelSummaryView): string {
  if (summary.quarantinedSources > 0 || summary.needsReviewSources > 0) {
    return "text-radar-danger";
  }
  if (summary.degradedSources > 0 || summary.healingSources > 0) {
    return "text-radar-warn";
  }
  if (summary.totalSources === 0) return "text-radar-text-secondary";
  return "text-radar-signal";
}

interface SentinelSummaryHeaderProps {
  summary: SentinelSummaryView;
}

/** Fleet-level verdict: the first thing a viewer should read on the page. */
export function SentinelSummaryHeader({ summary }: SentinelSummaryHeaderProps) {
  const segments = fleetOrder
    .map((status) => ({ status, count: summary.statusCounts[status] }))
    .filter((segment) => segment.count > 0);

  return (
    <section className="radar-sentinel-hero" aria-label="Source health summary">
      <div className="radar-verdict">
        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] uppercase tracking-[0.08em] text-radar-text-muted">
              Fleet verdict
            </p>
            <SentinelStatusBadge status={fleetStatus(summary)} />
          </div>
          <p className={`radar-verdict-headline mt-2 ${headlineTone(summary)}`}>
            {headline(summary)}
          </p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-radar-text-muted">
            Sentinel validates every collection run before it reaches the read
            model. Rejected snapshots are quarantined so the dashboard keeps
            serving the last trusted state.
          </p>
        </div>

        <div>
          <div
            className="radar-fleet-bar"
            role="img"
            aria-label={
              segments.length === 0
                ? "No sources monitored"
                : segments
                    .map(
                      (segment) =>
                        `${segment.count} ${sentinelStatusLabel(segment.status).toLowerCase()}`,
                    )
                    .join(", ")
            }
          >
            {segments.map((segment) => (
              <span
                key={segment.status}
                className={`radar-fleet-seg ${fleetColor[segment.status]}`}
                style={{
                  width: `${(segment.count / summary.totalSources) * 100}%`,
                }}
              />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {segments.map((segment) => (
              <li
                key={segment.status}
                className="flex items-center gap-1.5 text-[10px] text-radar-text-secondary"
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${fleetColor[segment.status]}`}
                  aria-hidden="true"
                />
                <span className="tabular-nums">{segment.count}</span>
                <span className="text-radar-text-muted">
                  {sentinelStatusLabel(segment.status)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/*
        Two horizons, labelled as such. Everything in the first group is the
        state of the fleet right now; everything in the second already
        happened. Mixing them is what let "Open incidents: 0" sit beside
        "1 healing attempt" as though they described the same moment.
      */}
      <p className="radar-kpi-group-label">Current state</p>
      <dl className="radar-sentinel-stats">
        <StatCard label="Sources monitored" value={summary.totalSources} />
        <StatCard label="Providers" value={summary.providers} />
        <StatCard
          label="Operational"
          value={summary.operationalSources}
          status={
            summary.operationalSources === summary.totalSources
              ? "positive"
              : "neutral"
          }
          hint={
            summary.totalSources > 0
              ? `of ${summary.totalSources} · serving trusted data`
              : undefined
          }
        />
        <StatCard
          label="Healthy"
          value={summary.healthySources}
          status="neutral"
          hint="never broke"
        />
        <StatCard
          label="Recovered"
          value={summary.recoveredSources}
          status={summary.recoveredSources > 0 ? "positive" : "neutral"}
          hint="repaired and re-validated"
        />
        <StatCard
          label="Degraded"
          value={summary.degradedSources}
          status={summary.degradedSources > 0 ? "warning" : "neutral"}
        />
        <StatCard
          label="Quarantined"
          value={summary.quarantinedSources}
          status={summary.quarantinedSources > 0 ? "negative" : "neutral"}
          hint={
            summary.needsReviewSources > 0
              ? `${summary.needsReviewSources} need review`
              : undefined
          }
        />
        <StatCard
          label="Open incidents"
          value={summary.openIncidents}
          status={summary.openIncidents > 0 ? "warning" : "neutral"}
          hint={summary.openIncidents === 0 ? "none active" : "active now"}
        />
      </dl>

      <p className="radar-kpi-group-label">History</p>
      <dl className="radar-sentinel-stats">
        <StatCard
          label="Resolved incidents"
          value={summary.resolvedIncidents}
          hint="closed out"
        />
        <StatCard
          label="Healing attempts"
          value={summary.healingAttempts}
          hint="recorded to date"
        />
        <StatCard
          label="Records protected"
          value={
            summary.recordsProtected === null
              ? "—"
              : summary.recordsProtected.toLocaleString("en-US")
          }
          hint={
            summary.lastRunAt
              ? formatAbsoluteTime(summary.lastRunAt)
              : "no completed runs"
          }
        />
      </dl>
    </section>
  );
}
