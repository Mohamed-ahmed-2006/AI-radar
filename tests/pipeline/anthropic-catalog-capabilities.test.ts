/**
 * The Anthropic capability regression, end to end over the shape the live
 * collector actually returns.
 *
 * Production showed every current Claude model with "not observed" context and
 * max output and "Unknown" vision, while the cited page publishes all three.
 * Two faults produced that: the normalizer only read fully written integers, so
 * the table's "1M tokens" and "128k tokens" resolved to null; and the collector
 * never captured the page's modality sentence, so the modality lists arrived
 * empty and vision stayed unobserved.
 *
 * These tests pin both halves, and pin the two things that must *not* have
 * changed with them: tool calling stays Unknown because this page never states
 * it, and a batch that loses its token limits wholesale is refused rather than
 * accepted as healthy.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { adaptAnthropicCatalogRecord } from "../../lib/brightdata";
import {
  MODALITY_ENUMERATION_STATEMENT_KEY,
  RawAnthropicCatalogRecordSchema,
  readModalityEnumerationStatement,
} from "../../lib/contracts";
import {
  createAnthropicCatalogSourceHealthContract,
  evaluateSourceHealth,
} from "../../lib/sentinel";

const SOURCE_URL = "https://platform.claude.com/docs/en/about-claude/models/overview";

const STATEMENT =
  "All current Claude models support text and image input, text output, " +
  "multilingual capabilities, and vision.";

/** Verbatim rows from collector c_msz68u3ovithdetgu after the template fix. */
const LIVE_RECORDS = [
  {
    api_model_id: "claude-opus-5",
    display_name: "Claude Opus 5",
    model_family: "Claude Opus",
    context_window_raw: "1M tokens ",
    max_output_tokens_raw: "128k tokens",
    supports_vision: true,
    input_modalities: ["text", "image"],
    output_modalities: ["text"],
    capability_statement: STATEMENT,
    input: { url: SOURCE_URL },
  },
  {
    api_model_id: "claude-haiku-4-5-20251001",
    display_name: "Claude Haiku 4.5",
    model_family: "Claude Haiku",
    context_window_raw: "200k tokens ",
    max_output_tokens_raw: "64k tokens",
    supports_vision: true,
    input_modalities: ["text", "image"],
    output_modalities: ["text"],
    capability_statement: STATEMENT,
    input: { url: SOURCE_URL },
  },
] as const;

test("Anthropic catalog: the live collector payload satisfies the raw contract", () => {
  for (const record of LIVE_RECORDS) {
    const parsed = RawAnthropicCatalogRecordSchema.safeParse(record);
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  }
});

test("Anthropic catalog: shorthand token limits normalize to the published figures", () => {
  const opus = adaptAnthropicCatalogRecord(LIVE_RECORDS[0], SOURCE_URL);
  assert.equal(opus.contextWindow, 1_000_000);
  assert.equal(opus.maxOutputTokens, 128_000);

  const haiku = adaptAnthropicCatalogRecord(LIVE_RECORDS[1], SOURCE_URL);
  assert.equal(haiku.contextWindow, 200_000);
  assert.equal(haiku.maxOutputTokens, 64_000);
});

test("Anthropic catalog: modalities and vision come from the page's own statement", () => {
  const opus = adaptAnthropicCatalogRecord(LIVE_RECORDS[0], SOURCE_URL);
  assert.deepEqual(opus.inputModalities, ["text", "image"]);
  assert.deepEqual(opus.outputModalities, ["text"]);
  assert.equal(opus.supportsVision, true);
  // The sentence survives into raw evidence, which is what lets a reader — and
  // Ask — see why an absent modality is an absence rather than a silence.
  assert.equal(readModalityEnumerationStatement(opus.rawEvidence), STATEMENT);
  assert.equal(
    (opus.rawEvidence as Record<string, unknown>)[MODALITY_ENUMERATION_STATEMENT_KEY],
    STATEMENT,
  );
});

/**
 * The overview page documents context, output and modalities. It says nothing
 * about tool use, and nothing in the fix is allowed to infer it from the fact
 * that Claude models do support tools.
 */
test("Anthropic catalog: tool calling stays Unknown because this page never states it", () => {
  for (const record of LIVE_RECORDS) {
    assert.equal(adaptAnthropicCatalogRecord(record, SOURCE_URL).supportsToolCalling, null);
  }
});

test("Anthropic catalog: the live payload passes the Sentinel gate", () => {
  const evaluation = evaluateSourceHealth(
    [...LIVE_RECORDS],
    createAnthropicCatalogSourceHealthContract("catalog-anthropic"),
    null,
    { observedAt: new Date().toISOString() },
  );
  assert.equal(evaluation.status, "healthy");
  assert.deepEqual(evaluation.reasonCodes, []);
});

/**
 * The silent failure this invariant exists to stop: a template that still
 * returns every model, still validates, and simply stops carrying the two rows
 * the comparison table is built around.
 */
test("Anthropic catalog: a batch that loses every token limit is refused, not marked healthy", () => {
  const stripped = LIVE_RECORDS.map((record) => ({
    ...record,
    context_window_raw: null,
    max_output_tokens_raw: null,
  }));

  const evaluation = evaluateSourceHealth(
    stripped,
    createAnthropicCatalogSourceHealthContract("catalog-anthropic"),
    null,
    { observedAt: new Date().toISOString() },
  );

  assert.equal(evaluation.status, "quarantined");
  assert.ok(evaluation.reasonCodes.includes("CAPABILITY_TOKEN_LIMITS_MISSING"));
  assert.equal(evaluation.shouldQuarantine, true);
});

/**
 * Unknown semantics are untouched globally: one model missing a figure is
 * still just unobserved, and the batch is still healthy.
 */
test("Anthropic catalog: a single missing token limit is still Unknown, not a violation", () => {
  const partial = [
    { ...LIVE_RECORDS[0] },
    { ...LIVE_RECORDS[1], context_window_raw: null, max_output_tokens_raw: null },
  ];

  const evaluation = evaluateSourceHealth(
    partial,
    createAnthropicCatalogSourceHealthContract("catalog-anthropic"),
    null,
    { observedAt: new Date().toISOString() },
  );

  assert.equal(evaluation.status, "healthy");
  assert.equal(evaluation.reasonCodes.includes("CAPABILITY_TOKEN_LIMITS_MISSING"), false);
  assert.equal(adaptAnthropicCatalogRecord(partial[1], SOURCE_URL).contextWindow, null);
});
