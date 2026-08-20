import { StatCard } from "../../radar/ui/StatCard";
import { Badge } from "../../radar/ui/Badge";
import { SentinelStatusBadge } from "../../radar/sentinel/SentinelStatusBadge";
import { formatAbsoluteTime, formatRelativeTime } from "../../radar/utils";
import type {
  SourceFreshnessState,
  SourceHealthState,
  SourceRecoveryHistoryState,
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
 * The state is named exactly once. The badge already carries a coloured dot and
 * the state in words, so pairing it with a labelled `StatusDot` restated the
 * same verdict twice over — and the dot's screen-reader copy made it three
 * times. Historical recovery is a separate line with its own heading, because
 * "recovered at some point" and "recovered right now" are different claims.
 */
export function SourceHealthSummary({
  health,
  recovery,
  freshness,
}: {
  health: SourceHealthState;
  recovery: SourceRecoveryHistoryState;
  freshness: SourceFreshnessState;
}) {
  return (
    <div className="radar-source-detail-health">
      <p className="radar-source-detail-state">
        <span className="radar-fact-label">Current health</span>
        <SentinelStatusBadge status={health.status} size="lg" />
        {health.openIncident !== null && (
          <Badge variant="critical">Open incident</Badge>
        )}
      </p>

      <p className="radar-source-detail-history">
        {health.openIncident !== null ? (
          <>
            Open since{" "}
            {health.openIncident.openedAt ? (
              <time
                dateTime={health.openIncident.openedAt}
                title={formatAbsoluteTime(health.openIncident.openedAt)}
              >
                {formatRelativeTime(health.openIncident.openedAt)}
              </time>
            ) : (
              "an unrecorded time"
            )}
            .
          </>
        ) : recovery.lastRecoveredAt !== null ? (
          <>
            No open incident. Last recovery{" "}
            <time
              dateTime={recovery.lastRecoveredAt}
              title={formatAbsoluteTime(recovery.lastRecoveredAt)}
            >
              {formatRelativeTime(recovery.lastRecoveredAt)}
            </time>
            {recovery.healingAttempts > 0 && (
              <>
                {" "}
                after {recovery.healingAttempts} healing attempt
                {recovery.healingAttempts === 1 ? "" : "s"}
              </>
            )}
            .
          </>
        ) : (recovery.resolvedIncidents ?? 0) > 0 ? (
          <>
            No open incident. {recovery.resolvedIncidents} resolved incident
            {recovery.resolvedIncidents === 1 ? "" : "s"} on record.
          </>
        ) : (
          <>No incident has ever been raised for this source.</>
        )}
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
