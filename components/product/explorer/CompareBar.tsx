import Link from "next/link";

import {
  compareHref,
  explorerHref,
  MAX_COMPARE_MODELS,
  type ExplorerFilters,
} from "../../../lib/product/explorer";

interface CompareBarProps {
  selectedIds: readonly string[];
  labels: Readonly<Record<string, string>>;
  filters: ExplorerFilters;
  onRemove: (canonicalId: string) => void;
  onClear: () => void;
}

/** Persistent compare selection, shareable via the explorer URL `ids` param. */
export function CompareBar({
  selectedIds,
  labels,
  filters,
  onRemove,
  onClear,
}: CompareBarProps) {
  if (selectedIds.length === 0) return null;

  const full = selectedIds.length >= MAX_COMPARE_MODELS;

  return (
    <div className="radar-compare-bar" role="region" aria-label="Compare selection">
      <p className="radar-compare-bar-count">
        {selectedIds.length} of {MAX_COMPARE_MODELS} selected
        {full ? " — selection full" : ""}
      </p>
      <ul className="radar-compare-bar-list">
        {selectedIds.map((id) => (
          <li key={id}>
            <span className="font-mono">{labels[id] ?? id}</span>
            <button
              type="button"
              className="radar-remove-button"
              onClick={() => onRemove(id)}
            >
              Remove
              <span className="sr-only"> {labels[id] ?? id} from compare</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="radar-compare-bar-actions">
        <Link href={compareHref(selectedIds)} className="radar-compare-go">
          Compare selected
        </Link>
        <Link href={explorerHref(filters, [])} className="radar-inline-link" onClick={onClear}>
          Clear selection
        </Link>
      </div>
    </div>
  );
}
