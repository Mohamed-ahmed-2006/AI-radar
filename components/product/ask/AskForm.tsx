"use client";

import { ASK_EXAMPLE_QUERIES, ASK_GROUNDING_PRESETS } from "../../../lib/product/ask";

interface AskFormProps {
  query: string;
  onChange: (query: string) => void;
  onSubmit: () => void;
  busy?: boolean;
}

/** Single-query Ask AI Radar input. No chat history. */
export function AskForm({
  query,
  onChange,
  onSubmit,
  busy = false,
}: AskFormProps) {
  return (
    <form
      className="radar-ask-form"
      aria-label="Ask AI Radar"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="radar-ask-field">
        <label className="radar-filter-label" htmlFor="ask-query">
          Question
        </label>
        <textarea
          id="ask-query"
          className="radar-ask-input"
          name="q"
          rows={3}
          value={query}
          placeholder="Does Claude Opus 5 support video input?"
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <div className="radar-optimizer-actions">
        <button
          type="submit"
          className="radar-primary-button"
          disabled={busy || query.trim().length === 0}
        >
          {busy ? "Reading evidence…" : "Ask AI Radar"}
        </button>
      </div>
    </form>
  );
}

function PresetChip({
  label,
  query,
  onSelect,
}: {
  label: string;
  query: string;
  onSelect: (query: string) => void;
}) {
  return (
    <button
      type="button"
      className="radar-ask-chip"
      onClick={() => onSelect(query)}
    >
      {label}
    </button>
  );
}

export function AskGroundingPresets({
  onSelect,
}: {
  onSelect: (query: string) => void;
}) {
  const groundingQueries = new Set<string>(ASK_GROUNDING_PRESETS.map((preset) => preset.query));
  const extraFacts = ASK_EXAMPLE_QUERIES.filter(
    (example) => example.intent === "fact" && !groundingQueries.has(example.query),
  );

  return (
    <section className="radar-ask-preset-group" aria-labelledby="ask-grounding-presets-heading">
      <h2 id="ask-grounding-presets-heading" className="radar-ask-grounding-title">
        Try grounding
      </h2>
      <ul className="radar-ask-chip-list" aria-label="Grounding preset questions">
        {ASK_GROUNDING_PRESETS.map((preset) => (
          <li key={preset.id}>
            <PresetChip label={preset.query} query={preset.query} onSelect={onSelect} />
          </li>
        ))}
        {extraFacts.map((example) => (
          <li key={example.id}>
            <PresetChip label={example.label} query={example.query} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AskExamples({
  onSelect,
}: {
  onSelect: (query: string) => void;
}) {
  const temporal = ASK_EXAMPLE_QUERIES.filter((example) => example.intent === "temporal");
  const decision = ASK_EXAMPLE_QUERIES.filter((example) => example.intent === "decision");

  return (
    <div className="radar-ask-examples">
      <section className="radar-ask-preset-group" aria-labelledby="ask-temporal-examples-heading">
        <h2 id="ask-temporal-examples-heading" className="radar-ask-grounding-title">
          Temporal
        </h2>
        <ul className="radar-ask-chip-list" aria-label="Temporal example questions">
          {temporal.map((example) => (
            <li key={example.id}>
              <PresetChip label={example.label} query={example.query} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      </section>
      <section className="radar-ask-preset-group" aria-labelledby="ask-decision-examples-heading">
        <h2 id="ask-decision-examples-heading" className="radar-ask-grounding-title">
          Decision
        </h2>
        <ul className="radar-ask-chip-list" aria-label="Decision example questions">
          {decision.map((example) => (
            <li key={example.id}>
              <PresetChip label={example.label} query={example.query} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
