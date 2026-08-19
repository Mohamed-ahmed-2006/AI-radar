import test from "node:test";
import assert from "node:assert/strict";

import { DEMO_TEMPORAL_EVIDENCE } from "../../lib/intelligence/demo-evidence";
import {
  hasProvenanceDetail,
  provenanceFromEvidence,
  provenanceFromSource,
  provenanceRows,
  provenanceTrustFromAuthority,
  provenanceTrustLabel,
} from "../../lib/product/provenance";

test("Provenance: normalises a temporal event into the shared vocabulary", () => {
  const evidence = DEMO_TEMPORAL_EVIDENCE[0];
  const provenance = provenanceFromEvidence(evidence);

  assert.equal(provenance.sourceUrl, evidence.source.url);
  assert.equal(provenance.collectorId, evidence.source.collectorId);
  assert.equal(provenance.observedAt, evidence.observedAt);
  assert.equal(provenance.runId, evidence.provenance.runId);
  assert.equal(provenance.externalRunId, evidence.provenance.externalRunId);
  assert.equal(provenance.isDemo, true);
  assert.equal(provenance.trust, "official");
});

test("Provenance: trust is derived from the authority the backend reported", () => {
  assert.equal(provenanceTrustFromAuthority("authoritative"), "official");
  assert.equal(provenanceTrustFromAuthority("verified_scrape"), "verified");
  assert.equal(provenanceTrustFromAuthority("inferred"), "inferred");
  assert.equal(provenanceTrustFromAuthority(null), "unverified");
  assert.equal(provenanceTrustLabel("official"), "Official source");
});

test("Provenance: rows cover the facts a reader inspects", () => {
  const rows = provenanceRows(provenanceFromEvidence(DEMO_TEMPORAL_EVIDENCE[0]));
  const ids = rows.map((row) => row.id);

  for (const expected of ["source", "source-url", "observed-at", "collector", "trust", "run"]) {
    assert(ids.includes(expected), `expected a ${expected} row`);
  }

  const url = rows.find((row) => row.id === "source-url");
  assert.equal(url?.kind, "url");
  assert.equal(url?.href, DEMO_TEMPORAL_EVIDENCE[0].source.url);

  assert.equal(rows.find((row) => row.id === "observed-at")?.kind, "time");
  assert.equal(rows.find((row) => row.id === "collector")?.kind, "mono");
});

test("Provenance: absent facts produce no row at all", () => {
  const rows = provenanceRows(
    provenanceFromSource({ sourceLabel: "Unnamed source", sourceUrl: null }),
  );
  const ids = rows.map((row) => row.id);

  assert(!ids.includes("source-url"));
  assert(!ids.includes("collector"));
  assert(!ids.includes("observed-at"));
  assert(!ids.includes("run"));
  assert(ids.includes("trust"), "trust is always derivable");
});

test("Provenance: a source with nothing but a derived trust level says so", () => {
  const bare = provenanceFromSource({});
  assert.equal(hasProvenanceDetail(bare), false);
  assert.equal(bare.trust, "unverified");

  const known = provenanceFromSource({ collectorId: "c_abc123" });
  assert.equal(hasProvenanceDetail(known), true);
});

test("Provenance: a source carries its validation state verbatim", () => {
  const provenance = provenanceFromSource({
    sourceLabel: "OpenAI API pricing",
    collectorId: "c_abc123",
    validation: { label: "Quarantined", status: "failing" },
  });

  const validation = provenanceRows(provenance).find((row) => row.id === "validation");
  assert.equal(validation?.value, "Quarantined");
  assert.equal(provenance.validation?.status, "failing");
});

test("Provenance: blank strings are treated as unknown, not as empty values", () => {
  const provenance = provenanceFromSource({
    sourceLabel: "   ",
    collectorId: "",
    sourceUrl: "  ",
  });

  assert.equal(provenance.sourceLabel, null);
  assert.equal(provenance.collectorId, null);
  assert.equal(provenance.sourceUrl, null);
});
