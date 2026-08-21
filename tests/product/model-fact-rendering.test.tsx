import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { AskResult } from "../../components/product/ask/AskResult";
import { InMemoryModelExplorerReadPort, type InMemoryExplorerData } from "../../lib/explorer";
import { MODALITY_ENUMERATION_STATEMENT_KEY } from "../../lib/contracts";
import { createCanonicalAskAdapter } from "../../lib/product/ask-read-model";
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

function adapter() {
  return createCanonicalAskAdapter({
    port: new InMemoryModelExplorerReadPort(withOpus5()),
    now,
    configured: true,
  });
}

test("MODEL_FACT video input answers about Claude Opus 5 as not supported, not a ranking", async () => {
  const result = await adapter().ask("Does Claude Opus 5 support video input?");
  const html = renderToStaticMarkup(<AskResult result={result} />);

  assert.equal(result.intent, "fact");
  assert.equal(result.modelFact?.status, "unsupported");
  assert.match(html, /Model fact/);
  assert.match(html, /Claude Opus 5/);
  assert.match(html, /Video input/i);
  assert.match(html, /Not supported/);
  assert.match(html, /radar-ask-fact-value-unsupported/);
  assert.match(html, /Inspect evidence/);
  assert.doesNotMatch(html, /This question is unsupported/);
  assert.doesNotMatch(html, /cheapest/i);
  assert.doesNotMatch(html, /Open Stack Optimizer/);
});

test("MODEL_FACT context window leads with the observed token count", async () => {
  const result = await adapter().ask("What is Claude Opus 5's context window?");
  const html = renderToStaticMarkup(<AskResult result={result} />);

  assert.equal(result.modelFact?.status, "observed");
  assert.match(html, /1,000,000 tokens/);
  assert.match(html, /Context window/i);
  assert.match(html, /Claude Opus 5/);
});

test("MODEL_FACT unknown and unsupported stay visually distinct", async () => {
  const unknown = await adapter().ask("Does Claude Opus 5 support tool calling?");
  const unsupported = await adapter().ask("Does Claude Opus 5 support video input?");
  const unknownHtml = renderToStaticMarkup(<AskResult result={unknown} />);
  const unsupportedHtml = renderToStaticMarkup(<AskResult result={unsupported} />);

  assert.equal(unknown.modelFact?.status, "unknown");
  assert.match(unknownHtml, /Unknown/);
  assert.match(unknownHtml, /not observed/i);
  assert.match(unknownHtml, /radar-ask-fact-value-unknown/);
  assert.doesNotMatch(unknownHtml, /radar-ask-fact-value-unsupported/);

  assert.equal(unsupported.modelFact?.status, "unsupported");
  assert.match(unsupportedHtml, /Not supported/);
  assert.match(unsupportedHtml, /radar-ask-fact-value-unsupported/);
  assert.doesNotMatch(unsupportedHtml, /radar-ask-fact-value-unknown/);
});
