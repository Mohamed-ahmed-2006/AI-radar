import Link from "next/link";
import type { ProvenanceRecord } from "../types";
import { EmptyState, LoadingState } from "../ui/DataState";
import { Panel } from "../ui/Panel";
import { ProvenanceDisclosure } from "../../product/provenance/ProvenanceDisclosure";
import { provenanceFromSource } from "../../../lib/product/provenance";

interface SourceProvenanceProps {
  records: ProvenanceRecord[];
  loading?: boolean;
  isDemo?: boolean;
}

function placeholder(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "—") return null;
  return trimmed;
}

export function SourceProvenance({
  records,
  loading,
  isDemo = false,
}: SourceProvenanceProps) {
  return (
    <Panel
      title="Source provenance"
      subtitle="Verified data origins and collection metadata"
      action={
        <Link href="/sources" className="radar-inline-link">
          Sources
        </Link>
      }
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
          {records.map((record) => {
            const sourceHref =
              record.sourceId && record.sourceId !== "—"
                ? `/sources/${encodeURIComponent(record.sourceId)}`
                : null;
            const provenance = provenanceFromSource({
              sourceLabel: placeholder(record.label),
              sourceUrl: placeholder(record.url),
              collectorId: placeholder(record.collector),
              observedAt: record.scrapedAt,
              runId: placeholder(record.datasetVersion),
              // Derived by the read model from the source's registered
              // contract, so this panel uses the same trust vocabulary as
              // Explorer and Optimizer instead of defaulting to Unverified.
              authority: record.authority,
              isDemo,
            });
            return (
              <li
                key={record.sourceId}
                className="rounded border border-radar-border-subtle bg-radar-surface px-3 py-2"
              >
                {sourceHref && (
                  <Link href={sourceHref} className="radar-inline-link">
                    Source detail
                  </Link>
                )}
                <ProvenanceDisclosure
                  provenance={provenance}
                  subject={record.label}
                />
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
