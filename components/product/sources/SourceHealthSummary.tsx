import { StatCard } from "../../radar/ui/StatCard";
import { SentinelStatusBadge } from "../../radar/sentinel/SentinelStatusBadge";
import { StatusDot } from "../../radar/ui/StatusDot";
import { formatAbsoluteTime, formatRelativeTime } from "../../radar/utils";
import type {
  SourceFreshnessState,
  SourceHealthState,
} from "../../../lib/product/source-detail";

function staleness(minutes: number | null): string {
  if (minutes === null) return "unknown";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Current Sentinel state, freshness and volume for one source.
 *
 * Every state is spelled out in words next to the dot, so the health reading
 * never depends on being able to distinguish green from amber.
 */
export function SourceHealthSummary({
  health,
  freshness,
}: {
  health: SourceHealthState;
  freshness: SourceFreshnessState;
}) {
  return (
    <div className="radar-source-detail-health">
      <p className="radar-source-detail-state">
        <StatusDot status={health.health} label={health.statusLabel} size="md" />
        <SentinelStatusBadge status={health.status} />
      </p>

      <dl className="radar-stat-grid">
        <StatCard
          label="Records"
          value={health.recordCount ?? "—"}
          hint={health.recordCount === null ? "Not reported" : "Currently served"}
        />
        <StatCard
          label="Last run"
          value={
            freshness.lastRunAt ? (
              <time dateTime={freshness.lastRunAt} title={formatAbsoluteTime(freshness.lastRunAt)}>
                {formatRelativeTime(freshness.lastRunAt)}
              </time>
            ) : (
              "never"
            )
          }
        />
        <StatCard
          label="Last success"
          value={
            freshness.lastSuccessAt ? (
              <time
                dateTime={freshness.lastSuccessAt}
                title={formatAbsoluteTime(freshness.lastSuccessAt)}
              >
                {formatRelativeTime(freshness.lastSuccessAt)}
              </time>
            ) : (
              "—"
            )
          }
          hint={freshness.lastSuccessAt ? undefined : "No successful run recorded"}
        />
        <StatCard label="Freshness" value={staleness(freshness.stalenessMinutes)} hint="Since last run" />
        <StatCard
          label="Expected interval"
          value={
            freshness.expectedIntervalMinutes === null
              ? "—"
              : `${freshness.expectedIntervalMinutes}m`
          }
          hint={freshness.expectedIntervalMinutes === null ? "Not declared" : undefined}
        />
      </dl>
    </div>
  );
}
