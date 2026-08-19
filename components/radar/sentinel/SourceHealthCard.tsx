import Link from "next/link";
import { StatusDot } from "../ui/StatusDot";
import { formatAbsoluteTime, formatRelativeTime } from "../utils";
import { AnomalyReason } from "./AnomalyReason";
import { LastKnownGoodComparison } from "./LastKnownGoodComparison";
import { RecoveryTimeline } from "./RecoveryTimeline";
import { SentinelStatusBadge } from "./SentinelStatusBadge";
import type { SentinelSourceView } from "./types";
import { healingSummaryLabel, sentinelStatusSeverity } from "./utils";

function accentClass(source: SentinelSourceView): string {
  if (source.status === "quarantined" || source.status === "needs_review") {
    return "radar-source-card-critical";
  }
  if (sentinelStatusSeverity(source.status) >= 2) {
    return "radar-source-card-attention";
  }
  return "";
}

interface SourceHealthCardProps {
  source: SentinelSourceView;
  /** Keeps the grid scannable; the spotlight renders the full record. */
  maxTimelineStages?: number;
}

/** One source, answerable at a glance: state, recency, volume, and why. */
export function SourceHealthCard({
  source,
  maxTimelineStages = 5,
}: SourceHealthCardProps) {
  const stages = source.timeline.slice(-maxTimelineStages);
  const trimmed = source.timeline.length - stages.length;
  const showComparison = source.rejectedCandidate !== null;

  return (
    <article
      className={`radar-source-card ${accentClass(source)}`}
      aria-labelledby={`source-${source.sourceId}-name`}
    >
      <header className="radar-source-card-header">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <StatusDot
              status={source.health}
              pulse={source.status === "healthy"}
            />
            <h3
              id={`source-${source.sourceId}-name`}
              className="radar-source-card-name truncate"
            >
              <Link
                href={`/sources/${encodeURIComponent(source.sourceId)}`}
                className="radar-explorer-model-link"
              >
                {source.name}
              </Link>
            </h3>
          </div>
          <p className="mt-0.5 text-[10px] text-radar-text-muted truncate">
            {source.providerName} · {source.kind}
            {source.collectorId && ` · ${source.collectorId}`}
          </p>
        </div>
        <div className="shrink-0">
          <SentinelStatusBadge status={source.status} />
        </div>
      </header>

      <div className="radar-source-card-body">
        <dl className="radar-metric-row">
          <div className="radar-metric">
            <dt className="radar-metric-label">Records</dt>
            <dd className="radar-metric-value">
              {source.currentRecordCount ?? "—"}
            </dd>
          </div>
          <div className="radar-metric">
            <dt className="radar-metric-label">Last good</dt>
            <dd className="radar-metric-value">
              {source.lastKnownGood?.recordCount ?? "—"}
            </dd>
          </div>
          <div className="radar-metric">
            <dt className="radar-metric-label">Collected</dt>
            <dd className="radar-metric-value">
              {source.lastRunAt ? (
                <time
                  dateTime={source.lastRunAt}
                  title={formatAbsoluteTime(source.lastRunAt)}
                >
                  {formatRelativeTime(source.lastRunAt)}
                </time>
              ) : (
                "never"
              )}
            </dd>
          </div>
        </dl>

        {source.incident && (
          <AnomalyReason incident={source.incident} maxCodes={2} />
        )}

        {showComparison && (
          <LastKnownGoodComparison
            lastKnownGood={source.lastKnownGood}
            candidate={source.rejectedCandidate}
          />
        )}

        <div>
          <p className="text-[10px] uppercase tracking-[0.06em] text-radar-text-muted mb-1.5">
            Timeline
          </p>
          <RecoveryTimeline
            stages={stages}
            label={`${source.name} recovery timeline`}
          />
          {trimmed > 0 && (
            <p className="mt-1.5 text-[10px] text-radar-text-muted">
              + {trimmed} earlier stage{trimmed === 1 ? "" : "s"}
            </p>
          )}
        </div>

        <div className="mt-auto pt-1 flex items-center justify-between gap-2 text-[10px] text-radar-text-muted border-t border-radar-border-subtle">
          <span className="truncate pt-1.5">
            {healingSummaryLabel(source.healing)}
          </span>
          <span className="shrink-0 pt-1.5 radar-page-intro-links">
            <Link
              href={`/sources/${encodeURIComponent(source.sourceId)}`}
              className="radar-inline-link"
            >
              Detail
            </Link>
            {source.sourceUrl && (
              <a
                href={source.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-radar-info hover:underline"
              >
                Origin
                <span className="sr-only">
                  {" "}
                  page for {source.name} (opens in a new tab)
                </span>
              </a>
            )}
          </span>
        </div>
      </div>
    </article>
  );
}
