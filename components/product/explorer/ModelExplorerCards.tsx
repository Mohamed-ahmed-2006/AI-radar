import Link from "next/link";

import { Badge } from "../../radar/ui/Badge";
import { EmptyState } from "../../radar/ui/DataState";
import { modelDetailHref } from "../../../lib/product/explorer";
import type { ModelExplorerRow } from "../../../lib/product/explorer";
import { ProvenanceDisclosure } from "../provenance/ProvenanceDisclosure";
import { CapabilityStatus } from "./CapabilityStatus";
import { FreshnessStatus } from "./FreshnessStatus";
import { formatObservedPrice, formatObservedTokens } from "./format";

interface ModelExplorerCardsProps {
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

/** Mobile/tablet card list — same fields as the table, stacked for narrow viewports. */
export function ModelExplorerCards({
  models,
  selectedIds,
  onToggle,
  compareLimitReached,
}: ModelExplorerCardsProps) {
  if (models.length === 0) {
    return (
      <EmptyState
        title="No models match these filters"
        description="Clear a filter or widen a price or context bound."
      />
    );
  }

  return (
    <ul className="radar-explorer-cards" aria-label="Model catalog">
      {models.map((model) => {
        const id = model.identity.canonicalId;
        const selected = selectedIds.includes(id);
        const checkboxId = `compare-card-${id.replaceAll(/[^a-z0-9:_-]/gi, "-")}`;
        const disabled = !selected && compareLimitReached;

        return (
          <li key={id} className="radar-explorer-card">
            <div className="radar-explorer-card-head">
              <input
                id={checkboxId}
                type="checkbox"
                className="radar-filter-checkbox"
                checked={selected}
                disabled={disabled}
                onChange={() => onToggle(id)}
                aria-label={`Select ${model.identity.displayName} for compare`}
              />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-radar-text-muted">
                  {model.identity.providerName}
                </p>
                <Link href={modelDetailHref(id)} className="radar-explorer-model-link">
                  <span className="font-mono text-sm">{model.identity.displayName}</span>
                </Link>
              </div>
              <Badge variant={lifecycleVariant(model.lifecycle.state)}>
                {model.lifecycle.label}
              </Badge>
            </div>

            <dl className="radar-explorer-card-facts">
              <div>
                <dt>Input</dt>
                <dd>
                  {formatObservedPrice(model.inputPrice)}
                  {model.inputPrice === null && (
                    <span className="sr-only">Not observed</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Output</dt>
                <dd>
                  {formatObservedPrice(model.outputPrice)}
                  {model.outputPrice === null && (
                    <span className="sr-only">Not observed</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Context</dt>
                <dd>
                  {formatObservedTokens(model.contextWindow)}
                  {model.contextWindow === null && (
                    <span className="sr-only">Not observed</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Vision</dt>
                <dd>
                  <CapabilityStatus value={model.vision} compact />
                </dd>
              </div>
              <div>
                <dt>Tool calling</dt>
                <dd>
                  <CapabilityStatus value={model.toolCalling} compact />
                </dd>
              </div>
              <div>
                <dt>Freshness</dt>
                <dd>
                  <FreshnessStatus freshness={model.freshness} />
                </dd>
              </div>
            </dl>

            <ProvenanceDisclosure
              provenance={model.provenance}
              subject={model.identity.displayName}
            />
          </li>
        );
      })}
    </ul>
  );
}
