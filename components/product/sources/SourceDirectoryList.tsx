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
    <ul className="radar-source-directory" aria-label="Tracked collection sources">
      {entries.map((entry) => (
        <li key={entry.sourceId}>
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
                {entry.providerName}
                <span aria-hidden="true"> · </span>
                {entry.category}
                {entry.collectorId && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span className="font-mono">{entry.collectorId}</span>
                  </>
                )}
              </span>
            </span>

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
              <span className="radar-source-row-time">
                {entry.lastRunAt ? (
                  <time dateTime={entry.lastRunAt} title={formatAbsoluteTime(entry.lastRunAt)}>
                    {formatRelativeTime(entry.lastRunAt)}
                  </time>
                ) : (
                  "never collected"
                )}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
