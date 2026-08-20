import Link from "next/link";
import { Badge } from "../../radar/ui/Badge";
import { EmptyState } from "../../radar/ui/DataState";
import { StatusDot } from "../../radar/ui/StatusDot";
import { formatAbsoluteTime, formatRelativeTime } from "../../radar/utils";
import type { SourceDirectoryEntry } from "../../../lib/product/source-detail";

/** Every tracked source with its current state, linking into the detail page. */
export function SourceDirectoryList({ entries }: { entries: readonly SourceDirectoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No sources registered"
        description="Once a collector runs, its source appears here with full health and provenance."
      />
    );
  }

  return (
    <div className="radar-table-scroll">
    <table className="radar-table radar-source-table w-full" aria-label="Tracked collection sources">
      <thead>
        <tr>
          <th scope="col" className="radar-table-head text-left">Source</th>
          <th scope="col" className="radar-table-head text-left">Provider</th>
          <th scope="col" className="radar-table-head text-left">Category</th>
          <th scope="col" className="radar-table-head text-left">Health</th>
          <th scope="col" className="radar-table-head text-right">Records</th>
          <th scope="col" className="radar-table-head text-left">Latest run</th>
        </tr>
      </thead>
      <tbody>
      {entries.map((entry) => (
        <tr key={entry.sourceId} className="radar-table-row">
          <td className="radar-table-cell">
          <Link
            href={`/sources/${encodeURIComponent(entry.sourceId)}`}
            className="radar-source-row"
          >
            <span className="radar-source-row-main">
              <span className="radar-source-row-name">
                <StatusDot status={entry.health} />
                {entry.name}
              </span>
              <span className="radar-source-row-meta">
                {entry.collectorId && (
                  <span className="font-mono">{entry.collectorId}</span>
                )}
              </span>
            </span>
          </Link>
          </td>
          <td className="radar-table-cell">{entry.providerName}</td>
          <td className="radar-table-cell">{entry.category}</td>
          <td className="radar-table-cell">
            <span className="radar-source-row-side">
              <Badge
                variant={
                  entry.health === "healthy"
                    ? "success"
                    : entry.health === "degraded"
                      ? "warning"
                      : entry.health === "down"
                        ? "critical"
                        : "muted"
                }
              >
                {entry.statusLabel}
              </Badge>
              {entry.hasOpenIncident && <Badge variant="critical">Open incident</Badge>}
            </span>
          </td>
          <td className="radar-table-cell text-right tabular-nums">
            {entry.recordCount ?? "—"}
          </td>
          <td className="radar-table-cell">
            <span className="radar-source-row-time">
              {entry.lastRunAt ? (
                <time dateTime={entry.lastRunAt} title={formatAbsoluteTime(entry.lastRunAt)}>
                  {formatRelativeTime(entry.lastRunAt)}
                </time>
              ) : (
                "never collected"
              )}
            </span>
          </td>
        </tr>
      ))}
      </tbody>
    </table>
    </div>
  );
}
