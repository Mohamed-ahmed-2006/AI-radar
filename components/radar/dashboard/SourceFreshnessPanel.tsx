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
  const scheduled = expectedIntervalMinutes !== null;
  const pct = stalenessPercent(stalenessMinutes, expectedIntervalMinutes);
  const barColor =
    status === "healthy"
      ? "bg-radar-signal"
      : status === "degraded"
        ? "bg-radar-warn"
        : status === "unknown"
          ? "bg-radar-muted"
          : "bg-radar-danger";

  // A source that is not on the fleet schedule has no window to be a
  // percentage of, so the meter reports no value rather than reporting zero.
  return (
    <div
      className="mt-1.5"
      role="meter"
      aria-valuenow={scheduled ? pct : undefined}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-1 w-full rounded-full bg-radar-surface-raised overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: scheduled ? `${pct}%` : "100%" }}
        />
      </div>
      <span className="sr-only">
        {!scheduled
          ? "Collected on demand, not on a fleet schedule"
          : status === "unknown"
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
                    {/*
                      The badge names the source's health, which is what
                      `status` carries. It used to read "Stale" — a claim about
                      freshness — so a source that had just collected but whose
                      last run was partial was labelled stale next to its own
                      "28m / 720m". Staleness is the number beside it.
                    */}
                    {source.status === "degraded" && (
                      <Badge variant="warning">Degraded</Badge>
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
                    {source.expectedIntervalMinutes !== null
                      ? `${source.stalenessMinutes ?? "—"}m / ${source.expectedIntervalMinutes}m`
                      : source.stalenessMinutes !== null
                        ? `${source.stalenessMinutes}m · on demand`
                        : "never collected"}
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
