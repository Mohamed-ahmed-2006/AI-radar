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
          placeholder="What changed in Claude this month?"
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

export function AskGroundingPresets({
  onSelect,
}: {
  onSelect: (query: string) => void;
}) {
  return (
    <section className="radar-ask-grounding-presets" aria-labelledby="ask-grounding-presets-heading">
      <h2 id="ask-grounding-presets-heading" className="radar-ask-grounding-title">
        Try the grounding
      </h2>
      <ul className="radar-ask-example-list" aria-label="Grounding preset questions">
        {ASK_GROUNDING_PRESETS.map((preset) => (
          <li key={preset.id}>
            <button
              type="button"
              className="radar-ask-example"
              onClick={() => onSelect(preset.query)}
            >
              {preset.query}
            </button>
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
  const fact = ASK_EXAMPLE_QUERIES.filter((example) => example.intent === "fact");
  const decision = ASK_EXAMPLE_QUERIES.filter((example) => example.intent === "decision");

  return (
    <div className="radar-ask-examples">
      <section aria-labelledby="ask-fact-examples-heading">
        <h2 id="ask-fact-examples-heading" className="radar-subheading">
          Model fact
        </h2>
        <ul className="radar-ask-example-list" aria-label="Model fact example questions">
          {fact.map((example) => (
            <li key={example.id}>
              <button
                type="button"
                className="radar-ask-example"
                onClick={() => onSelect(example.query)}
              >
                {example.label}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="ask-temporal-examples-heading">
        <h2 id="ask-temporal-examples-heading" className="radar-subheading">
          Temporal
        </h2>
        <ul className="radar-ask-example-list" aria-label="Temporal example questions">
          {temporal.map((example) => (
            <li key={example.id}>
              <button
                type="button"
                className="radar-ask-example"
                onClick={() => onSelect(example.query)}
              >
                {example.label}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="ask-decision-examples-heading">
        <h2 id="ask-decision-examples-heading" className="radar-subheading">
          Decision
        </h2>
        <ul className="radar-ask-example-list" aria-label="Decision example questions">
          {decision.map((example) => (
            <li key={example.id}>
              <button
                type="button"
                className="radar-ask-example"
                onClick={() => onSelect(example.query)}
              >
                {example.label}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
