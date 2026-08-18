import test from "node:test";
import assert from "node:assert/strict";

import { getDemoTemporalEvidence } from "../../lib/intelligence/demo-evidence";
import { compareProvidersOverPeriod } from "../../lib/intelligence/provider-comparison";

const REF_DATE = "2026-08-18T12:00:00.000Z";

test("Provider comparison computes period metrics across Anthropic, Google, OpenAI, and xAI", () => {
  const dataset = getDemoTemporalEvidence();
  const result = compareProvidersOverPeriod(dataset, {
    range: "30d",
    referenceDate: REF_DATE,
  });

  assert.equal(result.range, "30d");
  assert(result.providers.anthropic, "Anthropic must be in comparison");
  assert(result.providers.google, "Google must be in comparison");
  assert(result.providers.openai, "OpenAI must be in comparison");
  assert(result.providers.xai, "xAI must be in comparison");

  // Anthropic has price cuts, additions, deprecations
  const antStats = result.providers.anthropic;
  assert(antStats.totalEvents > 0);
  assert(antStats.priceChanges.reductions > 0);
  assert(antStats.priceChanges.avgReductionPercent !== null);
  assert(antStats.launches.length > 0);

  // OpenAI has price reductions for GPT-4o
  const oaiStats = result.providers.openai;
  assert(oaiStats.priceChanges.reductions > 0);
  assert(oaiStats.launches.includes("gpt-4o-mini"));

  // Comparison highlights
  assert(result.comparisonHighlights.length > 0);
  assert(result.comparisonHighlights.some((h) => h.includes("Anthropic")));
});
