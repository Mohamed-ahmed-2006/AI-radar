import { formatAbsoluteTime } from "../utils";
import type { SentinelSnapshotView } from "./types";

function SnapshotSummary({
  snapshot,
  fallbackCaption,
  tone,
}: {
  snapshot: SentinelSnapshotView | null;
  fallbackCaption: string;
  tone: "good" | "bad";
}) {
  const accent =
    tone === "good"
      ? "border-radar-signal/25 bg-radar-signal/5"
      : "border-radar-danger/25 bg-radar-danger/5";
  const captionColor = tone === "good" ? "text-radar-signal" : "text-radar-danger";

  return (
    <div className={`rounded border px-2.5 py-2 min-w-0 ${accent}`}>
      <p
        className={`text-[10px] font-semibold uppercase tracking-wide ${captionColor}`}
      >
        {snapshot?.label ?? fallbackCaption}
      </p>
      {snapshot ? (
        <>
          <p className="mt-1 text-base font-semibold tabular-nums text-radar-text-primary leading-tight">
            {snapshot.recordCount ?? "—"}
            <span className="ml-1 text-[10px] font-normal text-radar-text-muted">
              records
            </span>
          </p>
          {snapshot.invalidCount !== null && (
            <p className="text-[10px] text-radar-text-muted tabular-nums">
              {snapshot.invalidCount} rejected by validation
            </p>
          )}
          {snapshot.runId && (
            <p className="mt-0.5 font-mono text-[10px] text-radar-text-muted truncate">
              {snapshot.runId}
            </p>
          )}
          <p className="mt-0.5 text-[10px] text-radar-text-muted tabular-nums">
            {snapshot.observedAt ? formatAbsoluteTime(snapshot.observedAt) : "—"}
          </p>
        </>
      ) : (
        <p className="mt-1 text-[11px] text-radar-text-muted">
          Not reported by Sentinel
        </p>
      )}
    </div>
  );
}

interface LastKnownGoodComparisonProps {
  lastKnownGood: SentinelSnapshotView | null;
  candidate: SentinelSnapshotView | null;
}

/**
 * The trusted snapshot beside the one Sentinel refused. Sentinel reports these
 * as record counts and timestamps, so that is exactly what is compared here.
 */
export function LastKnownGoodComparison({
  lastKnownGood,
  candidate,
}: LastKnownGoodComparisonProps) {
  const delta =
    lastKnownGood?.recordCount != null && candidate?.recordCount != null
      ? candidate.recordCount - lastKnownGood.recordCount
      : null;

  return (
    // Sized against its own column: the same comparison renders inside a
    // narrow card and inside the wide spotlight panel.
    <div className="@container flex flex-col gap-2">
      <div className="grid grid-cols-1 @sm:grid-cols-2 gap-2">
        <SnapshotSummary
          snapshot={lastKnownGood}
          fallbackCaption="Last-known-good"
          tone="good"
        />
        <SnapshotSummary
          snapshot={candidate}
          fallbackCaption="Rejected candidate"
          tone="bad"
        />
      </div>
      {delta !== null && (
        <p className="text-[10px] text-radar-text-muted tabular-nums">
          Candidate is{" "}
          <span
            className={delta < 0 ? "text-radar-danger" : "text-radar-text-secondary"}
          >
            {delta > 0 ? `+${delta}` : delta}
          </span>{" "}
          records against last-known-good
        </p>
      )}
    </div>
  );
}
