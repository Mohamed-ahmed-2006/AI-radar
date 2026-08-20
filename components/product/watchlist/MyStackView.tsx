"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EvidenceBundle } from "../../../lib/intelligence/contracts";
import {
  type ChangeFeedFilters,
  type ChangeFeedReadModel,
  buildChangeFeed,
  changeFeedSearchParams,
  partitionWatchedChanges,
} from "../../../lib/product/change-feed";
import { watchlistLabel } from "../../../lib/product/watchlist";
import Link from "next/link";
import { EmptyState, ErrorState, LoadingState } from "../../radar/ui/DataState";
import { Panel } from "../../radar/ui/Panel";
import { formatAbsoluteTime } from "../../radar/utils";
import { ChangeFeedList } from "../changes/ChangeFeedList";
import { DemoNotice } from "../common/DemoNotice";
import { useWatchlist } from "./use-watchlist";

const FEED_LIMIT = 200;

interface MyStackViewProps {
  initialFeed: ChangeFeedReadModel;
  filters: ChangeFeedFilters;
}

/**
 * My Stack: the models a visitor is tracking, and the recent ecosystem changes
 * that touch them.
 *
 * The stack lives in `localStorage`, so it is read after mount. Until then the
 * lists render their loading state rather than briefly claiming the stack is
 * empty.
 */
export function MyStackView({ initialFeed, filters }: MyStackViewProps) {
  const watchlist = useWatchlist();
  const [feed, setFeed] = useState<ChangeFeedReadModel>(initialFeed);
  const [status, setStatus] = useState<"ready" | "loading" | "error">("ready");
  const [error, setError] = useState<string | null>(null);
  const isFirstRender = useRef(true);

  // A string dependency keeps the effect from re-firing on prop identity alone.
  const query = changeFeedSearchParams(filters, { limit: FEED_LIMIT }).toString();

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    fetch(`/api/intelligence/changes?${query}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as EvidenceBundle & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Changes could not be read.");
        setFeed(buildChangeFeed(payload));
        setStatus("ready");
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Changes could not be read.");
        setStatus("error");
      });
    return () => controller.abort();
  }, [query]);

  const watchedChanges = useMemo(
    () => partitionWatchedChanges(feed.items, watchlist.watchedKeys).watched,
    [feed.items, watchlist.watchedKeys],
  );

  const entries = watchlist.state.entries;

  return (
    <div className="radar-surface-stack">
      {feed.isDemoData && (
        <DemoNotice title="Changes shown here come from the seeded demo dataset.">
          Each event is labelled <strong>Demo</strong>. Your stack itself is real and stored
          in this browser.
        </DemoNotice>
      )}

      <div className="radar-stack-grid">
        <Panel
          id="my-stack-models"
          title="My Stack"
          subtitle={
            watchlist.ready
              ? `${entries.length} model${entries.length === 1 ? "" : "s"} watched in this browser`
              : "Reading your stack…"
          }
        >
          {!watchlist.ready ? (
            <LoadingState title="Reading your stack…" />
          ) : entries.length === 0 ? (
            <EmptyState
              title="No models in your stack yet"
              description="My Stack is a local watchlist for the models you depend on. Browse the catalog, add models, then compare or optimize them. Your stack stays in this browser only."
              action={
                <div className="radar-empty-actions">
                  <Link href="/models" className="radar-compare-go">
                    Browse models
                  </Link>
                  <Link href="/models" className="radar-secondary-button">
                    Add models
                  </Link>
                  <Link href="/models/compare" className="radar-inline-link">
                    Compare
                  </Link>
                  <Link href="/optimizer" className="radar-inline-link">
                    Optimizer
                  </Link>
                </div>
              }
            />
          ) : (
            <ul className="radar-stack-list" aria-label="Models in My Stack">
              {entries.map((entry) => (
                <li key={entry.modelKey} className="radar-stack-item">
                  <div className="min-w-0">
                    <p className="radar-stack-item-name font-mono">{watchlistLabel(entry)}</p>
                    <p className="radar-stack-item-meta">
                      {entry.providerName ?? entry.providerSlug}
                      <span aria-hidden="true"> · </span>
                      added{" "}
                      <time dateTime={entry.addedAt}>{formatAbsoluteTime(entry.addedAt)}</time>
                    </p>
                  </div>
                  <button
                    type="button"
                    className="radar-remove-button"
                    onClick={() => watchlist.remove(entry.modelKey)}
                  >
                    Remove
                    <span className="sr-only"> {watchlistLabel(entry)} from My Stack</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          id="my-stack-changes"
          title="Changes affecting My Stack"
          subtitle="Newest first, across pricing, lifecycle and catalog"
          className="radar-panel-priority"
        >
          {!watchlist.ready || status === "loading" ? (
            <LoadingState title="Loading changes…" />
          ) : status === "error" ? (
            <ErrorState
              title="Changes could not be read"
              description={error ?? undefined}
            />
          ) : entries.length === 0 ? (
            <EmptyState
              title="Nothing to show yet"
              description="Add a model to your stack and its changes will be prioritized here."
            />
          ) : (
            <ChangeFeedList
              items={watchedChanges}
              label="Changes affecting models in My Stack"
              watchedKeys={watchlist.watchedKeys}
              onToggleWatch={(item) =>
                watchlist.toggle({
                  providerSlug: item.providerSlug,
                  modelId: item.modelId,
                  providerName: item.providerName,
                  displayName: item.modelLabel,
                })
              }
              emptyTitle="No recent changes for your stack"
              emptyDescription="None of the models you watch changed in this window."
            />
          )}
        </Panel>
      </div>
    </div>
  );
}
