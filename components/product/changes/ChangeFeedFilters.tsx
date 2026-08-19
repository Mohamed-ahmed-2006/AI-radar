"use client";

import {
  CHANGE_FEED_RANGE_OPTIONS,
  type ChangeFeedFilterOption,
  type ChangeFeedFilters as Filters,
} from "../../../lib/product/change-feed";
import type { EvidenceCategory, RelativeDateRange } from "../../../lib/intelligence/contracts";

interface ChangeFeedFiltersProps {
  filters: Filters;
  providerOptions: readonly ChangeFeedFilterOption[];
  categoryOptions: readonly ChangeFeedFilterOption[];
  onChange: (filters: Filters) => void;
  /** Lets the demo dataset be toggled where the surface allows it. */
  allowDemoToggle?: boolean;
  busy?: boolean;
}

function optionLabel(option: ChangeFeedFilterOption): string {
  return option.count > 0 ? `${option.label} (${option.count})` : option.label;
}

/**
 * Provider, category and time-range controls.
 *
 * Native `<select>` elements keep the whole bar keyboard- and screen-reader
 * operable for free, and every control has a visible label rather than a
 * placeholder standing in for one.
 */
export function ChangeFeedFilters({
  filters,
  providerOptions,
  categoryOptions,
  onChange,
  allowDemoToggle = true,
  busy = false,
}: ChangeFeedFiltersProps) {
  return (
    <div className="radar-filters" role="group" aria-label="Change feed filters">
      <div className="radar-filter">
        <label className="radar-filter-label" htmlFor="change-filter-provider">
          Provider
        </label>
        <select
          id="change-filter-provider"
          className="radar-filter-control"
          value={filters.provider ?? ""}
          onChange={(event) =>
            onChange({ ...filters, provider: event.target.value || null })
          }
        >
          <option value="">All providers</option>
          {providerOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {optionLabel(option)}
            </option>
          ))}
        </select>
      </div>

      <div className="radar-filter">
        <label className="radar-filter-label" htmlFor="change-filter-category">
          Change type
        </label>
        <select
          id="change-filter-category"
          className="radar-filter-control"
          value={filters.category ?? ""}
          onChange={(event) =>
            onChange({
              ...filters,
              category: (event.target.value || null) as EvidenceCategory | null,
            })
          }
        >
          <option value="">All change types</option>
          {categoryOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {optionLabel(option)}
            </option>
          ))}
        </select>
      </div>

      <div className="radar-filter">
        <label className="radar-filter-label" htmlFor="change-filter-range">
          Time range
        </label>
        <select
          id="change-filter-range"
          className="radar-filter-control"
          value={filters.range}
          onChange={(event) =>
            onChange({ ...filters, range: event.target.value as RelativeDateRange })
          }
        >
          {CHANGE_FEED_RANGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {allowDemoToggle && (
        <div className="radar-filter radar-filter-inline">
          <input
            id="change-filter-demo"
            type="checkbox"
            className="radar-filter-checkbox"
            checked={filters.demo}
            onChange={(event) => onChange({ ...filters, demo: event.target.checked })}
          />
          <label className="radar-filter-label" htmlFor="change-filter-demo">
            Demo dataset
          </label>
        </div>
      )}

      <p className="radar-filter-status" role="status" aria-live="polite">
        {busy ? "Loading changes…" : ""}
      </p>
    </div>
  );
}
