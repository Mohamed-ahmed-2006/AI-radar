import { Badge } from "../../radar/ui/Badge";
import { Panel } from "../../radar/ui/Panel";
import { formatAbsoluteTime } from "../../radar/utils";
import type {
  SectionState,
  SourceRunRecord,
  SourceRunStatus,
} from "../../../lib/product/source-detail";
import { UnavailableNote } from "../common/UnavailableNote";

const STATUS_VARIANT: Record<SourceRunStatus, "success" | "warning" | "critical" | "info"> = {
  succeeded: "success",
  partial: "warning",
  failed: "critical",
  running: "info",
};

function statusLabel(status: SourceRunStatus | null): string {
  if (status === null) return "Unknown";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function count(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-US");
}

/** Validation outcome per collection run, newest first. */
export function SourceRunHistoryPanel({
  runHistory,
}: {
  runHistory: SectionState<SourceRunRecord[]>;
}) {
  return (
    <Panel
      id="source-runs"
      title="Validation and run history"
      subtitle="What each collection run saw, accepted and rejected"
    >
      {!runHistory.available ? (
        <UnavailableNote reason={runHistory.reason} />
      ) : (
        <ol className="radar-run-list" aria-label="Collection runs, newest first">
          {runHistory.data.map((run) => (
            <li key={run.id} className="radar-run-item">
              <div className="radar-run-item-head">
                <Badge variant={run.status ? STATUS_VARIANT[run.status] : "muted"}>
                  {statusLabel(run.status)}
                </Badge>
                {run.completedAt ? (
                  <time dateTime={run.completedAt} className="radar-run-item-time">
                    {formatAbsoluteTime(run.completedAt)}
                  </time>
                ) : (
                  <span className="radar-run-item-time">Completion time not recorded</span>
                )}
              </div>
              <dl className="radar-metric-row">
                <div className="radar-metric">
                  <dt className="radar-metric-label">Seen</dt>
                  <dd className="radar-metric-value">{count(run.recordsSeen)}</dd>
                </div>
                <div className="radar-metric">
                  <dt className="radar-metric-label">Accepted</dt>
                  <dd className="radar-metric-value">{count(run.recordsAccepted)}</dd>
                </div>
                <div className="radar-metric">
                  <dt className="radar-metric-label">Rejected</dt>
                  <dd className="radar-metric-value">{count(run.recordsRejected)}</dd>
                </div>
              </dl>
              {run.errorMessage && (
                <p className="radar-run-item-error">{run.errorMessage}</p>
              )}
              <p className="radar-run-item-id font-mono">{run.id}</p>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
