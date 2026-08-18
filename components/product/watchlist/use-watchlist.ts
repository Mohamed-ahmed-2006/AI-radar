"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  WATCHLIST_STORAGE_KEY,
  type WatchlistCandidate,
  type WatchlistState,
  addToWatchlist,
  canonicalModelKey,
  emptyWatchlist,
  isWatched as isWatchedIn,
  parseWatchlist,
  removeFromWatchlist,
  serializeWatchlist,
  watchedModelKeys,
} from "../../../lib/product/watchlist";

/**
 * My Stack, backed by `localStorage`.
 *
 * The hackathon scope has no accounts, so the browser is the only store. It is
 * read through `useSyncExternalStore`, which is what makes the stack a genuine
 * external store rather than state copied into React: duplicate tabs stay in
 * step, and server rendering gets a stable empty snapshot so hydration never
 * mismatches.
 *
 * Every rule about what a valid entry is lives in `lib/product/watchlist`.
 */

interface Snapshot {
  /** False while rendering on the server and during hydration. */
  ready: boolean;
  state: WatchlistState;
}

const SERVER_SNAPSHOT: Snapshot = { ready: false, state: emptyWatchlist() };

const listeners = new Set<() => void>();

let cachedRaw: string | null | undefined;
let cachedSnapshot: Snapshot = SERVER_SNAPSHOT;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(WATCHLIST_STORAGE_KEY);
  } catch {
    // Private-mode and blocked-storage browsers still get a working session.
    return null;
  }
}

/**
 * Keyed on the stored string so an unchanged store returns the identical
 * object — `useSyncExternalStore` treats a new reference as a change.
 */
function getSnapshot(): Snapshot {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedSnapshot = { ready: true, state: parseWatchlist(raw) };
  }
  return cachedSnapshot;
}

function getServerSnapshot(): Snapshot {
  return SERVER_SNAPSHOT;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== WATCHLIST_STORAGE_KEY) return;
    emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function commit(next: (current: WatchlistState) => WatchlistState): void {
  const current = getSnapshot().state;
  const updated = next(current);
  if (updated === current) return;
  try {
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, serializeWatchlist(updated));
  } catch {
    // Persistence is best-effort; the snapshot below keeps the session usable.
  }
  cachedRaw = readRaw();
  cachedSnapshot = { ready: true, state: updated };
  emit();
}

export interface UseWatchlistResult {
  /** False until `localStorage` has been read, so the UI can avoid flicker. */
  ready: boolean;
  state: WatchlistState;
  watchedKeys: string[];
  isWatched: (modelKey: string) => boolean;
  add: (candidate: WatchlistCandidate) => void;
  remove: (modelKey: string) => void;
  toggle: (candidate: WatchlistCandidate) => void;
  clear: () => void;
}

export function useWatchlist(): UseWatchlistResult {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const add = useCallback(
    (candidate: WatchlistCandidate) => commit((current) => addToWatchlist(current, candidate)),
    [],
  );

  const remove = useCallback(
    (modelKey: string) => commit((current) => removeFromWatchlist(current, modelKey)),
    [],
  );

  const toggle = useCallback((candidate: WatchlistCandidate) => {
    const key = canonicalModelKey(candidate.providerSlug, candidate.modelId);
    commit((current) =>
      isWatchedIn(current, key)
        ? removeFromWatchlist(current, key)
        : addToWatchlist(current, candidate),
    );
  }, []);

  const clear = useCallback(() => commit(() => emptyWatchlist()), []);

  const watchedKeys = useMemo(() => watchedModelKeys(snapshot.state), [snapshot.state]);
  const isWatched = useCallback(
    (modelKey: string) => watchedKeys.includes(modelKey),
    [watchedKeys],
  );

  return {
    ready: snapshot.ready,
    state: snapshot.state,
    watchedKeys,
    isWatched,
    add,
    remove,
    toggle,
    clear,
  };
}
