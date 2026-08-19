import type { ReactNode } from "react";
import Link from "next/link";

import { EmptyState } from "../../radar/ui/DataState";
import { Panel } from "../../radar/ui/Panel";
import {
  compareHref,
  modelDetailHref,
  type ModelCompareReadModel,
} from "../../../lib/product/explorer";
import { ProvenanceDisclosure } from "../provenance/ProvenanceDisclosure";
import { CapabilityStatus } from "./CapabilityStatus";
import { FreshnessStatus } from "./FreshnessStatus";
import { formatModalities, formatObservedPrice, formatObservedTokens } from "./format";

export function ModelCompareView({
  comparison,
}: {
  comparison: ModelCompareReadModel;
}) {
  const columns = comparison.columns;

  if (columns.length === 0) {
    return (
      <EmptyState
        title="No models to compare"
        description="Select models in Explorer. Comparison uses canonical ids in the URL, so a valid set can be shared."
      />
    );
  }

  return (
    <div className="radar-surface-stack">
      {comparison.missingIds.length > 0 && (
        <p className="radar-evidence-banner radar-evidence-banner-unknown" role="status">
          <span className="radar-evidence-banner-tag">Missing</span>
          <span>
            These canonical ids were requested but not found:{" "}
            <span className="font-mono">{comparison.missingIds.join(", ")}</span>.
            They are omitted rather than invented.
          </span>
        </p>
      )}

      <Panel
        id="model-compare"
        title="Side-by-side"
        subtitle="Aligned observations. This view does not rank models or pick a winner."
      >
        <div className="radar-compare-table-wrap">
          <table className="radar-table radar-compare-table" aria-label="Model comparison">
            <thead>
              <tr>
                <th scope="col" className="radar-table-head text-left">
                  Field
                </th>
                {columns.map((column) => (
                  <th
                    key={column.identity.canonicalId}
                    scope="col"
                    className="radar-table-head text-left"
                  >
                    <Link
                      href={modelDetailHref(column.identity.canonicalId)}
                      className="radar-explorer-model-link"
                    >
                      <span className="block text-[10px] uppercase tracking-wide text-radar-text-muted">
                        {column.identity.providerName}
                      </span>
                      <span className="font-mono text-sm">{column.identity.displayName}</span>
                    </Link>
                    <Link
                      href={compareHref(
                        columns
                          .map((item) => item.identity.canonicalId)
                          .filter((id) => id !== column.identity.canonicalId),
                      )}
                      className="radar-inline-link block mt-1"
                    >
                      Remove
                      <span className="sr-only"> {column.identity.displayName}</span>
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <CompareDataRow
                label="Input price"
                values={columns.map((c) => (
                  <span key={c.identity.canonicalId}>
                    {formatObservedPrice(c.inputPrice)}
                    {c.inputPrice === null && <span className="sr-only">Not observed</span>}
                  </span>
                ))}
              />
              <CompareDataRow
                label="Output price"
                values={columns.map((c) => (
                  <span key={c.identity.canonicalId}>
                    {formatObservedPrice(c.outputPrice)}
                    {c.outputPrice === null && <span className="sr-only">Not observed</span>}
                  </span>
                ))}
              />
              <CompareDataRow
                label="Context"
                values={columns.map((c) => (
                  <span key={c.identity.canonicalId}>
                    {formatObservedTokens(c.contextWindow)}
                    {c.contextWindow === null && <span className="sr-only">Not observed</span>}
                  </span>
                ))}
              />
              <CompareDataRow
                label="Max output"
                values={columns.map((c) => (
                  <span key={c.identity.canonicalId}>
                    {formatObservedTokens(c.maxOutputTokens)}
                    {c.maxOutputTokens === null && <span className="sr-only">Not observed</span>}
                  </span>
                ))}
              />
              <CompareDataRow
                label="Vision"
                values={columns.map((c) => (
                  <CapabilityStatus key={c.identity.canonicalId} value={c.vision} compact />
                ))}
              />
              <CompareDataRow
                label="Tools"
                values={columns.map((c) => (
                  <CapabilityStatus key={c.identity.canonicalId} value={c.toolCalling} compact />
                ))}
              />
              <CompareDataRow
                label="Input modalities"
                values={columns.map((c) => formatModalities(c.inputModalities))}
              />
              <CompareDataRow
                label="Output modalities"
                values={columns.map((c) => formatModalities(c.outputModalities))}
              />
              <CompareDataRow
                label="Lifecycle"
                values={columns.map((c) => c.lifecycle.label)}
              />
              <CompareDataRow
                label="Freshness"
                values={columns.map((c) => (
                  <FreshnessStatus key={c.identity.canonicalId} freshness={c.freshness} />
                ))}
              />
              <CompareDataRow
                label="Provenance"
                values={columns.map((c) => (
                  <ProvenanceDisclosure
                    key={c.identity.canonicalId}
                    provenance={c.provenance}
                    subject={c.identity.displayName}
                  />
                ))}
              />
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function CompareDataRow({
  label,
  values,
}: {
  label: string;
  values: ReactNode[];
}) {
  return (
    <tr className="radar-table-row">
      <th scope="row" className="radar-table-cell radar-compare-field">
        {label}
      </th>
      {values.map((value, index) => (
        <td key={`${label}-${index}`} className="radar-table-cell">
          {value}
        </td>
      ))}
    </tr>
  );
}
