// These tests exercise the explicit demo mode, which is gated behind a
// server-side opt-in so production can never substitute the fabricated corpus.
// `tests/security/fixture-isolation.test.ts` covers the ungated case.
process.env.AI_RADAR_DEMO_EVIDENCE = "1";

import test from "node:test";
import assert from "node:assert/strict";

import { queryTemporalIntelligence } from "../../lib/intelligence";
import {
  buildChangeFeed,
  changeFeedFiltersFromParams,
  changeFeedSearchParams,
  DEFAULT_CHANGE_FEED_FILTERS,
  filterChangeFeedItems,
  formatChangeValue,
  partitionWatchedChanges,
  prioritizeWatchedChanges,
  significanceTier,
} from "../../lib/product/change-feed";

async function demoFeed() {
  return buildChangeFeed(
    await queryTemporalIntelligence({ demo: true, range: "all", limit: 500 }),
  );
}

test("Change feed: projects demo evidence into renderable items", async () => {
  const feed = await demoFeed();

  assert(feed.items.length > 0, "demo dataset must produce items");
  assert.equal(feed.isDemoData, true);
  assert.equal(feed.stats.totalEvents, feed.totalEvents);

  for (const item of feed.items) {
    assert(item.providerName.length > 0);
    assert(item.modelKey.includes(":"), "model key must be provider-qualified");
    assert.equal(item.modelKey, `${item.providerSlug}:${item.modelId}`.toLowerCase());
    assert(item.changeTypeLabel.length > 0, "change category must be labelled");
    assert(item.summary.length > 0);
    assert(item.observedAt.length > 0, "observed time is required");
  }
});

test("Change feed: price moves carry a formatted before → after and signed delta", async () => {
  const feed = await demoFeed();
  const priceCut = feed.items.find((item) => item.changeType === "price_decreased");

  assert(priceCut, "demo dataset must contain a price decrease");
  assert(priceCut.before?.startsWith("$"), "previous price must be money-formatted");
  assert(priceCut.after?.startsWith("$"), "current price must be money-formatted");
  assert.equal(priceCut.direction, "decrease");
  assert(priceCut.delta?.startsWith("−"), `expected a negative delta, got ${priceCut.delta}`);
  assert(priceCut.delta?.endsWith("%"));
  assert.equal(priceCut.tone, "positive");
});

test("Change feed: lifecycle and replacement changes expose both sides when recorded", async () => {
  const feed = await demoFeed();
  const lifecycle = feed.items.filter(
    (item) => item.category === "lifecycle" || item.category === "replacements",
  );

  assert(lifecycle.length > 0, "demo dataset must contain lifecycle-family changes");
  for (const item of lifecycle) {
    // A lifecycle transition always states what it moved to.
    assert.notEqual(item.after, null, `${item.id} must record its new value`);
  }
});

test("Change feed: never invents a value that the backend did not record", () => {
  assert.equal(formatChangeValue(null), null);
  assert.equal(formatChangeValue(""), null);
  // Structured payloads cannot be shown as a single before/after cell.
  assert.equal(formatChangeValue({ nested: true }), null);
  assert.equal(formatChangeValue("deprecated"), "Deprecated");
  assert.equal(formatChangeValue(4096), "4096");
});

test("Change feed: filters narrow by provider, category and time range", async () => {
  const feed = await demoFeed();
  const provider = feed.providerOptions[0]?.value;
  assert(provider, "demo dataset must expose provider options");

  const byProvider = filterChangeFeedItems(feed.items, {
    ...DEFAULT_CHANGE_FEED_FILTERS,
    range: "all",
    provider,
  });
  assert(byProvider.length > 0);
  assert(byProvider.every((item) => item.providerSlug === provider));

  const byCategory = filterChangeFeedItems(feed.items, {
    ...DEFAULT_CHANGE_FEED_FILTERS,
    range: "all",
    category: "pricing",
  });
  assert(byCategory.length > 0);
  assert(byCategory.every((item) => item.category === "pricing"));

  // A window that closes before the oldest event must exclude everything.
  const oldest = feed.items
    .map((item) => Date.parse(item.observedAt))
    .sort((left, right) => left - right)[0];
  const wellAfter = new Date(oldest + 400 * 24 * 60 * 60 * 1000);
  const stale = filterChangeFeedItems(
    feed.items,
    { ...DEFAULT_CHANGE_FEED_FILTERS, range: "24h" },
    wellAfter,
  );
  assert.equal(stale.length, 0);
});

