import test from "node:test";
import assert from "node:assert/strict";

import {
  getDemoTemporalEvidence,
} from "../../lib/intelligence/demo-evidence";
import {
  executeTemporalQuery,
  parseNaturalQuestion,
} from "../../lib/intelligence/query-engine";

const REF_DATE = "2026-08-18T12:00:00.000Z";

test("Date-range filtering: filters events strictly within 7d, 30d, and custom bounds", () => {
  const dataset = getDemoTemporalEvidence();

  // 7 days from 2026-08-18 -> 2026-08-11 to 2026-08-18
  const res7d = executeTemporalQuery(dataset, {
    range: "7d",
    referenceDate: REF_DATE,
  });
  assert(res7d.totalEvents > 0);
  for (const event of res7d.events) {
    const time = new Date(event.observedAt).getTime();
    const minTime = new Date("2026-08-11T12:00:00.000Z").getTime();
    const maxTime = new Date(REF_DATE).getTime();
    assert(time >= minTime && time <= maxTime, `Event ${event.id} observedAt ${event.observedAt} outside 7d window`);
  }

  // 30 days from 2026-08-18 -> includes earlier August and late July events
  const res30d = executeTemporalQuery(dataset, {
    range: "30d",
    referenceDate: REF_DATE,
  });
  assert(res30d.totalEvents > res7d.totalEvents);

  // Custom ISO date window: 2026-08-01 to 2026-08-05
  const customRes = executeTemporalQuery(dataset, {
    since: "2026-08-01T00:00:00.000Z",
    until: "2026-08-05T23:59:59.000Z",
    referenceDate: REF_DATE,
  });
  assert(customRes.totalEvents > 0);
  for (const event of customRes.events) {
    assert(event.observedAt >= "2026-08-01T00:00:00.000Z");
    assert(event.observedAt <= "2026-08-05T23:59:59.000Z");
  }
});

test("Provider filtering: filters single and multi-provider queries", () => {
  const dataset = getDemoTemporalEvidence();

  // Single provider: Anthropic
  const anthropicRes = executeTemporalQuery(dataset, {
    provider: "anthropic",
    range: "all",
    referenceDate: REF_DATE,
  });
  assert(anthropicRes.totalEvents > 0);
  assert(anthropicRes.events.every((e) => e.provider === "anthropic"));

  // Single provider: Google
  const googleRes = executeTemporalQuery(dataset, {
    provider: "google",
    range: "all",
    referenceDate: REF_DATE,
  });
  assert(googleRes.totalEvents > 0);
  assert(googleRes.events.every((e) => e.provider === "google"));

  // Multi-provider: Anthropic + OpenAI
  const multiRes = executeTemporalQuery(dataset, {
    provider: ["anthropic", "openai"],
    range: "all",
    referenceDate: REF_DATE,
  });
  assert(multiRes.totalEvents > 0);
  assert(multiRes.events.every((e) => e.provider === "anthropic" || e.provider === "openai"));
});

test("Pricing changes: captures price reductions, increases, and caching deltas", () => {
  const dataset = getDemoTemporalEvidence();

  const pricingRes = executeTemporalQuery(dataset, {
    categories: ["pricing"],
    range: "all",
    referenceDate: REF_DATE,
  });

  assert(pricingRes.metrics.priceDecreases > 0);
  assert(pricingRes.events.every((e) => e.category === "pricing"));

  const claudeCacheEvent = pricingRes.events.find(
    (e) => e.model === "claude-3-5-sonnet-20241022" && e.field === "cachedInputPricePer1MTokens",
  );
  assert(claudeCacheEvent);
  assert.equal(claudeCacheEvent.priceDelta?.percentChange, -90.0);
  assert.equal(claudeCacheEvent.priceDelta?.previousPrice, 3.0);
  assert.equal(claudeCacheEvent.priceDelta?.currentPrice, 0.3);
});

