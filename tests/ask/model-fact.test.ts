/**
 * MODEL_FACT: grounded questions about one field of one resolved model.
 *
 * The five questions the live UI offers are exercised end to end, plus the two
 * boundaries the intent exists to hold: a model AI Radar has never observed
 * gets no answer at all, and a modality missing from an *enumerated* list is
 * reported as unsupported while a modality missing from an unenumerated one
 * stays unknown.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { answerQuestion, planQuery, type GroundedAskResult } from "../../lib/ask";
import { MODALITY_ENUMERATION_STATEMENT_KEY } from "../../lib/contracts";
import { InMemoryModelExplorerReadPort, type InMemoryExplorerData } from "../../lib/explorer";
import {
  ANTHROPIC,
  ANTHROPIC_CATALOG_SOURCE,
  ANTHROPIC_LIFECYCLE_SOURCE,
  ANTHROPIC_PRICING_SOURCE,
  capability,
  explorerData,
  lifecycle,
  minutesAgo,
  model,
  now,
  pricing,
} from "../explorer/support/fixtures";

/** The sentence the Anthropic models overview actually publishes. */
const ANTHROPIC_MODALITY_STATEMENT =
  "All current Claude models support text and image input, text output, " +
  "multilingual capabilities, and vision.";

const CLAUDE_OPUS_5 = model({
  id: "model-claude-opus-5",
  provider_id: ANTHROPIC.id,
  model_name: "claude-opus-5",
  display_name: "Claude Opus 5",
  lifecycle_state: "active",
  lifecycle_source_id: ANTHROPIC_LIFECYCLE_SOURCE.id,
  lifecycle_observed_at: minutesAgo(120),
});

/**
 * Opus 5 as the fixed collector now publishes it: shorthand token limits
 * normalized, modalities carried by the page's enumerating sentence, and tool
 * use left unobserved because this page never states it.
 */
function withOpus5(): Required<InMemoryExplorerData> {
  const data = explorerData();
  return {
    ...data,
    models: [...data.models, CLAUDE_OPUS_5],
    pricingSnapshots: [
      ...data.pricingSnapshots,
      pricing({
        id: "price-opus5",
        model_id: CLAUDE_OPUS_5.id,
        provider_id: ANTHROPIC.id,
        source_id: ANTHROPIC_PRICING_SOURCE.id,
        input_price_per_1m_tokens: 5,
        output_price_per_1m_tokens: 25,
        observed_at: minutesAgo(60),
      }),
    ],
    capabilitySnapshots: [
      ...data.capabilitySnapshots,
      capability({
        id: "cap-opus5",
        model_id: CLAUDE_OPUS_5.id,
        provider_id: ANTHROPIC.id,
        source_id: ANTHROPIC_CATALOG_SOURCE.id,
        api_model_id: "claude-opus-5",
        display_name: "Claude Opus 5",
        model_family: "Claude Opus",
        model_stage: "ga",
        context_window: 1_000_000,
        max_output_tokens: 128_000,
        supports_vision: true,
        supports_tool_calling: null,
        input_modalities: ["text", "image"],
        output_modalities: ["text"],
        source_url: "https://platform.claude.com/docs/en/about-claude/models/overview",
        raw: { [MODALITY_ENUMERATION_STATEMENT_KEY]: ANTHROPIC_MODALITY_STATEMENT },
        observed_at: minutesAgo(45),
      }),
    ],
    lifecycleSnapshots: [
      ...data.lifecycleSnapshots,
      lifecycle({
        id: "life-opus5",
        model_id: CLAUDE_OPUS_5.id,
        provider_id: ANTHROPIC.id,
        source_id: ANTHROPIC_LIFECYCLE_SOURCE.id,
        api_model_id: "claude-opus-5",
        lifecycle_state: "active",
        observed_at: minutesAgo(120),
      }),
    ],
  };
}

function ask(question: string, data = withOpus5()): Promise<GroundedAskResult> {
  return answerQuestion(question, {
    port: new InMemoryModelExplorerReadPort(data),
    now,
  });
}

