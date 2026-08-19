import { formatDuration, formatRelativeTime } from "../utils";
import type { SentinelStageStatus, SentinelTimelineStage } from "./types";

const nodeClass: Record<SentinelStageStatus, string> = {
  done: "radar-rail-node-done",
  failed: "radar-rail-node-failed",
  active: "radar-rail-node-active",
  pending: "radar-rail-node-pending",
};

const stageAnnouncement: Record<SentinelStageStatus, string> = {
  done: "completed",
  failed: "failed",
  active: "in progress",
  pending: "not started",
};

interface RecoveryTimelineProps {
  stages: SentinelTimelineStage[];
  /** Lays the rail out horizontally from 1024px up. Use for the spotlight. */
  wide?: boolean;
  label?: string;
}

/** The anomaly → quarantine → healing → recovery sequence for one source. */
export function RecoveryTimeline({
  stages,
  wide = false,
  label = "Recovery timeline",
}: RecoveryTimelineProps) {
  if (stages.length === 0) {
    return (
      <p className="text-[11px] text-radar-text-muted">
        No collection stages recorded for this source yet.
      </p>
    );
  }

  return (
    <ol className={`radar-rail ${wide ? "radar-rail-wide" : ""}`} aria-label={label}>
      {stages.map((stage) => (
        <li
          key={stage.id}
          className={`radar-rail-item ${stage.status === "pending" ? "radar-rail-item-pending" : ""}`}
        >
          <span
            className={`radar-rail-node ${nodeClass[stage.status]}`}
            aria-hidden="true"
          />
          <p className="radar-rail-label">
            {stage.label}
            <span className="sr-only"> — {stageAnnouncement[stage.status]}</span>
          </p>
          {stage.detail && <p className="radar-rail-detail">{stage.detail}</p>}
          {stage.at ? (
            <time dateTime={stage.at} className="radar-rail-time">
              {formatRelativeTime(stage.at)}
              {formatDuration(stage.durationMs)
                ? ` · ${formatDuration(stage.durationMs)}`
                : ""}
            </time>
          ) : (
            <span className="radar-rail-time">pending</span>
          )}
        </li>
      ))}
    </ol>
  );
}
