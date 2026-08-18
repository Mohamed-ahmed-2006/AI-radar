import { formatRelativeTime } from "../utils";
import { reasonCodeDescription, reasonCodeTitle } from "./reason-codes";
import type { SentinelIncidentView, SentinelSeverity } from "./types";

const severityAccent: Record<SentinelSeverity, string> = {
  critical: "border-radar-danger/30 bg-radar-danger/5",
  warning: "border-radar-warn/30 bg-radar-warn/5",
  info: "border-radar-info/30 bg-radar-info/5",
};

const severityTitle: Record<SentinelSeverity, string> = {
  critical: "text-radar-danger",
  warning: "text-radar-warn",
  info: "text-radar-info",
};

interface AnomalyReasonProps {
  incident: SentinelIncidentView | null;
  /** Caps the reason list on dense card layouts; the rest are counted. */
  maxCodes?: number;
  /** Shown when there is no incident at all. */
  emptyMessage?: string;
}

/**
 * Why Sentinel rejected a run, in the backend's own reason codes. Each code is
 * printed verbatim next to its explanation so an unmapped code still reads.
 */
export function AnomalyReason({
  incident,
  maxCodes,
  emptyMessage,
}: AnomalyReasonProps) {
  if (!incident) {
    return emptyMessage ? (
      <p className="text-xs text-radar-text-secondary leading-relaxed">
        {emptyMessage}
      </p>
    ) : null;
  }

  const shown = maxCodes
    ? incident.reasonCodes.slice(0, maxCodes)
    : incident.reasonCodes;
  const hidden = incident.reasonCodes.length - shown.length;
  const hasCounts =
    incident.recordsSeen !== null && incident.recordsInvalid !== null;

  return (
    <div
      className={`rounded border px-2.5 py-2 flex flex-col gap-1.5 ${severityAccent[incident.severity]}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className={`text-xs font-semibold leading-snug ${severityTitle[incident.severity]}`}
        >
          {incident.severity === "critical" ? "Critical anomaly" : "Anomaly"}
          {" · "}
          {incident.status.replaceAll("_", " ")}
        </p>
        <time
          dateTime={incident.createdAt}
          className="text-[10px] text-radar-text-muted tabular-nums shrink-0"
        >
          {formatRelativeTime(incident.createdAt)}
        </time>
      </div>

      {incident.summary && (
        <p className="text-[11px] leading-relaxed text-radar-text-secondary">
          {incident.summary}
        </p>
      )}

      {shown.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="Sentinel reason codes">
          {shown.map((code) => {
            const description = reasonCodeDescription(code);
            return (
              <li key={code}>
                <p className="text-[11px] font-medium text-radar-text-primary leading-snug">
                  {reasonCodeTitle(code)}{" "}
                  <code className="font-mono text-[10px] text-radar-text-muted">
                    {code}
                  </code>
                </p>
                {description && (
                  <p className="text-[10px] leading-relaxed text-radar-text-muted">
                    {description}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hidden > 0 && (
        <p className="text-[10px] text-radar-text-muted">
          + {hidden} more reason code{hidden === 1 ? "" : "s"}
        </p>
      )}

      {hasCounts && (
        <p className="text-[10px] text-radar-text-muted tabular-nums">
          {incident.recordsInvalid} of {incident.recordsSeen} records rejected
          {incident.healingAttemptCount > 0 &&
            ` · ${incident.healingAttemptCount} healing attempt${incident.healingAttemptCount === 1 ? "" : "s"}`}
        </p>
      )}
    </div>
  );
}
