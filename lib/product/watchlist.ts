/**
 * My Stack persistence logic, kept pure so it can be tested without a browser.
 *
 * Scope is deliberately hackathon-sized: no account, no server state, no
 * notifications. The browser hook in `components/product/watchlist` supplies
 * `localStorage`; every rule about what a valid entry is lives here.
 *
 * Entries are keyed by a canonical `provider:apiModelId` pair rather than a
 * display name, so a watch survives a provider renaming its marketing label.
 */

export const WATCHLIST_STORAGE_KEY = "ai-radar.my-stack.v1";

export const WATCHLIST_VERSION = 1;

export interface WatchlistEntry {
  /** Canonical key: `${providerSlug}:${apiModelId}`, lowercased. */
  modelKey: string;
  providerSlug: string;
  providerName: string | null;
  /** The provider's own API model id — stable across display-name changes. */
  modelId: string;
  displayName: string | null;
  addedAt: string;
}

export interface WatchlistState {
  version: number;
  entries: WatchlistEntry[];
}

export interface WatchlistCandidate {
  providerSlug: string;
  modelId: string;
  providerName?: string | null;
  displayName?: string | null;
}

/** The identity every watch is stored and matched under. */
export function canonicalModelKey(providerSlug: string, modelId: string): string {
  return `${providerSlug.trim().toLowerCase()}:${modelId.trim().toLowerCase()}`;
}

export function emptyWatchlist(): WatchlistState {
  return { version: WATCHLIST_VERSION, entries: [] };
}

function isValidEntry(value: unknown): value is WatchlistEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.modelKey === "string" &&
    entry.modelKey.length > 0 &&
    typeof entry.providerSlug === "string" &&
    entry.providerSlug.length > 0 &&
    typeof entry.modelId === "string" &&
    entry.modelId.length > 0
  );
}

function normalizeEntry(entry: WatchlistEntry): WatchlistEntry {
  return {
    modelKey: canonicalModelKey(entry.providerSlug, entry.modelId),
    providerSlug: entry.providerSlug.trim().toLowerCase(),
    providerName: entry.providerName ?? null,
    modelId: entry.modelId.trim(),
    displayName: entry.displayName ?? null,
    addedAt: typeof entry.addedAt === "string" ? entry.addedAt : new Date(0).toISOString(),
  };
}

/**
 * Tolerant read: unparseable or partially corrupt storage yields an empty
 * watchlist instead of throwing, and entries missing a canonical id are
 * dropped rather than repaired from a display name.
 */
export function parseWatchlist(raw: string | null | undefined): WatchlistState {
  if (!raw) return emptyWatchlist();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyWatchlist();
  }
  if (typeof parsed !== "object" || parsed === null) return emptyWatchlist();
  const candidate = parsed as { entries?: unknown };
  if (!Array.isArray(candidate.entries)) return emptyWatchlist();

  const seen = new Set<string>();
  const entries: WatchlistEntry[] = [];
  for (const item of candidate.entries) {
    if (!isValidEntry(item)) continue;
    const entry = normalizeEntry(item);
    if (seen.has(entry.modelKey)) continue;
    seen.add(entry.modelKey);
    entries.push(entry);
  }
  return { version: WATCHLIST_VERSION, entries };
}

export function serializeWatchlist(state: WatchlistState): string {
  return JSON.stringify({ version: WATCHLIST_VERSION, entries: state.entries });
}

/** Adds a model, newest first. Re-adding an existing model is a no-op. */
export function addToWatchlist(
  state: WatchlistState,
  candidate: WatchlistCandidate,
  addedAt: string = new Date().toISOString(),
): WatchlistState {
  const modelKey = canonicalModelKey(candidate.providerSlug, candidate.modelId);
  if (state.entries.some((entry) => entry.modelKey === modelKey)) return state;

  const entry = normalizeEntry({
    modelKey,
    providerSlug: candidate.providerSlug,
    providerName: candidate.providerName ?? null,
    modelId: candidate.modelId,
    displayName: candidate.displayName ?? null,
    addedAt,
  });

  return { version: WATCHLIST_VERSION, entries: [entry, ...state.entries] };
}

export function removeFromWatchlist(state: WatchlistState, modelKey: string): WatchlistState {
  const entries = state.entries.filter((entry) => entry.modelKey !== modelKey);
  if (entries.length === state.entries.length) return state;
  return { version: WATCHLIST_VERSION, entries };
}

export function toggleWatchlist(
  state: WatchlistState,
  candidate: WatchlistCandidate,
  addedAt?: string,
): WatchlistState {
  const modelKey = canonicalModelKey(candidate.providerSlug, candidate.modelId);
  return isWatched(state, modelKey)
    ? removeFromWatchlist(state, modelKey)
    : addToWatchlist(state, candidate, addedAt);
}

export function isWatched(state: WatchlistState, modelKey: string): boolean {
  return state.entries.some((entry) => entry.modelKey === modelKey);
}

export function watchedModelKeys(state: WatchlistState): string[] {
  return state.entries.map((entry) => entry.modelKey);
}

/** The `model` query value `GET /api/intelligence/changes` expects. */
export function watchedModelIdsParam(state: WatchlistState): string | null {
  if (state.entries.length === 0) return null;
  return [...new Set(state.entries.map((entry) => entry.modelId))].join(",");
}

export function watchlistLabel(entry: WatchlistEntry): string {
  return entry.displayName ?? entry.modelId;
}
