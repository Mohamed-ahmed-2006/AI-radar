import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { OptimizerForm } from "../../components/product/optimizer/OptimizerForm";
import { OptimizerModelCard } from "../../components/product/optimizer/OptimizerModelCard";
import { OptimizerResults } from "../../components/product/optimizer/OptimizerResults";
import { EligibilityStatus } from "../../components/product/optimizer/EligibilityStatus";
import { RequirementChecks } from "../../components/product/optimizer/RequirementChecks";
import { ErrorState, LoadingState } from "../../components/radar/ui/DataState";
import {
  DEFAULT_OPTIMIZER_INPUT,
  appliedConstraintsFromInput,
} from "../../lib/product/optimizer";
import { fixtureOptimizerModels } from "../../lib/product/optimizer-fixture";

const models = fixtureOptimizerModels();
const eligible = models.filter((model) => model.eligibility === "eligible");
const other = models.filter((model) => model.eligibility !== "eligible");

const result = {
  input: DEFAULT_OPTIMIZER_INPUT,
  appliedConstraints: appliedConstraintsFromInput(DEFAULT_OPTIMIZER_INPUT),
  bestFit: eligible[0],
  ranked: eligible,
  other,
  providerOptions: [],
  generatedAt: "2026-08-19T12:00:00.000Z",
  isDemo: true,
  evidenceQuality: "current" as const,
  evidenceNote: "Fixture",
  emptyReason: null,
};

test("Optimizer form exposes labelled numeric inputs and keyboard-accessible constraints", () => {
  const html = renderToStaticMarkup(
    <OptimizerForm
      input={DEFAULT_OPTIMIZER_INPUT}
      onChange={() => undefined}
      onSubmit={() => undefined}
    />,
  );

  assert.match(html, /aria-label="Stack optimizer inputs"/);
  assert.match(html, /for="optimizer-input-tokens"/);
  assert.match(html, /for="optimizer-output-tokens"/);
  assert.match(html, /for="optimizer-min-context"/);
  assert.match(html, /for="optimizer-min-max-output"/);
  assert.match(html, /for="optimizer-priority"/);
  assert.match(html, /for="optimizer-vision"/);
  assert.match(html, /for="optimizer-tools"/);
  assert.match(html, /for="optimizer-active"/);
  assert.match(html, /for="optimizer-provider-anthropic"/);
  assert.match(html, /<fieldset/);
  assert.match(html, /<legend[^>]*>Provider constraints/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /Vision required/);
  assert.match(html, /Tool calling required/);
  assert.match(html, /Active only/);
  assert.match(html, />Find best fit</);
});

test("Ranked results present best fit, estimated cost, and adapter-supplied rank", () => {
  const html = renderToStaticMarkup(<OptimizerResults result={result} />);

  assert.match(html, />Best fit</);
  assert.match(html, /<ol [^>]*aria-label="Ranked eligible models"/);
  assert.match(html, /Claude Sonnet 4\.5/);
  assert.match(html, /\$45\.00/);
  assert.match(html, /Rank 1/);
  assert.match(html, /GPT-4o/);
  assert.match(html, /Compare eligible/);
});

test("Excluded model states the requirement reason in words", () => {
  const excluded = models.find((model) => model.eligibility === "excluded");
  assert.ok(excluded);
  const html = renderToStaticMarkup(<OptimizerModelCard result={excluded} />);

  assert.match(html, /Excluded/);
  assert.match(html, /minimum context/i);
  assert.match(html, /radar-eligibility-excluded/);
  assert.match(html, /Requirement checks for Claude Haiku 3\.5/);
});

test("Unknown capability and unknown evidence never render as unsupported", () => {
  const unknown = models.find((model) => model.eligibility === "unknown_evidence");
  assert.ok(unknown);
  const html = renderToStaticMarkup(<OptimizerModelCard result={unknown} />);

  assert.match(html, /Unknown evidence/);
  assert.match(html, /Unknown/);
  assert.match(html, /not the same as unsupported/i);
  assert.doesNotMatch(html, /Unsupported/);
  assert.match(html, /radar-capability-unknown/);
});

test("Unavailable pricing is labelled Unavailable, not ineligible", () => {
  const priced = models.find((model) => model.eligibility === "unavailable_pricing");
  assert.ok(priced);
  const html = renderToStaticMarkup(<OptimizerModelCard result={priced} />);

  assert.match(html, /Pricing unavailable/);
  assert.match(html, /Unavailable/);
  assert.match(html, /No input or output price has been observed/);
  assert.doesNotMatch(html, /Unsupported/);
});

test("Eligibility is a word as well as a class, never colour alone", () => {
  const eligibleHtml = renderToStaticMarkup(
    <EligibilityStatus eligibility="eligible" />,
  );
  const unknownHtml = renderToStaticMarkup(
    <EligibilityStatus eligibility="unknown_evidence" />,
  );

  assert.match(eligibleHtml, /Eligible/);
  assert.match(eligibleHtml, /radar-eligibility-eligible/);
  assert.match(unknownHtml, /Unknown evidence/);
  assert.match(unknownHtml, /radar-eligibility-unknown_evidence/);
});

test("Requirement checks label unknown as Unknown, not Fail", () => {
  const html = renderToStaticMarkup(
    <RequirementChecks
      checks={[
        {
          id: "vision",
          label: "Vision",
          status: "unknown",
          detail: "Vision was not observed. Unknown is not the same as unsupported.",
        },
      ]}
    />,
  );

  assert.match(html, />Unknown</);
  assert.match(html, /not the same as unsupported/);
  assert.doesNotMatch(html, />Fail</);
  assert.doesNotMatch(html, /Unsupported/);
});

test("Optimizer cards expose provenance with the existing disclosure primitive", () => {
  const html = renderToStaticMarkup(<OptimizerModelCard result={eligible[0]} />);

  assert.match(html, /<details/);
  assert.match(html, /<summary/);
  assert.match(html, /Where did this come from\?/);
  assert.match(html, /Official source/);
  assert.match(html, /<article/);
  assert.match(html, /<dl/);
});

test("Optimizer cards link to model detail, compare, My Stack and Sources", () => {
  const html = renderToStaticMarkup(<OptimizerModelCard result={eligible[0]} />);

  assert.match(html, /href="\/models\/anthropic%3Aclaude-sonnet-4-5"/);
  assert.match(html, /href="\/models\/compare\?ids=/);
  assert.match(html, /href="\/my-stack"/);
  assert.match(html, /href="\/sources"/);
});

test("Empty, loading and error optimizer states are announced", () => {
  const empty = renderToStaticMarkup(
    <OptimizerResults
      result={{ ...result, bestFit: null, ranked: [], other: [], emptyReason: "No eligible models." }}
    />,
  );
  const loading = renderToStaticMarkup(<LoadingState title="Finding the best fit…" />);
  const error = renderToStaticMarkup(
    <ErrorState
      title="The optimizer could not be read"
      description="Adapter unavailable."
    />,
  );

  assert.match(empty, /role="status"/);
  assert.match(empty, /No models were returned/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /Finding the best fit/);
  assert.match(error, /role="alert"/);
  assert.match(error, /The optimizer could not be read/);
});
