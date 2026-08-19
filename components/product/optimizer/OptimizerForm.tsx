"use client";

import type { ExplorerFilterOption } from "../../../lib/product/explorer";
import {
  OPTIMIZATION_PRIORITIES,
  OPTIMIZER_PROVIDER_OPTIONS,
  optimizationPriorityLabel,
  toggleOptimizerProvider,
  type OptimizerInput,
} from "../../../lib/product/optimizer";

interface OptimizerFormProps {
  input: OptimizerInput;
  providerOptions?: readonly ExplorerFilterOption[];
  onChange: (input: OptimizerInput) => void;
  onSubmit: () => void;
  busy?: boolean;
}

function parseOptionalNumber(raw: string): number | null {
  if (raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Presentation-state optimizer controls. Ranking is the adapter's job — this
 * form only collects values and submits them.
 */
export function OptimizerForm({
  input,
  providerOptions = OPTIMIZER_PROVIDER_OPTIONS,
  onChange,
  onSubmit,
  busy = false,
}: OptimizerFormProps) {
  return (
    <form
      className="radar-optimizer-form"
      aria-label="Stack optimizer inputs"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="radar-filters">
        <div className="radar-filter">
          <label className="radar-filter-label" htmlFor="optimizer-input-tokens">
            Monthly input tokens
          </label>
          <input
            id="optimizer-input-tokens"
            className="radar-filter-control"
            type="number"
            inputMode="numeric"
            min={0}
            step={1000}
            placeholder="e.g. 10000000"
            value={input.monthlyInputTokens ?? ""}
            onChange={(event) =>
              onChange({
                ...input,
                monthlyInputTokens: parseOptionalNumber(event.target.value),
              })
            }
          />
        </div>

        <div className="radar-filter">
          <label className="radar-filter-label" htmlFor="optimizer-output-tokens">
            Monthly output tokens
          </label>
          <input
            id="optimizer-output-tokens"
            className="radar-filter-control"
            type="number"
            inputMode="numeric"
            min={0}
            step={1000}
            placeholder="e.g. 1000000"
            value={input.monthlyOutputTokens ?? ""}
            onChange={(event) =>
              onChange({
                ...input,
                monthlyOutputTokens: parseOptionalNumber(event.target.value),
              })
            }
          />
        </div>

        <div className="radar-filter">
          <label className="radar-filter-label" htmlFor="optimizer-min-context">
            Minimum context
          </label>
          <input
            id="optimizer-min-context"
            className="radar-filter-control"
            type="number"
            inputMode="numeric"
            min={0}
            step={1000}
            placeholder="e.g. 128000"
            value={input.minContext ?? ""}
            onChange={(event) =>
              onChange({
                ...input,
                minContext: parseOptionalNumber(event.target.value),
              })
            }
          />
        </div>

        <div className="radar-filter">
          <label className="radar-filter-label" htmlFor="optimizer-min-max-output">
            Minimum max output
          </label>
          <input
            id="optimizer-min-max-output"
            className="radar-filter-control"
            type="number"
            inputMode="numeric"
            min={0}
            step={256}
            placeholder="Where available"
            value={input.minMaxOutput ?? ""}
            onChange={(event) =>
              onChange({
                ...input,
                minMaxOutput: parseOptionalNumber(event.target.value),
              })
            }
          />
        </div>

        <div className="radar-filter">
          <label className="radar-filter-label" htmlFor="optimizer-priority">
            Optimization priority
          </label>
          <select
            id="optimizer-priority"
            className="radar-filter-control"
            value={input.priority}
            onChange={(event) =>
              onChange({
                ...input,
                priority: event.target.value as OptimizerInput["priority"],
              })
            }
          >
            {OPTIMIZATION_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {optimizationPriorityLabel(priority)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="radar-optimizer-fieldset">
        <legend className="radar-filter-label">Provider constraints</legend>
        <div className="radar-optimizer-providers">
          {providerOptions.map((option) => {
            const checked = input.providers.includes(option.value);
            const id = `optimizer-provider-${option.value}`;
            return (
              <div key={option.value} className="radar-filter radar-filter-inline">
                <input
                  id={id}
                  type="checkbox"
                  className="radar-filter-checkbox"
                  checked={checked}
                  onChange={() =>
                    onChange({
                      ...input,
                      providers: toggleOptimizerProvider(input.providers, option.value),
                    })
                  }
                />
                <label className="radar-filter-label" htmlFor={id}>
                  {option.label}
                </label>
              </div>
            );
          })}
        </div>
      </fieldset>

      <div className="radar-optimizer-toggles">
        <div className="radar-filter radar-filter-inline">
          <input
            id="optimizer-vision"
            type="checkbox"
            className="radar-filter-checkbox"
            checked={input.visionRequired}
            onChange={(event) =>
              onChange({ ...input, visionRequired: event.target.checked })
            }
          />
          <label className="radar-filter-label" htmlFor="optimizer-vision">
            Vision required
          </label>
        </div>

        <div className="radar-filter radar-filter-inline">
          <input
            id="optimizer-tools"
            type="checkbox"
            className="radar-filter-checkbox"
            checked={input.toolCallingRequired}
            onChange={(event) =>
              onChange({ ...input, toolCallingRequired: event.target.checked })
            }
          />
          <label className="radar-filter-label" htmlFor="optimizer-tools">
            Tool calling required
          </label>
        </div>

        <div className="radar-filter radar-filter-inline">
          <input
            id="optimizer-active"
            type="checkbox"
            className="radar-filter-checkbox"
            checked={input.activeOnly}
            onChange={(event) =>
              onChange({ ...input, activeOnly: event.target.checked })
            }
          />
          <label className="radar-filter-label" htmlFor="optimizer-active">
            Active only
          </label>
        </div>
      </div>

      <div className="radar-optimizer-actions">
        <button type="submit" className="radar-primary-button" disabled={busy}>
          {busy ? "Finding best fit…" : "Find best fit"}
        </button>
        <p className="radar-optimizer-hint">
          Ranking and cost estimates come from the optimizer adapter. This form
          does not calculate them.
        </p>
      </div>
    </form>
  );
}
