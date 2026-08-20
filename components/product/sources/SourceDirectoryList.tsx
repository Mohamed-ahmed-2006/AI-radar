"use client";

import { useState } from "react";
import Link from "next/link";

import { Badge } from "../../radar/ui/Badge";
import { EmptyState } from "../../radar/ui/DataState";
import { StatusDot } from "../../radar/ui/StatusDot";
import { formatAbsoluteTime, formatRelativeTime } from "../../radar/utils";
import type { SourceDirectoryEntry } from "../../../lib/product/source-detail";
import { Drawer } from "../ui/Overlay";

function healthVariant(
  health: SourceDirectoryEntry["health"],
): "success" | "warning" | "critical" | "muted" {
  if (health === "healthy") return "success";
  if (health === "degraded") return "warning";
  if (health === "down") return "critical";
  return "muted";
}

function SourceInspector({
  entry,
  onClose,
}: {
  entry: SourceDirectoryEntry;
  onClose: () => void;
}) {
  return (
    <Drawer
      open
      title={entry.name}
      kicker={entry.providerName}
      onClose={onClose}
      footer={
        <Link
          href={`/sources/${encodeURIComponent(entry.sourceId)}`}
          className="radar-compare-go"
        >
          Open source detail
        </Link>
      }
    >
      <dl className="radar-fact-grid">
        <div className="radar-fact">
          <dt className="radar-fact-label">Health</dt>
          <dd className="radar-fact-value">
            <Badge variant={healthVariant(entry.health)}>{entry.statusLabel}</Badge>
          </dd>
        </div>
        <div className="radar-fact">
          <dt className="radar-fact-label">Category</dt>
          <dd className="radar-fact-value">{entry.category}</dd>
        </div>
        <div className="radar-fact">
          <dt className="radar-fact-label">Collector</dt>
          <dd className="radar-fact-value font-mono">
            {entry.collectorId ?? "Not observed"}
          </dd>
        </div>
        <div className="radar-fact">
          <dt className="radar-fact-label">Accepted records</dt>
          <dd className="radar-fact-value tabular-nums">
            {entry.recordCount ?? "—"}
          </dd>
        </div>
        <div className="radar-fact">
          <dt className="radar-fact-label">Latest run</dt>
          <dd className="radar-fact-value">
            {entry.lastRunAt ? (
              <time dateTime={entry.lastRunAt} title={formatAbsoluteTime(entry.lastRunAt)}>
                {formatRelativeTime(entry.lastRunAt)}
              </time>
            ) : (
              "never collected"
            )}
          </dd>
        </div>
        <div className="radar-fact">
          <dt className="radar-fact-label">Staleness</dt>
          <dd className="radar-fact-value">
            {entry.stalenessMinutes === null
              ? "Not observed"
              : `${entry.stalenessMinutes} min`}
          </dd>
        </div>
        <div className="radar-fact">
          <dt className="radar-fact-label">Open incidents</dt>
          <dd className="radar-fact-value">
            {entry.hasOpenIncident ? "1 open" : "None open"}
          </dd>
        </div>
        <div className="radar-fact">
          <dt className="radar-fact-label">Incident history</dt>
          <dd className="radar-fact-value">
            {entry.hasResolvedIncident
              ? "Previous incident resolved"
              : entry.hasOpenIncident
                ? "See open incident"
                : "No incidents on record"}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-radar-text-muted mt-4">
        Cadence, last-known-good, and full provenance live on the source detail page.
      </p>
    </Drawer>
  );
}

/** Every tracked source with its current state, linking into the detail page. */
export function SourceDirectoryList({ entries }: { entries: readonly SourceDirectoryEntry[] }) {
  const [inspected, setInspected] = useState<SourceDirectoryEntry | null>(null);

  if (entries.length === 0) {
    return (
      <EmptyState
        title="No sources registered"
        description="Once a collector runs, its source appears here with full health and provenance."
      />
    );
  }

  return (
    <>
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
          <th scope="col" className="radar-table-head text-right">
            <span className="sr-only">Inspect</span>
          </th>
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
            </span>
          </Link>
          </td>
          <td className="radar-table-cell">{entry.providerName}</td>
          <td className="radar-table-cell">{entry.category}</td>
          <td className="radar-table-cell">
            <span className="radar-source-row-side">
              <Badge variant={healthVariant(entry.health)}>
                {entry.statusLabel}
              </Badge>
              {entry.hasOpenIncident ? (
                <Badge variant="critical">Open incident</Badge>
              ) : (
                entry.hasResolvedIncident && (
                  // History, not a live problem: a resolved incident is
                  // evidence the source recovered, so it is styled as a muted
                  // footnote rather than an alert.
                  <Badge variant="muted">Past incident resolved</Badge>
                )
              )}
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
          <td className="radar-table-cell text-right">
            <button
              type="button"
              className="radar-inline-link"
              onClick={() => setInspected(entry)}
            >
              Inspect
            </button>
          </td>
        </tr>
      ))}
      </tbody>
    </table>
    </div>
    {inspected && (
      <SourceInspector entry={inspected} onClose={() => setInspected(null)} />
    )}
    </>
  );
}
