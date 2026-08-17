import type { ProvenanceRecord } from "../types";
import { EmptyState, LoadingState } from "../ui/DataState";
import { Panel } from "../ui/Panel";
import { formatAbsoluteTime } from "../utils";

interface SourceProvenanceProps {
  records: ProvenanceRecord[];
  loading?: boolean;
}

export function SourceProvenance({ records, loading }: SourceProvenanceProps) {
  return (
    <Panel
      title="Source provenance"
      subtitle="Verified data origins and collection metadata"
    >
      {loading ? (
        <LoadingState title="Loading provenance…" />
      ) : records.length === 0 ? (
        <EmptyState
          title="No provenance records"
          description="Source attribution will appear with collected data."
        />
      ) : (
        <ul className="space-y-2" aria-label="Data source provenance">
          {records.map((record) => (
            <li
              key={record.sourceId}
              className="rounded border border-radar-border-subtle bg-radar-surface px-3 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <a
                    href={record.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-radar-info hover:underline truncate block"
                  >
                    {record.label}
                  </a>
                  <dl className="mt-1 grid grid-cols-1 gap-0.5 text-[10px]">
                    <div className="flex gap-2">
                      <dt className="text-radar-text-muted shrink-0">Collector</dt>
                      <dd className="font-mono text-radar-text-secondary truncate">
                        {record.collector}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-radar-text-muted shrink-0">Dataset</dt>
                      <dd className="font-mono text-radar-text-secondary truncate">
                        {record.datasetVersion}
                      </dd>
                    </div>
                  </dl>
                </div>
                <time
                  dateTime={record.scrapedAt ?? undefined}
                  className="text-[10px] text-radar-text-muted whitespace-nowrap shrink-0 tabular-nums"
                  title="Scraped at"
                >
                  {record.scrapedAt ? formatAbsoluteTime(record.scrapedAt) : "not collected"}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
