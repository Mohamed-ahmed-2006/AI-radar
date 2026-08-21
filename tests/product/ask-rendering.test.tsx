import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { AskExamples, AskForm, AskGroundingPresets } from "../../components/product/ask/AskForm";
import { AskGroundingBanner } from "../../components/product/ask/AskGroundingBanner";
import { AskResult } from "../../components/product/ask/AskResult";
import { ErrorState, LoadingState } from "../../components/radar/ui/DataState";
import { ASK_GROUNDING_STATEMENT, emptyAskReadModel } from "../../lib/product/ask";
import { createFixtureAskAdapter } from "../../lib/product/ask-fixture";

test("Ask form is a labelled single-query control with no chat transcript", () => {
  const html = renderToStaticMarkup(
    <AskForm query="" onChange={() => undefined} onSubmit={() => undefined} />,
  );

  assert.match(html, /aria-label="Ask AI Radar"/);
  assert.match(html, /for="ask-query"/);
  assert.match(html, /<textarea/);
  assert.match(html, />Ask AI Radar</);
  assert.doesNotMatch(html, /previous message/i);
  assert.doesNotMatch(html, /chat history/i);
});

test("Ask examples visibly separate temporal and decision questions", () => {
  const html = renderToStaticMarkup(<AskExamples onSelect={() => undefined} />);

  assert.match(html, /aria-label="Temporal example questions"/);
  assert.match(html, /aria-label="Decision example questions"/);
  assert.match(html, /What changed in Claude this month\?/);
  assert.match(html, /Cheapest active model with 500K context, vision and tools/);
});

test("Ask grounding presets are discoverable fail-closed questions", () => {
  const html = renderToStaticMarkup(<AskGroundingPresets onSelect={() => undefined} />);

  assert.match(html, /Try grounding/i);
  assert.match(html, /What does GPT-6 cost\?/);
  assert.match(html, /Does Claude Opus 5 support video input\?/);
  assert.match(html, /at least 128K context and tool calling/);
  assert.match(html, /What changed in Claude this month\?/);
});

test("temporal Ask result shows the question, interpreted constraints, evidence and timestamps", async () => {
  const result = await createFixtureAskAdapter().ask("What changed in Claude this month?");
  const html = renderToStaticMarkup(<AskResult result={result} />);

  assert.match(html, /What changed in Claude this month\?/);
  assert.match(html, /Interpreted as Temporal/);
  assert.match(html, /Interpreted constraints/);
  assert.match(html, /Anthropic \/ Claude/);
  assert.match(html, /<time datetime="2026-08-19T09:00:00\.000Z"/i);
  assert.match(html, /aria-label="Grounded evidence"/);
  assert.match(html, /Claude Sonnet 4\.5/);
});

test("Ask exclusions stay available behind disclosure and do not precede the answer", async () => {
  const result = await createFixtureAskAdapter().ask(
    "What is the cheapest active model with 500K context, vision and tools?",
  );
  const html = renderToStaticMarkup(<AskResult result={result} />);
  const answerAt = html.indexOf("Gemini 2.5 Pro is the cheapest fit");
  const exclusionAt = html.indexOf("Inspect exclusions");

  assert.ok(answerAt >= 0);
  assert.ok(exclusionAt > answerAt);
  assert.match(html, /excluded because required evidence was unknown or unavailable|Inspect exclusions/);
  assert.match(html, /o3 vision has not been observed/);
});

test("decision Ask result shows model-selection evidence, calculations and provenance", async () => {
  const result = await createFixtureAskAdapter().ask(
    "What is the cheapest active model with 500K context, vision and tools?",
  );
  const html = renderToStaticMarkup(<AskResult result={result} />);

  assert.match(html, /Interpreted as Decision/);
  assert.match(html, /Minimum context/);
  assert.match(html, /500K/);
  assert.match(html, /Gemini 2\.5 Pro/);
  assert.match(html, /aria-label="Adapter calculations"/);
  assert.match(html, /The UI does not calculate/);
  assert.match(html, /Where did this come from\?/);
  assert.match(html, /<details/);
});

test("grounding statement is always present on an answered query", async () => {
  const result = await createFixtureAskAdapter().ask("Which Gemini models changed recently?");
  const html = renderToStaticMarkup(<AskResult result={result} />);
  const banner = renderToStaticMarkup(<AskGroundingBanner />);

  assert.match(html, /AI Radar answered this from live trusted evidence, not model memory/);
  assert.match(banner, new RegExp(ASK_GROUNDING_STATEMENT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(banner, /role="status"/);
});

test("unsupported Ask result explains the gap and stays empty of invented evidence", async () => {
  const result = await createFixtureAskAdapter().ask("Write a poem about GPUs");
  const html = renderToStaticMarkup(<AskResult result={result} />);

  assert.match(html, /Interpreted as Unsupported/);
  assert.match(html, /outside the grounded temporal and decision questions/);
  assert.doesNotMatch(html, /aria-label="Grounded evidence"/);
  assert.doesNotMatch(html, /aria-label="Adapter calculations"/);
});

test("empty Ask result is a status, not a fake conversation", () => {
  const html = renderToStaticMarkup(<AskResult result={emptyAskReadModel()} />);

  assert.match(html, /role="status"/);
  assert.match(html, /Ask a grounded question/);
  assert.doesNotMatch(html, /You said/);
  assert.doesNotMatch(html, /Assistant/);
});

test("Ask evidence links to model detail, sources and changes", async () => {
  const result = await createFixtureAskAdapter().ask("What changed in Claude this month?");
  const html = renderToStaticMarkup(<AskResult result={result} />);

  assert.match(html, /href="\/models\/anthropic%3Aclaude-sonnet-4-5"/);
  assert.match(html, /href="\/changes"/);
  assert.match(html, /Model detail/);
  assert.match(html, />Source</);
});

test("Ask loading and error states are announced", () => {
  const loading = renderToStaticMarkup(
    <LoadingState title="Reading trusted evidence…" />,
  );
  const error = renderToStaticMarkup(
    <ErrorState
      title="Ask AI Radar could not be read"
      description="Adapter unavailable."
    />,
  );

  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /Reading trusted evidence/);
  assert.match(error, /role="alert"/);
  assert.match(error, /Ask AI Radar could not be read/);
});
