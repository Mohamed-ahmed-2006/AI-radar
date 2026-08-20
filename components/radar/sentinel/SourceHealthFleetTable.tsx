import Link from "next/link";

import { StatusDot } from "../ui/StatusDot";
import { formatRelativeTime } from "../utils";
import { SentinelStatusBadge } from "./SentinelStatusBadge";
import type { SentinelSourceView } from "./types";

/** Dense fleet list. Full timelines live on source detail / inspector. */
export function SourceHealthFleetTable({
  sources,
}: {
  sources: readonly SentinelSourceView[];
}) {
  return (
    <div className="radar-table-scroll">
      <table className="radar-table w-full" aria-label="Monitored sources">
        <thead>
          <tr>
            <th scope="col" className="radar-table-head text-left">Source</th>
            <th scope="col" className="radar-table-head text-left">Provider</th>
            <th scope="col" className="radar-table-head text-left">State</th>
            <th scope="col" className="radar-table-head text-right">Records</th>
            <th scope="col" className="radar-table-head text-left">Collected</th>
            <th scope="col" className="radar-table-head text-right"> </th>
          </tr>
        </thead>
        <tbody>
          {sources.map((source) => (
            <tr key={source.sourceId} className="radar-table-row">
              <td className="radar-table-cell">
                <Link
                  href={`/sources/${encodeURIComponent(source.sourceId)}`}
                  className="radar-explorer-model-link"
                >
                  <StatusDot status={source.health} decorative />{" "}
                  {source.name}
                </Link>
              </td>
              <td className="radar-table-cell">{source.providerName}</td>
              <td className="radar-table-cell">
                <SentinelStatusBadge status={source.status} />
              </td>
              <td className="radar-table-cell text-right tabular-nums">
                {source.currentRecordCount ?? "—"}
              </td>
              <td className="radar-table-cell">
                {source.lastRunAt ? (
                  <time dateTime={source.lastRunAt}>
                    {formatRelativeTime(source.lastRunAt)}
                  </time>
                ) : (
                  "never"
                )}
              </td>
              <td className="radar-table-cell text-right">
                <Link
                  href={`/sources/${encodeURIComponent(source.sourceId)}`}
                  className="radar-inline-link"
                >
                  Detail
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
