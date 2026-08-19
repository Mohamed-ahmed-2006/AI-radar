import Link from "next/link";
import type { SourceFreshness } from "../types";
import { Badge } from "../ui/Badge";
import { EmptyState, LoadingState } from "../ui/DataState";
import { Panel } from "../ui/Panel";
import { StatusDot } from "../ui/StatusDot";
import {
  formatAbsoluteTime,
  formatRelativeTime,
  stalenessPercent,
} from "../utils";

interface SourceFreshnessPanelProps {
  sources: SourceFreshness[];
  loading?: boolean;
}

function FreshnessBar({
  stalenessMinutes,
  expectedIntervalMinutes,
  status,
}: {
  stalenessMinutes: number | null;
  expectedIntervalMinutes: number | null;
  status: SourceFreshness["status"];
}) {
  const pct = stalenessPercent(stalenessMinutes, expectedIntervalMinutes);
  const barColor =
    status === "healthy"
      ? "bg-radar-signal"
      : status === "degraded"
        ? "bg-radar-warn"
        : status === "unknown"
          ? "bg-radar-muted"
          : "bg-radar-danger";

  return (
    <div className="mt-1.5" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-1 w-full rounded-full bg-radar-surface-raised overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="sr-only">
        {status === "unknown"
          ? "Freshness interval unknown"
          : `${pct}% of expected refresh interval elapsed`}
      </span>
    </div>
  );
}

export function SourceFreshnessPanel({
  sources,
  loading,
}: SourceFreshnessPanelProps) {
  return (
    <Panel
      id="sources"
      title="Source freshness"
      subtitle="Collection recency vs expected interval"
      action={
        <span className="radar-page-intro-links">
          <Link href="/sources" className="radar-inline-link">
            Sources
          </Link>
          <Link href="/source-health" className="radar-inline-link">
            Health
          </Link>
        </span>
      }
    >
      {loading ? (
        <LoadingState title="Loading source status…" />
      ) : sources.length === 0 ? (
        <EmptyState
          title="No sources monitored"
          description="Source freshness metrics will appear once collectors are active."
        />
      ) : (
        <ul className="divide-y divide-radar-border-subtle" aria-label="Source freshness">
          {sources.map((source) => (
            <li
              key={source.id}
              className={`py-3 first:pt-0 last:pb-0 ${source.status === "degraded" ? "radar-degraded-row" : ""}`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusDot status={source.status} />
                    <Link
                      href={`/sources/${encodeURIComponent(source.id)}`}
                      className="text-sm text-radar-text-primary truncate radar-explorer-model-link"
                    >
                      {source.label}
                    </Link>
                    {source.status === "degraded" && (
                      <Badge variant="warning">Stale</Badge>
                    )}
                    {source.status === "unknown" && (
                      <Badge variant="muted">Unknown</Badge>
                    )}
                  </div>
                  <p className="text-[10px] text-radar-text-muted mt-0.5">
                    {source.provider} · {source.collectorType}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[10px] font-mono text-radar-text-muted tabular-nums">
                    {source.stalenessMinutes === null || source.expectedIntervalMinutes === null
                      ? "interval not configured"
                      : `${source.stalenessMinutes}m / ${source.expectedIntervalMinutes}m`}
                  </span>
                </div>
              </div>
              <FreshnessBar
                stalenessMinutes={source.stalenessMinutes}
                expectedIntervalMinutes={source.expectedIntervalMinutes}
                status={source.status}
              />
              <div className="flex justify-between mt-1.5 text-[10px] text-radar-text-muted">
                <span>
                  Last success:{" "}
                  <time dateTime={source.lastSuccessAt ?? undefined}>
                    {source.lastSuccessAt
                      ? formatRelativeTime(source.lastSuccessAt)
                      : "never"}
                  </time>
                </span>
                <span>
                  Last attempt:{" "}
                  <time dateTime={source.lastAttemptAt ?? undefined}>
                    {source.lastAttemptAt ? formatAbsoluteTime(source.lastAttemptAt) : "never"}
                  </time>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
