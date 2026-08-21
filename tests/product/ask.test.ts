import test from "node:test";
import assert from "node:assert/strict";

import {
  ASK_EXAMPLE_QUERIES,
  ASK_GROUNDING_PRESETS,
  ASK_GROUNDING_STATEMENT,
  askHref,
  askIntentLabel,
  askQueryFromParams,
  changesHref,
  emptyAskReadModel,
  getAskAdapter,
  setAskAdapter,
  sourceHref,
  splitAskExclusionNotes,
  type AskAdapter,
} from "../../lib/product/ask";
import {
  createFixtureAskAdapter,
  FIXTURE_ASK_ADAPTER_ID,
  selectAskFixtureScenario,
} from "../../lib/product/ask-fixture";

test("Ask query round-trips through the shareable q param", () => {
  const question = "What changed in Claude this month?";
  assert.equal(askHref(question), `/ask?q=${encodeURIComponent(question)}`);
  assert.equal(askQueryFromParams(new URLSearchParams(`q=${encodeURIComponent(question)}`)), question);
  assert.equal(askHref(""), "/ask");
  assert.equal(askQueryFromParams({}), "");
});

test("example queries cover temporal, decision and model-fact intents", () => {
  const intents = new Set(ASK_EXAMPLE_QUERIES.map((example) => example.intent));
  assert.ok(intents.has("temporal"));
  assert.ok(intents.has("decision"));
  assert.ok(intents.has("fact"));
  assert.equal(askIntentLabel("temporal"), "Temporal");
  assert.equal(askIntentLabel("decision"), "Decision");
  assert.equal(askIntentLabel("fact"), "Model fact");
});

test("grounding presets are query buttons only and include fail-closed examples", () => {
  const queries = ASK_GROUNDING_PRESETS.map((preset) => preset.query);
  assert.ok(queries.includes("What does GPT-6 cost?"));
  assert.ok(queries.includes("Does Claude Opus 5 support video input?"));
  assert.equal(ASK_GROUNDING_PRESETS.length, 4);
});

test("exclusion notes split on recorded sentences without dropping text", () => {
  const notes = splitAskExclusionNotes(
    "o3 vision has not been observed. Grok pricing has never been collected.",
  );
  assert.deepEqual(notes, [
    "o3 vision has not been observed.",
    "Grok pricing has never been collected.",
  ]);
});

test("fixture Ask adapter returns a temporal result with interpreted constraints", async () => {
  const adapter = createFixtureAskAdapter();
  const result = await adapter.ask("What changed in Claude this month?");

  assert.equal(adapter.id, FIXTURE_ASK_ADAPTER_ID);
  assert.equal(result.intent, "temporal");
  assert.equal(result.question, "What changed in Claude this month?");
  assert.equal(result.groundingStatement, ASK_GROUNDING_STATEMENT);
  assert.ok(result.interpretedConstraints.some((item) => item.id === "provider"));
  assert.ok(result.evidence.some((item) => item.kind === "change"));
  assert.ok(result.observedAt);
  assert.ok(result.provenance);
});

test("fixture Ask adapter returns a model-selection decision result with calculations", async () => {
  const adapter = createFixtureAskAdapter();
  const result = await adapter.ask(
    "What is the cheapest active model with 500K context, vision and tools?",
  );

  assert.equal(result.intent, "decision");
  assert.ok(result.interpretedConstraints.some((item) => item.id === "min_context"));
  assert.ok(result.interpretedConstraints.some((item) => item.id === "vision"));
  assert.ok(result.calculations.length > 0);
  assert.ok(result.evidence.some((item) => item.kind === "model"));
  assert.match(result.missingData ?? "", /not been observed/i);
});

test("unsupported queries explain the gap instead of inventing an answer", async () => {
  const adapter = createFixtureAskAdapter();
  const result = await adapter.ask("What will GPT-6 cost next year?");

  assert.equal(selectAskFixtureScenario("What will GPT-6 cost next year?"), "unsupported");
  assert.equal(result.intent, "unsupported");
  assert.ok(result.unsupportedReason);
  assert.match(result.unsupportedReason ?? "", /outside the grounded/i);
  assert.equal(result.evidence.length, 0);
  assert.equal(result.calculations.length, 0);
});

test("empty queries stay empty and do not fabricate chat history", async () => {
  const adapter = createFixtureAskAdapter();
  const result = await adapter.ask("   ");
  assert.equal(result.intent, "empty");
  assert.equal(result.question, "");
  assert.equal(emptyAskReadModel().intent, "empty");
});

test("Ask helper hrefs point at existing product surfaces", () => {
  assert.equal(changesHref("anthropic", "30d"), "/changes?provider=anthropic&range=30d");
  assert.equal(sourceHref("gemini-catalog"), "/sources/gemini-catalog");
});

test("setAskAdapter replaces the installed seam without changing call shape", async () => {
  let previous: AskAdapter | null = null;
  try {
    previous = getAskAdapter();
  } catch {
    previous = null;
  }
  const stub: AskAdapter = {
    id: "test-ask",
    label: "Test",
    async ask(query) {
      return {
        ...emptyAskReadModel(),
        question: query,
        intent: "unsupported",
        intentLabel: "Unsupported",
        unsupportedReason: "Stub does not answer.",
      };
    },
  };

  setAskAdapter(stub);
  try {
    const result = await getAskAdapter().ask("anything");
    assert.equal(getAskAdapter().id, "test-ask");
    assert.equal(result.unsupportedReason, "Stub does not answer.");
  } finally {
    if (previous) setAskAdapter(previous);
  }
});