function factValue(result: GroundedAskResult) {
  assert.equal(result.structured.kind, "model_fact_query");
  if (result.structured.kind !== "model_fact_query") throw new Error("unreachable");
  return result.structured.lookup.value;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test("MODEL_FACT: a single model plus a single field compiles to a typed fact intent", () => {
  const plan = planQuery("What is Claude Opus 5's context window?");
  assert.equal(plan.intent.kind, "model_fact_query");
  if (plan.intent.kind !== "model_fact_query") return;
  assert.equal(plan.intent.modelQuery, "Claude Opus 5");
  assert.equal(plan.intent.field, "context_window");
  assert.equal(plan.intent.modality, null);
});

test("MODEL_FACT: 'video input' is read as a modality question, not as a price or a vision one", () => {
  const plan = planQuery("Does Claude Opus 5 support video input?");
  assert.equal(plan.intent.kind, "model_fact_query");
  if (plan.intent.kind !== "model_fact_query") return;
  assert.equal(plan.intent.field, "input_modality");
  assert.equal(plan.intent.modality, "video");
  assert.equal(plan.intent.modelQuery, "Claude Opus 5");
});

/**
 * The routing this intent was added to fix. These readings are more specific
 * than a single-model lookup and must keep winning.
 */
test("MODEL_FACT: temporal, comparison and superlative readings still outrank it", () => {
  assert.equal(planQuery("What changed in Claude this month?").intent.kind, "temporal_change_query");
  assert.equal(
    planQuery("Compare Claude Sonnet 5 and Gemini 2.5 Pro.").intent.kind,
    "model_filter_query",
  );
  assert.equal(
    planQuery("What is the cheapest Claude model with vision?").intent.kind,
    "model_filter_query",
  );
  assert.equal(
    planQuery("Which models were deprecated last month?").intent.kind,
    "temporal_change_query",
  );
  assert.equal(
    planQuery(
      "Which model is cheapest for 10M input tokens and 2M output tokens per month?",
    ).intent.kind,
    "workload_optimizer_query",
  );
});

// ---------------------------------------------------------------------------
// The five live questions
// ---------------------------------------------------------------------------

test("MODEL_FACT: context window is answered from the stored observation", async () => {
  const result = await ask("What is Claude Opus 5's context window?");
  assert.equal(result.interpretedIntent, "model_fact_query");
  assert.deepEqual(factValue(result), {
    status: "observed",
    display: "1,000,000 tokens",
    value: 1_000_000,
  });
  assert.match(result.answerSummary, /1,000,000 tokens/);
  assert.ok(result.provenance.length > 0);
  assert.equal(result.groundedness.isGrounded, true);
});

test("MODEL_FACT: max output is answered for the model actually named", async () => {
  const result = await ask("What is Claude Sonnet 5's max output?");
  assert.equal(result.interpretedIntent, "model_fact_query");
  assert.deepEqual(factValue(result), {
    status: "observed",
    display: "64,000 tokens",
    value: 64_000,
  });
  assert.match(result.answerSummary, /Claude Sonnet 5/);
});

test("MODEL_FACT: an enumerated modality list makes an absent modality Unsupported, with the sentence", async () => {
  const result = await ask("Does Claude Opus 5 support video input?");
  const value = factValue(result);
  assert.equal(value.status, "unsupported");
  if (value.status !== "unsupported") return;
  assert.equal(value.statement, ANTHROPIC_MODALITY_STATEMENT);
  assert.match(result.answerSummary, /video input is not supported/);
  // The claim is attributed, never asserted bare.
  assert.match(result.answerSummary, /All current Claude models support/);
});

test("MODEL_FACT: an observed capability answers plainly", async () => {
  const result = await ask("Does Claude Opus 5 support vision?");
  assert.deepEqual(factValue(result), {
    status: "observed",
    display: "supported",
    value: true,
  });
});

test("MODEL_FACT: price is answered from the published tier, both sides", async () => {
  const result = await ask("What does Claude Opus 5 cost?");
  const value = factValue(result);
  assert.equal(value.status, "observed");
  if (value.status !== "observed") return;
  assert.match(value.display, /\$5\.00 per 1M tokens input/);
  assert.match(value.display, /\$25\.00 per 1M tokens output/);
  assert.equal(result.groundedness.isGrounded, true);
});

// ---------------------------------------------------------------------------
// Fail-closed and Unknown boundaries
// ---------------------------------------------------------------------------

test("MODEL_FACT: a model AI Radar has never observed gets no answer at all", async () => {
  const result = await ask("What does GPT-6 cost?");
  assert.equal(result.interpretedIntent, "unsupported");
  assert.equal(result.structured.kind, "unsupported");
  if (result.structured.kind !== "unsupported") return;
  assert.equal(result.structured.reason, "unresolved_model");
  assert.match(result.answerSummary, /GPT-6/);
  assert.match(result.answerSummary, /model memory/);
  // Nothing was read, so nothing may be cited.
  assert.deepEqual(result.provenance, []);
});

/**
 * The Anthropic models overview does not state tool support. Absence of a
 * statement is not a statement of absence, and no amount of neighbouring
 * evidence is allowed to turn it into one.
 */
test("MODEL_FACT: an unobserved capability stays Unknown rather than becoming No", async () => {
  const result = await ask("Does Claude Opus 5 support tool calling?");
  const value = factValue(result);
  assert.equal(value.status, "unknown");
  if (value.status !== "unknown") return;
  assert.match(value.reason, /has not been observed/);
  assert.match(result.answerSummary, /unknown/i);
  assert.ok(result.missingEvidence.length > 0);
});

/**
 * Sonnet 5 in the shared fixture publishes `["text"]` with no enumerating
 * sentence. The same question that resolves to Unsupported for Opus 5 must
 * resolve to Unknown here — the difference is the evidence, not the model.
 */
test("MODEL_FACT: without an enumerating sentence an absent modality stays Unknown", async () => {
  const result = await ask("Does Claude Sonnet 5 support image input?");
  const value = factValue(result);
  assert.equal(value.status, "unknown");
  if (value.status !== "unknown") return;
  assert.match(value.reason, /not published as an exhaustive list/);
});

test("MODEL_FACT: lifecycle is answered from the authoritative lifecycle evidence", async () => {
  const result = await ask("Is Claude Opus 5 deprecated?");
  assert.deepEqual(factValue(result), {
    status: "observed",
    display: "active",
    value: "active",
  });
});
