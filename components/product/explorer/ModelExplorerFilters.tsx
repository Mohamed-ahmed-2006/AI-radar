"use client";

import {
  LIFECYCLE_STATES,
  lifecycleLabel,
  type ExplorerFilterOption,
  type ExplorerFilters,
} from "../../../lib/product/explorer";

interface ModelExplorerFiltersProps {
  filters: ExplorerFilters;
  providerOptions: readonly ExplorerFilterOption[];
  lifecycleOptions: readonly ExplorerFilterOption[];
  onChange: (filters: ExplorerFilters) => void;
  matching: number;
  total: number;
  busy?: boolean;
  search?: string;
  onSearchChange?: (value: string) => void;
}

function optionLabel(option: ExplorerFilterOption): string {
  return option.count > 0 ? `${option.label} (${option.count})` : option.label;
}

/**
 * Presentation-state filter controls. Matching is the adapter's job — this
 * bar only collects values and reports them.
 */
export function ModelExplorerFilters({
  filters,
  providerOptions,
  lifecycleOptions,
  onChange,
  matching,
  total,
  busy = false,
  search = "",
  onSearchChange,
}: ModelExplorerFiltersProps) {
  const lifecycleChoices =
    lifecycleOptions.length > 0
      ? lifecycleOptions
      : LIFECYCLE_STATES.map((value) => ({
          value,
          label: lifecycleLabel(value),
          count: 0,
        }));

  return (
    <div className="radar-filters" role="group" aria-label="Model explorer filters">
      {onSearchChange && (
        <div className="radar-filter">
          <label className="radar-filter-label" htmlFor="explorer-filter-search">
            Search
          </label>
          <input
            id="explorer-filter-search"
            className="radar-filter-control"
            type="search"
            placeholder="Name or id"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
      )}
      <div className="radar-filter">
        <label className="radar-filter-label" htmlFor="explorer-filter-provider">
          Provider
        </label>
        <select
          id="explorer-filter-provider"
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
        <label className="radar-filter-label" htmlFor="explorer-filter-max-input">
          Max input $/1M
        </label>
        <input
          id="explorer-filter-max-input"
          className="radar-filter-control"
          type="number"
          inputMode="decimal"
          min={0}
          step={0.01}
          placeholder="Any"
          value={filters.maxInputPrice ?? ""}
          onChange={(event) =>
            onChange({
              ...filters,
              maxInputPrice:
                event.target.value === "" ? null : Number(event.target.value),
            })
          }
        />
      </div>

      <div className="radar-filter">
        <label className="radar-filter-label" htmlFor="explorer-filter-max-output">
          Max output $/1M
        </label>
        <input
          id="explorer-filter-max-output"
          className="radar-filter-control"
          type="number"
          inputMode="decimal"
          min={0}
          step={0.01}
          placeholder="Any"
          value={filters.maxOutputPrice ?? ""}
          onChange={(event) =>
            onChange({
              ...filters,
              maxOutputPrice:
                event.target.value === "" ? null : Number(event.target.value),
            })
          }
        />
      </div>

      <div className="radar-filter">
        <label className="radar-filter-label" htmlFor="explorer-filter-min-context">
          Min context
        </label>
        <input
          id="explorer-filter-min-context"
          className="radar-filter-control"
          type="number"
          inputMode="numeric"
          min={0}
          step={1000}
          placeholder="Any"
          value={filters.minContext ?? ""}
          onChange={(event) =>
            onChange({
              ...filters,
              minContext:
                event.target.value === "" ? null : Number(event.target.value),
            })
          }
        />
      </div>

      <div className="radar-filter">
        <label className="radar-filter-label" htmlFor="explorer-filter-lifecycle">
          Lifecycle
        </label>
        <select
          id="explorer-filter-lifecycle"
          className="radar-filter-control"
          value={filters.lifecycleState ?? ""}
          onChange={(event) =>
            onChange({
              ...filters,
              lifecycleState: (event.target.value ||
                null) as ExplorerFilters["lifecycleState"],
            })
          }
        >
          <option value="">All states</option>
          {lifecycleChoices.map((option) => (
            <option key={option.value} value={option.value}>
              {optionLabel(option)}
            </option>
          ))}
        </select>
      </div>

      <div className="radar-filter radar-filter-inline">
        <input
          id="explorer-filter-vision"
          type="checkbox"
          className="radar-filter-checkbox"
          checked={filters.visionRequired}
          onChange={(event) =>
            onChange({ ...filters, visionRequired: event.target.checked })
          }
        />
        <label className="radar-filter-label" htmlFor="explorer-filter-vision">
          Vision required
        </label>
      </div>

      <div className="radar-filter radar-filter-inline">
        <input
          id="explorer-filter-tools"
          type="checkbox"
          className="radar-filter-checkbox"
          checked={filters.toolCallingRequired}
          onChange={(event) =>
            onChange({ ...filters, toolCallingRequired: event.target.checked })
          }
        />
        <label className="radar-filter-label" htmlFor="explorer-filter-tools">
          Tool calling required
        </label>
      </div>

      <div className="radar-filter radar-filter-inline">
        <input
          id="explorer-filter-active"
          type="checkbox"
          className="radar-filter-checkbox"
          checked={filters.activeOnly}
          onChange={(event) =>
            onChange({ ...filters, activeOnly: event.target.checked })
          }
        />
        <label className="radar-filter-label" htmlFor="explorer-filter-active">
          Active only
        </label>
      </div>

      <p className="radar-filter-status" role="status" aria-live="polite">
        {busy
          ? "Loading models…"
          : `${matching} of ${total} model${total === 1 ? "" : "s"}`}
      </p>
      {providerOptions.length > 0 && (
        <div className="radar-filter-chips" role="group" aria-label="Provider chips">
          <button
            type="button"
            className={`radar-chip ${filters.provider == null ? "radar-chip-active" : ""}`}
            onClick={() => onChange({ ...filters, provider: null })}
          >
            All
          </button>
          {providerOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`radar-chip ${filters.provider === option.value ? "radar-chip-active" : ""}`}
              onClick={() =>
                onChange({
                  ...filters,
                  provider: filters.provider === option.value ? null : option.value,
                })
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