test("Change feed: filter state round-trips through the query string", () => {
  const filters = {
    provider: "anthropic",
    category: "pricing" as const,
    range: "7d" as const,
    demo: true,
  };
  const params = changeFeedSearchParams(filters, { limit: 50 });

  assert.equal(params.get("provider"), "anthropic");
  assert.equal(params.get("categories"), "pricing");
  assert.equal(params.get("range"), "7d");
  assert.equal(params.get("demo"), "true");
  assert.equal(params.get("limit"), "50");

  assert.deepEqual(changeFeedFiltersFromParams(params), filters);
});

test("Change feed: unknown filter values fall back to the defaults", () => {
  const filters = changeFeedFiltersFromParams(
    new URLSearchParams("range=forever&categories=nonsense"),
  );
  assert.equal(filters.range, DEFAULT_CHANGE_FEED_FILTERS.range);
  assert.equal(filters.category, null);
  assert.equal(filters.provider, null);
  assert.equal(filters.demo, false);
});

test("Change feed: an empty result reports zero rather than falling back to demo data", async () => {
  const feed = buildChangeFeed(
    await queryTemporalIntelligence({
      demo: true,
      range: "all",
      provider: "provider-that-does-not-exist",
    }),
  );

  assert.equal(feed.items.length, 0);
  assert.equal(feed.totalEvents, 0);
  assert.equal(feed.stats.priceIncreases, 0);
  assert.equal(feed.stats.priceDecreases, 0);
  assert.equal(feed.providerOptions.length, 0);
});

test("Change feed: live queries are never silently substituted with demo evidence", async () => {
  // Without database access the live path yields an empty bundle; it must not
  // borrow the demo dataset to look populated.
  const feed = buildChangeFeed(await queryTemporalIntelligence({ demo: false, range: "all" }));
  assert.equal(feed.isDemoData, false);
  assert(feed.items.every((item) => item.isDemo === false));
});

test("Change feed: demo items are individually labelled, not just the bundle", async () => {
  const feed = await demoFeed();
  assert.equal(feed.isDemoData, true);
  assert(feed.items.every((item) => item.isDemo === true));
  assert(feed.items.every((item) => item.provenance.isDemo === true));
});

test("Change feed: watched models are separated out for prioritization", async () => {
  const feed = await demoFeed();
  const watchedKey = feed.items[0]?.modelKey;
  assert(watchedKey);

  const { watched, rest } = partitionWatchedChanges(feed.items, [watchedKey]);
  assert(watched.length > 0);
  assert(watched.every((item) => item.modelKey === watchedKey));
  assert(rest.every((item) => item.modelKey !== watchedKey));
  assert.equal(watched.length + rest.length, feed.items.length);

  const prioritized = prioritizeWatchedChanges(feed.items, [watchedKey]);
  assert.equal(prioritized.length, feed.items.length);
  assert.equal(prioritized[0]?.modelKey, watchedKey);

  // Each half stays newest-first.
  const watchedSlice = prioritized.slice(0, watched.length);
  for (let index = 1; index < watchedSlice.length; index += 1) {
    assert(
      Date.parse(watchedSlice[index - 1].observedAt) >=
        Date.parse(watchedSlice[index].observedAt),
    );
  }
});

test("Change feed: with nothing watched, ordering is left untouched", async () => {
  const feed = await demoFeed();
  const { watched, rest } = partitionWatchedChanges(feed.items, []);
  assert.equal(watched.length, 0);
  assert.deepEqual(
    rest.map((item) => item.id),
    feed.items.map((item) => item.id),
  );
});

test("Change feed: significance tiers are derived from the backend score", () => {
  assert.equal(significanceTier(95), "high");
  assert.equal(significanceTier(75), "high");
  assert.equal(significanceTier(50), "medium");
  assert.equal(significanceTier(39), "low");
});