test("Lifecycle transitions, deprecation schedules, and replacements", () => {
  const dataset = getDemoTemporalEvidence();

  // Lifecycle transitions
  const lifeRes = executeTemporalQuery(dataset, {
    categories: ["lifecycle"],
    range: "all",
    referenceDate: REF_DATE,
  });
  const claude21Retired = lifeRes.events.find((e) => e.model === "claude-2.1");
  assert(claude21Retired);
  assert.equal(claude21Retired.currentValue, "retired");

  // Deprecations & Retirements
  const depRes = executeTemporalQuery(dataset, {
    categories: ["deprecations", "retirements"],
    range: "all",
    referenceDate: REF_DATE,
  });
  const claudeOpusDep = depRes.events.find((e) => e.model === "claude-3-opus-20240229");
  assert(claudeOpusDep);

  // Replacements
  const replRes = executeTemporalQuery(dataset, {
    categories: ["replacements"],
    range: "all",
    referenceDate: REF_DATE,
  });
  const geminiRepl = replRes.events.find((e) => e.model === "gemini-1.0-pro");
  assert(geminiRepl);
  assert.equal(geminiRepl.currentValue, "gemini-1.5-flash");
});

test("Source provenance and authority are retained on all evidence", () => {
  const dataset = getDemoTemporalEvidence();
  const res = executeTemporalQuery(dataset, { range: "all", referenceDate: REF_DATE });

  for (const event of res.events) {
    assert(event.source.url, "Source URL must be present");
    assert(event.provenance.runId, "Run ID must be present");
    assert(event.authority === "authoritative" || event.authority === "verified_scrape");
    assert(event.confidence > 0 && event.confidence <= 1.0);
  }
});

test("Deterministic ordering: results are sorted deterministically", () => {
  const dataset = getDemoTemporalEvidence();

  const resDesc = executeTemporalQuery(dataset, { sort: "desc", range: "all", referenceDate: REF_DATE });
  for (let i = 1; i < resDesc.events.length; i++) {
    const prev = resDesc.events[i - 1].observedAt;
    const curr = resDesc.events[i].observedAt;
    assert(prev >= curr, "Descending sort violated");
  }

  const resAsc = executeTemporalQuery(dataset, { sort: "asc", range: "all", referenceDate: REF_DATE });
  for (let i = 1; i < resAsc.events.length; i++) {
    const prev = resAsc.events[i - 1].observedAt;
    const curr = resAsc.events[i].observedAt;
    assert(prev <= curr, "Ascending sort violated");
  }
});

test("Empty period handling: handles zero-event range cleanly without errors", () => {
  const dataset = getDemoTemporalEvidence();

  // Future window with 0 events
  const futureRes = executeTemporalQuery(dataset, {
    since: "2030-01-01T00:00:00.000Z",
    until: "2030-01-07T00:00:00.000Z",
    referenceDate: REF_DATE,
  });

  assert.equal(futureRes.totalEvents, 0);
  assert.equal(futureRes.events.length, 0);
  assert.equal(futureRes.metrics.totalEvents, 0);
  assert.equal(futureRes.timeline.length, 0);
  assert.equal(futureRes.deltaSummary.length, 0);
});

test("Natural question parser: parses 'What changed in Claude this month?' deterministically", () => {
  const parsed = parseNaturalQuestion("What changed in Claude this month?");
  assert.equal(parsed.provider, "anthropic");
  assert.equal(parsed.family, "claude");
  assert.equal(parsed.range, "30d");

  const parsedGoogle = parseNaturalQuestion("Any Gemini price drops in the last 7 days?");
  assert.equal(parsedGoogle.provider, "google");
  assert.equal(parsedGoogle.range, "7d");
  assert(parsedGoogle.categories?.includes("pricing"));

  const parsedOpenAi = parseNaturalQuestion("OpenAI deprecations and retirements this year");
  assert.equal(parsedOpenAi.provider, "openai");
  assert(parsedOpenAi.categories?.includes("deprecations"));
});
