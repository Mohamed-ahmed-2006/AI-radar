import test from "node:test";
import assert from "node:assert/strict";

import { getDemoTemporalEvidence } from "../../lib/intelligence/demo-evidence";
import { executeTemporalQuery } from "../../lib/intelligence/query-engine";
import {
  buildDeterministicNarrativeSummary,
  verifySummaryGroundedness,
} from "../../lib/intelligence/summarizer";

const REF_DATE = "2026-08-18T12:00:00.000Z";

test("Hero question synthesis: 'What changed in Claude this month?' produces comprehensive grounded summary", () => {
  const dataset = getDemoTemporalEvidence();
  const bundle = executeTemporalQuery(dataset, {
    provider: "anthropic",
    range: "30d",
    referenceDate: REF_DATE,
  });

  const narrative = buildDeterministicNarrativeSummary(bundle);

  // 1. Must mention Claude 3.5 Sonnet caching price cut
  assert(narrative.includes("claude-3-5-sonnet-20241022") || narrative.includes("Claude 3.5 Sonnet"));
  assert(narrative.includes("90% savings") || narrative.includes("0.30") || narrative.includes("0.3"));

  // 2. Must mention Claude 3 Opus deprecation schedule
  assert(narrative.includes("claude-3-opus-20240229"));
  assert(narrative.includes("2026-08-01") || narrative.includes("2027-01-05"));

  // 3. Must include verified source provenance URLs
  assert(narrative.includes("https://www.anthropic.com/pricing"));
  assert(narrative.includes("https://docs.anthropic.com/en/docs/resources/model-deprecations"));

  // 4. Verification must confirm 100% groundedness
  const verification = verifySummaryGroundedness(narrative, bundle.events);
  assert.equal(verification.isGrounded, true);
  assert.equal(verification.violations.length, 0);
});

test("Zero-hallucination guardrail rejects unsupported models, prices, and dates", () => {
  const dataset = getDemoTemporalEvidence();
  const claudeEvents = dataset.filter((e) => e.provider === "anthropic");

  // A) Valid grounded summary
  const validText = "Anthropic updated claude-3-5-sonnet-20241022 with cached pricing at $0.30 on 2026-08-11.";
  const validRes = verifySummaryGroundedness(validText, claudeEvents);
  assert.equal(validRes.isGrounded, true);
  assert.equal(validRes.violations.length, 0);

  // B) Hallucinated price: $88.88
  const hallucinatedPriceText = "Anthropic dropped claude-3-5-sonnet-20241022 price to $88.88 on 2026-08-11.";
  const priceRes = verifySummaryGroundedness(hallucinatedPriceText, claudeEvents);
  assert.equal(priceRes.isGrounded, false);
  assert(priceRes.violations.some((v) => v.includes("$88.88")));

  // C) Hallucinated date: 2035-05-20
  const hallucinatedDateText = "Anthropic scheduled retirement on 2035-05-20 for claude-3-opus-20240229.";
  const dateRes = verifySummaryGroundedness(hallucinatedDateText, claudeEvents);
  assert.equal(dateRes.isGrounded, false);
  assert(dateRes.violations.some((v) => v.includes("2035-05-20")));

  // D) Sanitized summary fallback
  assert(dateRes.sanitizedSummary, "Must provide safe sanitized fallback");
  assert(!dateRes.sanitizedSummary.includes("2035-05-20"), "Sanitized summary must not contain the hallucinated date");
});
