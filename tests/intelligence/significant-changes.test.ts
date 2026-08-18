import test from "node:test";
import assert from "node:assert/strict";

import { getDemoTemporalEvidence } from "../../lib/intelligence/demo-evidence";
import { extractMostSignificantChanges } from "../../lib/intelligence/ecosystem-highlights";

const REF_DATE = "2026-08-18T12:00:00.000Z";

test("Significant ecosystem moves extracts and ranks top impact changes", () => {
  const dataset = getDemoTemporalEvidence();
  const summary = extractMostSignificantChanges(dataset, {
    range: "30d",
    limit: 5,
    minScore: 80,
    referenceDate: REF_DATE,
  });

  assert(summary.topChanges.length > 0);
  assert(summary.topChanges.length <= 5);

  for (let i = 1; i < summary.topChanges.length; i++) {
    const prevScore = summary.topChanges[i - 1].significanceScore;
    const currScore = summary.topChanges[i].significanceScore;
    assert(prevScore >= currScore, "Changes must be ranked by significance score desc");
  }

  for (const item of summary.topChanges) {
    assert(item.significanceScore >= 80);
    assert(item.impactReason, "Impact reason must be provided for significant items");
  }

  assert(summary.headline.includes("high-impact changes"));
});
