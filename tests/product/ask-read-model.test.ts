import test from "node:test";
import assert from "node:assert/strict";

import { InMemoryModelExplorerReadPort } from "../../lib/explorer";
import { getDemoTemporalEvidence } from "../../lib/intelligence/demo-evidence";
import {
  ASK_GROUNDING_STATEMENT,
  CANONICAL_ASK_ADAPTER_ID,
  createCanonicalAskAdapter,
  FIXTURE_ASK_ADAPTER_ID,
  getAskAdapter,
} from "../../lib/product";
import { explorerData, now } from "../explorer/support/fixtures";

function adapter() {
  return createCanonicalAskAdapter({
    port: new InMemoryModelExplorerReadPort(explorerData()),
    now,
    configured: true,
    referenceDate: "2026-08-19T12:00:00.000Z",
    loadTemporalEvidence: async () => getDemoTemporalEvidence(),
  });
}

test("canonical Ask adapter is the installed default, not the fixture", () => {
  assert.equal(getAskAdapter().id, CANONICAL_ASK_ADAPTER_ID);
  assert.notEqual(getAskAdapter().id, FIXTURE_ASK_ADAPTER_ID);
});

test("canonical Ask adapter answers temporal questions from the temporal engine", async () => {
  const result = await adapter().ask("What changed in Claude this month?");
  assert.equal(result.intent, "temporal");
  assert.ok(result.interpretedConstraints.some((row) => row.id === "provider"));
  assert.ok(result.interpretedConstraints.some((row) => row.id === "groundedness"));
  assert.ok(result.evidence.some((item) => item.kind === "change"));
  assert.ok(result.provenance);
  assert.match(result.groundingStatement, /Groundedness check passed/);
  assert.match(result.groundingStatement, new RegExp(ASK_GROUNDING_STATEMENT));
  assert.ok(result.freshness.observedAt || result.observedAt);
});

test("canonical Ask adapter answers model-selection questions from the optimizer", async () => {
  const result = await adapter().ask(
    "What is cheapest for 100M input and 20M output tokens?",
  );
  assert.equal(result.intent, "decision");
  assert.ok(result.calculations.length > 0);
  assert.ok(result.evidence.some((item) => item.kind === "model"));
  assert.ok(result.evidence.some((item) => item.kind === "note" && item.href === "/optimizer"));
  assert.ok(result.interpretedConstraints.some((row) => row.id === "monthlyInputTokens"));
  assert.equal(result.unsupportedReason, null);
});

test("canonical Ask adapter does not answer unsupported questions from model memory", async () => {
  const result = await adapter().ask("Who is the CEO of OpenAI?");
  assert.equal(result.intent, "unsupported");
  assert.equal(result.evidence.filter((item) => item.kind === "model").length, 0);
  assert.doesNotMatch(result.answer.toLowerCase(), /sam altman/);
  assert.ok(result.unsupportedReason);
});

test("unconfigured Ask adapter refuses to fall back to fixtures or model memory", async () => {
  const result = await createCanonicalAskAdapter({ configured: false, now }).ask(
    "What changed in Claude this month?",
  );
  assert.equal(result.intent, "unsupported");
  assert.equal(result.isDemo, false);
  assert.match(result.unsupportedReason ?? "", /not configured/i);
  assert.doesNotMatch(result.answer.toLowerCase(), /sonnet 4\.5/);
});
