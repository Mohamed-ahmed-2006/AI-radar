import test from "node:test";
import assert from "node:assert/strict";

import { InMemoryModelExplorerReadPort, getModelDetail } from "../../lib/explorer";
import {
  ANTHROPIC_LIFECYCLE_SOURCE,
  CLAUDE_3_OPUS,
  CLAUDE_SONNET_5,
  GEMINI_IMAGEN,
  GPT_5,
  GROK_4,
  OPENAI_PRICING_SOURCE,
  explorerData,
  minutesAgo,
  now,
} from "./support/fixtures";

const port = () => new InMemoryModelExplorerReadPort(explorerData());

test("Detail: unknown canonical ids resolve to nothing", async () => {
  assert.equal(await getModelDetail("model-does-not-exist", { port: port(), now }), null);
});

test("Detail: current evidence is the same projection the explorer renders", async () => {
  const detail = await getModelDetail(GPT_5.id, { port: port(), now });
  assert.ok(detail);

  assert.equal(detail.current.canonicalModelId, GPT_5.id);
  assert.equal(detail.current.provider.slug, "openai");
  assert.equal(detail.current.pricing.primary?.inputPricePer1MTokens, 1.25);
  assert.equal(detail.current.capabilities.contextWindow, 400_000);
  assert.equal(detail.current.lifecycle.state, null);
  assert.equal(detail.generatedAt, "2026-08-19T12:00:00.000Z");
});

test("Detail: pricing history keeps every observation, newest first", async () => {
  const detail = await getModelDetail(GPT_5.id, { port: port(), now });
  assert.ok(detail);

  assert.deepEqual(
    detail.pricingHistory.map((row) => row.snapshotId),
    ["price-gpt5", "price-gpt5-long", "price-gpt5-old"],
  );

  const superseded = detail.pricingHistory.find((row) => row.snapshotId === "price-gpt5-old");
  assert.ok(superseded, "a superseded price stays in history");
  assert.equal(superseded.inputPricePer1MTokens, 1.5);
  assert.equal(superseded.observedAt, minutesAgo(2000));
  assert.equal(superseded.currency, "USD");
  assert.equal(superseded.provenance.sourceUrl, OPENAI_PRICING_SOURCE.source_url);
  assert.equal(superseded.provenance.snapshotId, "price-gpt5-old");
  assert.equal(superseded.provenance.externalRunId, "bd_openai_pricing_run");
});

test("Detail: capability history preserves each API id's own evidence", async () => {
  const detail = await getModelDetail(GEMINI_IMAGEN.id, { port: port(), now });
  assert.ok(detail);

  // Current evidence is withheld because the two ids disagree...
  assert.equal(detail.current.capabilities.conflicted, true);
  assert.equal(detail.current.capabilities.contextWindow, null);

  // ...but the history still shows exactly what each page published.
  assert.deepEqual(
    detail.capabilityHistory.map((row) => [row.apiModelId, row.contextWindow]),
    [
      ["imagen-4.0-fast-generate-001", 240],
      ["imagen-4.0-generate-001", 480],
    ],
  );
  assert.equal(
    detail.capabilityHistory[0].provenance.sourceUrl,
    "https://ai.google.dev/gemini-api/docs/models/imagen-fast",
  );
});

test("Detail: lifecycle history carries dates, replacement and observation kind", async () => {
  const detail = await getModelDetail(CLAUDE_3_OPUS.id, { port: port(), now });
  assert.ok(detail);

  assert.equal(detail.lifecycleHistory.length, 1);
  const [entry] = detail.lifecycleHistory;
  assert.equal(entry.state, "deprecated");
  assert.equal(entry.deprecationDate, "2026-01-21");
  assert.equal(entry.retirementDate, "2026-03-01");
  assert.equal(entry.retirementNotBeforeDate, null);
  assert.equal(entry.retirementNotBeforeObservation, "unobserved");
  assert.equal(entry.recommendedReplacement, "claude-sonnet-5");
  assert.equal(entry.recommendedReplacementModelId, CLAUDE_SONNET_5.id);
  assert.equal(entry.provenance.sourceKind, "lifecycle");
  assert.equal(entry.provenance.authority, "authoritative");
  assert.equal(entry.provenance.sourceUrl, ANTHROPIC_LIFECYCLE_SOURCE.source_url);
});

test("Detail: recent changes name their domain and both sides of the transition", async () => {
  const detail = await getModelDetail(GPT_5.id, { port: port(), now });
  assert.ok(detail);

  assert.equal(detail.recentChanges.length, 1);
  const [change] = detail.recentChanges;
  assert.equal(change.eventId, "change-gpt5-price");
  assert.equal(change.changeType, "price_decreased");
  assert.equal(change.domain, "pricing");
  assert.equal(change.fieldName, "input_price_per_1m_tokens");
  assert.equal(change.pricingMode, "standard");
  assert.equal(change.oldValue, 1.5);
  assert.equal(change.newValue, 1.25);
  assert.equal(change.provenance.snapshotId, "price-gpt5");
  assert.equal(change.provenance.previousSnapshotId, "price-gpt5-old");
  assert.equal(change.provenance.collectorId, "c_openai_pricing");

  const opus = await getModelDetail(CLAUDE_3_OPUS.id, { port: port(), now });
  assert.equal(opus?.recentChanges[0].domain, "lifecycle");
  assert.equal(opus?.recentChanges[0].provenance.snapshotId, "life-opus3");
});

test("Detail: known API model ids come from aliases, not from a name guess", async () => {
  const detail = await getModelDetail(GPT_5.id, { port: port(), now });
  assert.ok(detail);

  // Only api_model_id aliases; the pricing page's source-name alias is not an id.
  assert.deepEqual(detail.apiModelIds, ["gpt-5", "gpt-5-2026-01-15"]);
});

test("Detail: a domain with no evidence yields an empty history, not a placeholder", async () => {
  const detail = await getModelDetail(GROK_4.id, { port: port(), now });
  assert.ok(detail);

  assert.deepEqual(detail.pricingHistory, []);
  assert.deepEqual(detail.lifecycleHistory, []);
  assert.equal(detail.capabilityHistory.length, 1);
  assert.deepEqual(detail.recentChanges, []);
  assert.deepEqual(detail.apiModelIds, []);
  assert.equal(detail.current.pricing.primary, null);
});

test("Detail: history limits bound each section independently", async () => {
  const detail = await getModelDetail(GPT_5.id, {
    port: port(),
    now,
    pricingHistoryLimit: 1,
    changeLimit: 1,
  });
  assert.ok(detail);

  assert.equal(detail.pricingHistory.length, 1);
  assert.equal(detail.pricingHistory[0].snapshotId, "price-gpt5");
  assert.equal(detail.capabilityHistory.length, 1);
});
