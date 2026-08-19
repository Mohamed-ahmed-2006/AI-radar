import test from "node:test";
import assert from "node:assert/strict";

import {
  WATCHLIST_STORAGE_KEY,
  addToWatchlist,
  canonicalModelKey,
  emptyWatchlist,
  isWatched,
  parseWatchlist,
  removeFromWatchlist,
  serializeWatchlist,
  toggleWatchlist,
  watchedModelIdsParam,
  watchedModelKeys,
  watchlistLabel,
} from "../../lib/product/watchlist";

const claude = {
  providerSlug: "anthropic",
  modelId: "claude-3-5-sonnet-20241022",
  providerName: "Anthropic",
  displayName: "Claude 3.5 Sonnet",
};

test("Watchlist: canonical keys are provider-qualified and case-insensitive", () => {
  assert.equal(
    canonicalModelKey("Anthropic", "Claude-3-5-Sonnet-20241022"),
    "anthropic:claude-3-5-sonnet-20241022",
  );
  assert.notEqual(
    canonicalModelKey("anthropic", "claude-3-5-sonnet-20241022"),
    canonicalModelKey("openai", "claude-3-5-sonnet-20241022"),
  );
});

test("Watchlist: adds a model with its canonical id, not just a display name", () => {
  const state = addToWatchlist(emptyWatchlist(), claude, "2026-08-17T10:00:00.000Z");

  assert.equal(state.entries.length, 1);
  const entry = state.entries[0];
  assert.equal(entry.modelKey, "anthropic:claude-3-5-sonnet-20241022");
  assert.equal(entry.modelId, "claude-3-5-sonnet-20241022");
  assert.equal(entry.providerSlug, "anthropic");
  assert.equal(entry.displayName, "Claude 3.5 Sonnet");
  assert.equal(entry.addedAt, "2026-08-17T10:00:00.000Z");
  assert(isWatched(state, entry.modelKey));
});

test("Watchlist: re-adding the same model is a no-op", () => {
  const once = addToWatchlist(emptyWatchlist(), claude);
  const twice = addToWatchlist(once, { ...claude, displayName: "Renamed" });

  assert.equal(twice.entries.length, 1);
  assert.equal(twice, once, "an unchanged state must be returned by identity");
});

test("Watchlist: newest addition is listed first", () => {
  const state = addToWatchlist(
    addToWatchlist(emptyWatchlist(), claude, "2026-08-01T00:00:00.000Z"),
    { providerSlug: "openai", modelId: "gpt-4o" },
    "2026-08-02T00:00:00.000Z",
  );

  assert.deepEqual(watchedModelKeys(state), [
    "openai:gpt-4o",
    "anthropic:claude-3-5-sonnet-20241022",
  ]);
});

test("Watchlist: removes by canonical key and leaves others alone", () => {
  const state = addToWatchlist(
    addToWatchlist(emptyWatchlist(), claude),
    { providerSlug: "openai", modelId: "gpt-4o" },
  );

  const removed = removeFromWatchlist(state, "anthropic:claude-3-5-sonnet-20241022");
  assert.deepEqual(watchedModelKeys(removed), ["openai:gpt-4o"]);
  assert.equal(isWatched(removed, "anthropic:claude-3-5-sonnet-20241022"), false);

  const missing = removeFromWatchlist(removed, "nobody:nothing");
  assert.equal(missing, removed, "removing an absent model must not churn state");
});

test("Watchlist: toggling adds then removes the same model", () => {
  const added = toggleWatchlist(emptyWatchlist(), claude);
  assert.equal(added.entries.length, 1);

  const removedAgain = toggleWatchlist(added, claude);
  assert.equal(removedAgain.entries.length, 0);
});

test("Watchlist: state survives a serialize/parse round trip", () => {
  const state = addToWatchlist(emptyWatchlist(), claude, "2026-08-17T10:00:00.000Z");
  const restored = parseWatchlist(serializeWatchlist(state));

  assert.deepEqual(restored.entries, state.entries);
  assert.equal(WATCHLIST_STORAGE_KEY, "ai-radar.my-stack.v1");
});

test("Watchlist: corrupt or foreign storage yields an empty stack instead of throwing", () => {
  assert.deepEqual(parseWatchlist(null), emptyWatchlist());
  assert.deepEqual(parseWatchlist(""), emptyWatchlist());
  assert.deepEqual(parseWatchlist("not json"), emptyWatchlist());
  assert.deepEqual(parseWatchlist("[]"), emptyWatchlist());
  assert.deepEqual(parseWatchlist('{"entries":"nope"}'), emptyWatchlist());
});

test("Watchlist: entries lacking a canonical id are dropped, not repaired from a name", () => {
  const restored = parseWatchlist(
    JSON.stringify({
      version: 1,
      entries: [
        { displayName: "Claude 3.5 Sonnet" },
        { modelKey: "openai:gpt-4o", providerSlug: "openai", modelId: "gpt-4o" },
      ],
    }),
  );

  assert.deepEqual(watchedModelKeys(restored), ["openai:gpt-4o"]);
});

test("Watchlist: duplicate stored entries collapse to one", () => {
  const restored = parseWatchlist(
    JSON.stringify({
      version: 1,
      entries: [
        { modelKey: "openai:gpt-4o", providerSlug: "openai", modelId: "gpt-4o" },
        { modelKey: "openai:gpt-4o", providerSlug: "OpenAI", modelId: "gpt-4o" },
      ],
    }),
  );

  assert.equal(restored.entries.length, 1);
});

test("Watchlist: exposes the model ids the changes API expects", () => {
  const state = addToWatchlist(
    addToWatchlist(emptyWatchlist(), claude),
    { providerSlug: "openai", modelId: "gpt-4o" },
  );

  assert.equal(watchedModelIdsParam(state), "gpt-4o,claude-3-5-sonnet-20241022");
  assert.equal(watchedModelIdsParam(emptyWatchlist()), null);
});

test("Watchlist: falls back to the canonical id when no display name is known", () => {
  const state = addToWatchlist(emptyWatchlist(), {
    providerSlug: "xai",
    modelId: "grok-2",
  });

  assert.equal(watchlistLabel(state.entries[0]), "grok-2");
});
