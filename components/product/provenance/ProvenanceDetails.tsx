import { Badge } from "../../radar/ui/Badge";
import { formatAbsoluteTime } from "../../radar/utils";
import {
  hasProvenanceDetail,
  type ProvenanceRow,
  type ProvenanceView,
  provenanceRows,
} from "../../../lib/product/provenance";

function RowValue({ row }: { row: ProvenanceRow }) {
  if (row.kind === "time") {
    return (
      <time dateTime={row.value} className="tabular-nums">
        {formatAbsoluteTime(row.value)}
      </time>
    );
  }
  if (row.kind === "url" && row.href) {
    return (
      <a
        href={row.href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-radar-info hover:underline break-all"
      >
        {row.value}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }
  if (row.kind === "mono") {
    return <span className="font-mono break-all">{row.value}</span>;
  }
  return <span>{row.value}</span>;
}

/**
 * The inspectable record behind a value: where it came from, when it was
 * observed, which collector produced it, and which run it can be traced to.
 *
 * Rendered as a definition list so the label/value pairing survives without
 * styling, and driven entirely by `provenanceRows` so an unknown fact is
 * absent rather than shown as an empty row.
 */
export function ProvenanceDetails({
  provenance,
  className = "",
}: {
  provenance: ProvenanceView;
  className?: string;
}) {
  const rows = provenanceRows(provenance);

  return (
    <div className={`radar-provenance-body ${className}`}>
      {provenance.isDemo && (
        <p className="mb-2">
          <Badge variant="warning">Demo evidence</Badge>
        </p>
      )}
      <dl className="radar-provenance-grid">
        {rows.map((row) => (
          <div key={row.id} className="radar-provenance-row">
            <dt className="radar-provenance-term">{row.label}</dt>
            <dd className="radar-provenance-def">
              <RowValue row={row} />
            </dd>
          </div>
        ))}
      </dl>
      {!hasProvenanceDetail(provenance) && (
        <p className="mt-2 text-[10px] text-radar-text-muted">
          No source record was attached to this value.
        </p>
      )}
    </div>
  );
}
