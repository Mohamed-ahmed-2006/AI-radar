import Link from "next/link";
import { formatAbsoluteTime, formatRelativeTime } from "../utils";
import { AnomalyReason } from "./AnomalyReason";
import { LastKnownGoodComparison } from "./LastKnownGoodComparison";
import { RecoveryTimeline } from "./RecoveryTimeline";
import { SentinelStatusBadge } from "./SentinelStatusBadge";
import type { SentinelSourceView } from "./types";
import { formatRecordCount, healingSummaryLabel } from "./utils";

function toneClass(source: SentinelSourceView): string {
  switch (source.status) {
    case "recovered":
    case "healthy":
      return "radar-spotlight-signal";
    case "quarantined":
    case "needs_review":
      return "radar-spotlight-danger";
    default:
      return "radar-spotlight-warn";
  }
}

interface IncidentSpotlightProps {
  source: SentinelSourceView;
}

/**
 * Full-width incident narrative for the source that most needs explaining —
 * the anomaly, the quarantine, the healing attempt, and the outcome.
 */
export function IncidentSpotlight({ source }: IncidentSpotlightProps) {
  const recovered = source.status === "recovered";
  const showComparison =
    source.lastKnownGood !== null || source.rejectedCandidate !== null;

  return (
    <section
      className={`radar-spotlight ${toneClass(source)} ${recovered ? "radar-recovery-sweep" : ""}`}
      aria-labelledby="spotlight-heading"
    >
      <header className="radar-spotlight-header">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.08em] text-radar-text-muted">
            Incident spotlight
          </p>
          <div className="mt-1 flex items-center gap-2.5 flex-wrap">
            <h2 id="spotlight-heading" className="radar-spotlight-title">
              <Link
                href={`/sources/${encodeURIComponent(source.sourceId)}`}
                className="radar-explorer-model-link"
              >
                {source.name}
              </Link>
            </h2>
            <SentinelStatusBadge status={source.status} size="lg" />
          </div>
          <p className="mt-1 text-[11px] text-radar-text-muted">
            {source.providerName} · {source.kind}
            {source.collectorId && (
              <>
                {" · "}
                <span className="font-mono">{source.collectorId}</span>
              </>
            )}
          </p>
        </div>

        <dl className="flex items-start gap-5 shrink-0">
          <div>
            <dt className="radar-metric-label">Records</dt>
            <dd className="text-xl font-semibold tabular-nums text-radar-text-primary leading-tight">
              {source.currentRecordCount ?? "—"}
            </dd>
            <dd className="text-[10px] text-radar-text-muted">
              {formatRecordCount(source.currentRecordCount)} served
            </dd>
          </div>
          <div>
            <dt className="radar-metric-label">Last collection</dt>
            <dd className="text-xl font-semibold tabular-nums text-radar-text-primary leading-tight">
              {source.lastRunAt ? (
                <time dateTime={source.lastRunAt}>
                  {formatRelativeTime(source.lastRunAt)}
                </time>
              ) : (
                "never"
              )}
            </dd>
            <dd className="text-[10px] text-radar-text-muted">
              {source.lastRunAt
                ? formatAbsoluteTime(source.lastRunAt)
                : "no completed run"}
            </dd>
          </div>
        </dl>
      </header>

      <div className="radar-spotlight-body">
        <RecoveryTimeline
          stages={source.timeline}
          wide
          label={`${source.name} incident timeline`}
        />

        <div className="radar-spotlight-split">
          <div className="flex flex-col gap-2 min-w-0">
            <h3 className="text-[10px] uppercase tracking-[0.06em] text-radar-text-muted">
              Why the run was rejected
            </h3>
            <AnomalyReason
              incident={source.incident}
              emptyMessage="Sentinel has no open incident for this source."
            />
          </div>

          {showComparison && (
            <div className="flex flex-col gap-2 min-w-0">
              <h3 className="text-[10px] uppercase tracking-[0.06em] text-radar-text-muted">
                Last-known-good comparison
              </h3>
              <LastKnownGoodComparison
                lastKnownGood={source.lastKnownGood}
                candidate={source.rejectedCandidate}
              />
            </div>
          )}
        </div>

        {source.healing.attempts > 0 && (
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-t border-radar-border-subtle pt-2.5 text-[11px] text-radar-text-secondary">
            <span
              className={
                source.healing.succeeded
                  ? "font-semibold text-radar-signal"
                  : "font-semibold text-radar-warn"
              }
            >
              {healingSummaryLabel(source.healing)}
            </span>
            {source.healing.latestStatus && (
              <span className="text-radar-text-muted">
                Latest attempt: {source.healing.latestStatus.replaceAll("_", " ")}
              </span>
            )}
          </p>
        )}
      </div>
    </section>
  );
}
