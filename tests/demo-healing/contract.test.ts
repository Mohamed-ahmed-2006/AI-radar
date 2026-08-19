/**
 * The demo source's contract, judged by the shared Sentinel evaluator.
 *
 * These tests exist to show the contract is doing real discrimination: it
 * accepts what a working template produces and refuses each way a broken one
 * actually fails. If the contract were permissive, every later proof in this
 * suite would be worthless, because a quarantine could be reached by accident
 * rather than by detection.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  adaptDemoQuoteRecord,
  createDemoPreviewContract,
  createDemoSourceHealthContract,
  demoQuoteIdentity,
  DEMO_MIN_VIABLE_RECORDS,
  RawDemoQuoteRecordSchema,
  type RawDemoQuoteRecord,
} from "../../lib/demo-healing/contract";
import { evaluateSourceHealth } from "../../lib/sentinel/evaluator";
import {
  containerLatchPayload,
  emptyPayload,
  goodPreview,
  badPreview,
  healthyPayload,
  markupLeakPayload,
  partialHealthyPayload,
  renamedFieldPayload,
  tableLayoutPayload,
} from "./support/payloads";

const contract = createDemoSourceHealthContract("src-demo");

test("contract: accepts the payload a working template produces", () => {
  const result = evaluateSourceHealth<RawDemoQuoteRecord>(healthyPayload(), contract);

  assert.equal(result.isHealthy, true);
  assert.equal(result.shouldQuarantine, false);
  assert.equal(result.status, "healthy");
  assert.equal(result.recordsInvalid, 0);
  assert.equal(result.recordsValid, healthyPayload().length);
  assert.deepEqual(result.reasonCodes, []);
});

test("contract: normalises field-name variants without loosening the schema", () => {
  const result = evaluateSourceHealth<RawDemoQuoteRecord>(renamedFieldPayload(), contract);

  assert.equal(result.isHealthy, true, result.summary);
  assert.equal(result.recordsInvalid, 0);
  // The comma-separated keyword string was split back into a real array.
  assert.ok(result.validRecords[0]!.tags.length >= 2);
});

test("contract: a renamed field is normalised, a missing one is still a failure", () => {
  const missingAuthor = [{ text: "The unexamined life is not worth living.", keywords: "x" }];
  const result = evaluateSourceHealth<RawDemoQuoteRecord>(missingAuthor, contract);

  assert.equal(result.shouldQuarantine, true);
  assert.ok(result.reasonCodes.includes("SCHEMA_VALIDATION_FAILURE"));
});

test("contract: refuses the table-layout payload, where every field selector missed", () => {
  const result = evaluateSourceHealth<RawDemoQuoteRecord>(tableLayoutPayload(), contract);

  assert.equal(result.isHealthy, false);
  assert.equal(result.shouldQuarantine, true);
  assert.equal(result.recordsValid, 0);
  assert.ok(result.reasonCodes.includes("SCHEMA_VALIDATION_FAILURE"));
  assert.ok(result.reasonCodes.includes("RECORD_COUNT_COLLAPSE"));
});

test("contract: refuses a total miss", () => {
  const result = evaluateSourceHealth<RawDemoQuoteRecord>(emptyPayload(), contract);

  assert.equal(result.shouldQuarantine, true);
  assert.deepEqual(result.reasonCodes, ["ZERO_RECORDS"]);
});

test("contract: refuses a container latch even though every record parses", () => {
  const payload = containerLatchPayload();
  // Each record on its own is well-formed text — only the invariants catch it.
  for (const record of payload) {
    assert.equal(RawDemoQuoteRecordSchema.safeParse(adaptDemoQuoteRecord(record)).success, true);
  }

  const result = evaluateSourceHealth<RawDemoQuoteRecord>(payload, contract);
  assert.equal(result.shouldQuarantine, true);
  assert.ok(
    result.reasonCodes.includes("SEMANTIC_INVARIANT_VIOLATION") ||
      result.reasonCodes.includes("DUPLICATE_IDENTIFIERS"),
    `expected a semantic or duplicate refusal, got ${result.reasonCodes.join(", ")}`,
  );
});

test("contract: refuses values with raw markup leaked in", () => {
  const result = evaluateSourceHealth<RawDemoQuoteRecord>(markupLeakPayload(), contract);

  assert.equal(result.shouldQuarantine, true);
  assert.ok(result.reasonCodes.includes("SCHEMA_VALIDATION_FAILURE"));
  assert.ok(
    result.issues.some((issue) => issue.message.includes("raw HTML markup")),
    "the refusal should name markup as the cause",
  );
});

test("contract: a single bad record condemns the batch — this source is strict", () => {
  const payload: unknown[] = [...healthyPayload(), { quote_text: "", author: "", tags: [] }];
  const result = evaluateSourceHealth<RawDemoQuoteRecord>(payload, contract);

  assert.equal(contract.failurePolicy.quarantineThresholdPercentage, 0);
  assert.equal(result.shouldQuarantine, true);
  assert.equal(result.recordsInvalid, 1);
});

test("contract: a collapse against last-known-good is refused on volume alone", () => {
  const result = evaluateSourceHealth<RawDemoQuoteRecord>(
    partialHealthyPayload(2),
    contract,
    { runId: "run-prev", recordCount: 10, observedAt: new Date().toISOString(), externalRunId: null },
  );

  assert.equal(result.shouldQuarantine, true);
  assert.ok(result.reasonCodes.includes("RECORD_COUNT_COLLAPSE"));
});

test("contract: identity is stable and distinguishes different quotations", () => {
  const [first, second] = healthyPayload();
  assert.equal(demoQuoteIdentity(first!), demoQuoteIdentity({ ...first! }));
  assert.notEqual(demoQuoteIdentity(first!), demoQuoteIdentity(second!));
});

// ---------------------------------------------------------------------------
// Preview contract
// ---------------------------------------------------------------------------

const previewContract = createDemoPreviewContract("src-demo");

test("preview contract: relaxes volume and nothing else", () => {
  assert.equal(previewContract.minViableRecords, 1);
  assert.equal(contract.minViableRecords, DEMO_MIN_VIABLE_RECORDS);
  assert.equal(previewContract.sourceId, contract.sourceId);
  assert.deepEqual(previewContract.requiredFields, contract.requiredFields);
  assert.deepEqual(previewContract.failurePolicy, contract.failurePolicy);

  // The checks that actually distinguish a repaired template from a broken one
  // must reach the same verdict under both contracts, record for record.
  const payloads: unknown[][] = [
    healthyPayload(),
    renamedFieldPayload(),
    tableLayoutPayload(),
    markupLeakPayload(),
    containerLatchPayload(),
    [{ quote_text: "The unexamined life is not worth living.", author: "Socrates", tags: [] }],
  ];
  for (const payload of payloads) {
    const live = evaluateSourceHealth<RawDemoQuoteRecord>(payload, contract);
    const preview = evaluateSourceHealth<RawDemoQuoteRecord>(payload, previewContract);
    assert.equal(preview.recordsValid, live.recordsValid);
    assert.equal(preview.recordsInvalid, live.recordsInvalid);
    // Every non-volume reason code the live contract raises is raised here too.
    const volumeCodes = new Set(["RECORD_COUNT_COLLAPSE", "RECORD_COUNT_SPIKE"]);
    assert.deepEqual(
      preview.reasonCodes.filter((code) => !volumeCodes.has(code)).sort(),
      live.reasonCodes.filter((code) => !volumeCodes.has(code)).sort(),
    );
  }
});

test("preview contract: a two-record sample of good data passes", () => {
  const result = evaluateSourceHealth<RawDemoQuoteRecord>(goodPreview(), previewContract);

  assert.equal(result.isHealthy, true, result.summary);
  assert.equal(result.shouldQuarantine, false);
});

test("preview contract: the same two-record sample is refused by the live contract", () => {
  // Proof that the relaxation is real and load-bearing, and equally that the
  // live gate would still catch a genuinely thin run.
  const result = evaluateSourceHealth<RawDemoQuoteRecord>(goodPreview(), contract);

  assert.equal(result.shouldQuarantine, true);
  assert.ok(result.reasonCodes.includes("RECORD_COUNT_COLLAPSE"));
});

test("preview contract: still refuses a candidate that did not fix anything", () => {
  const result = evaluateSourceHealth<RawDemoQuoteRecord>(badPreview(), previewContract);

  assert.equal(result.isHealthy, false);
  assert.equal(result.shouldQuarantine, true);
  assert.ok(result.reasonCodes.includes("SCHEMA_VALIDATION_FAILURE"));
});

test("preview contract: still refuses a container latch", () => {
  const result = evaluateSourceHealth<RawDemoQuoteRecord>(
    containerLatchPayload(3),
    previewContract,
  );

  assert.equal(result.shouldQuarantine, true);
});
