import Link from "next/link";

import { Badge } from "../../radar/ui/Badge";
import { EmptyState } from "../../radar/ui/DataState";
import { modelDetailHref } from "../../../lib/product/explorer";
import type { ModelExplorerRow } from "../../../lib/product/explorer";
import { ProvenanceDisclosure } from "../provenance/ProvenanceDisclosure";
import { CapabilityStatus } from "./CapabilityStatus";
import { FreshnessStatus } from "./FreshnessStatus";
import { formatObservedPrice, formatObservedTokens } from "./format";

interface ModelExplorerTableProps {
  models: readonly ModelExplorerRow[];
  selectedIds: readonly string[];
  onToggle: (canonicalId: string) => void;
  compareLimitReached: boolean;
}

function lifecycleVariant(
  state: string | null,
): "success" | "warning" | "muted" | "info" {
  if (state === "active") return "success";
  if (state === "deprecated" || state === "legacy") return "warning";
  if (state === "retired") return "muted";
  return "info";
}

/** Desktop/tablet scan table. Cards below 768px are a separate list. */
export function ModelExplorerTable({
  models,
  selectedIds,
  onToggle,
  compareLimitReached,
}: ModelExplorerTableProps) {
  if (models.length === 0) {
    return (
      <EmptyState
        title="No models match these filters"
        description="Clear a filter or widen a price or context bound. Unknown prices are excluded from a maximum-price filter because they cannot be proven to pass it."
      />
    );
  }

  return (
    <div className="radar-explorer-table-wrap">
      <table className="radar-table radar-explorer-table" aria-label="Model catalog">
        <thead>
          <tr>
            <th scope="col" className="radar-table-head text-left">
              Compare
            </th>
            <th scope="col" className="radar-table-head text-left">
              Provider
            </th>
            <th scope="col" className="radar-table-head text-left">
              Model
            </th>
            <th scope="col" className="radar-table-head text-right">
              Input
            </th>
            <th scope="col" className="radar-table-head text-right">
              Output
            </th>
            <th scope="col" className="radar-table-head text-right">
              Context
            </th>
            <th scope="col" className="radar-table-head text-left">
              Vision
            </th>
            <th scope="col" className="radar-table-head text-left">
              Tool calling
            </th>
            <th scope="col" className="radar-table-head text-left">
              Lifecycle
            </th>
            <th scope="col" className="radar-table-head text-left">
              Freshness
            </th>
          </tr>
        </thead>
        <tbody>
          {models.map((model) => {
            const id = model.identity.canonicalId;
            const selected = selectedIds.includes(id);
            const checkboxId = `compare-${id.replaceAll(/[^a-z0-9:_-]/gi, "-")}`;
            const disabled = !selected && compareLimitReached;

            return (
              <tr key={id} className="radar-table-row">
                <td className="radar-table-cell">
                  <input
                    id={checkboxId}
                    type="checkbox"
                    className="radar-filter-checkbox"
                    checked={selected}
                    disabled={disabled}
                    onChange={() => onToggle(id)}
                    aria-label={`Select ${model.identity.displayName} for compare`}
                  />
                </td>
                <td className="radar-table-cell">{model.identity.providerName}</td>
                <td className="radar-table-cell">
                  <Link
                    href={modelDetailHref(id)}
                    className="radar-explorer-model-link"
                  >
                    <span className="font-mono text-sm text-radar-text-primary">
                      {model.identity.displayName}
                    </span>
                    {model.identity.apiModelId &&
                      model.identity.apiModelId !== model.identity.displayName && (
                        <span className="block text-[10px] text-radar-text-muted">
                          {model.identity.apiModelId}
                        </span>
                      )}
                  </Link>
                  <ProvenanceDisclosure
                    provenance={model.provenance}
                    subject={model.identity.displayName}
                  />
                </td>
                <td className="radar-table-cell text-right tabular-nums">
                  {formatObservedPrice(model.inputPrice)}
                  {model.inputPrice === null && (
                    <span className="sr-only">Not observed</span>
                  )}
                </td>
                <td className="radar-table-cell text-right tabular-nums">
                  {formatObservedPrice(model.outputPrice)}
                  {model.outputPrice === null && (
                    <span className="sr-only">Not observed</span>
                  )}
                </td>
                <td className="radar-table-cell text-right tabular-nums font-mono text-xs">
                  {formatObservedTokens(model.contextWindow)}
                  {model.contextWindow === null && (
                    <span className="sr-only">Not observed</span>
                  )}
                </td>
                <td className="radar-table-cell">
                  <CapabilityStatus value={model.vision} compact />
                </td>
                <td className="radar-table-cell">
                  <CapabilityStatus value={model.toolCalling} compact />
                </td>
                <td className="radar-table-cell">
                  <Badge variant={lifecycleVariant(model.lifecycle.state)}>
                    {model.lifecycle.label}
                  </Badge>
                </td>
                <td className="radar-table-cell">
                  <FreshnessStatus freshness={model.freshness} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
