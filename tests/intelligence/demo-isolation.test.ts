import test from "node:test";
import assert from "node:assert/strict";

import {
  DEMO_TEMPORAL_EVIDENCE,
} from "../../lib/intelligence/demo-evidence";
import { queryTemporalIntelligence } from "../../lib/intelligence/read-model";
import { TemporalEvidenceSchema } from "../../lib/intelligence/contracts";

test("Demo evidence isolation: all demo items are explicitly marked with isDemo: true", () => {
  assert(DEMO_TEMPORAL_EVIDENCE.length >= 10, "Demo evidence must contain realistic historical depth");

  for (const evidence of DEMO_TEMPORAL_EVIDENCE) {
    // Validate schema
    TemporalEvidenceSchema.parse(evidence);

    // Verify demo isolation marker
    assert.equal(
      evidence.isDemo,
      true,
      `Evidence item ${evidence.id} must have isDemo: true`,
    );

    // Verify essential provenance fields are never null/empty
    assert(evidence.id.startsWith("demo-"), `Demo item ID must have demo- prefix: ${evidence.id}`);
    assert(evidence.source.url.startsWith("http"), `Source URL must be valid: ${evidence.source.url}`);
    assert(evidence.provenance.runId?.startsWith("demo-run-"), `Run ID must be isolated: ${evidence.provenance.runId}`);
  }
});

test("Demo isolation: queryTemporalIntelligence with demo=false does not mix demo data", async () => {
  // In a standalone environment without database rows, live query returns an empty bundle with isDemoData: false
  const liveBundle = await queryTemporalIntelligence({ demo: false, range: "30d" });
  assert.equal(liveBundle.isDemoData, false);

  // Demo query explicitly returns demo data
  const demoBundle = await queryTemporalIntelligence({ demo: true, range: "30d" });
  assert.equal(demoBundle.isDemoData, true);
  assert(demoBundle.events.every((e) => e.isDemo));
});
