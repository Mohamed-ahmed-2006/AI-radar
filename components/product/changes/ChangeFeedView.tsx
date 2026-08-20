"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EvidenceBundle } from "../../../lib/intelligence/contracts";
import {
  type ChangeFeedFilters as Filters,
  type ChangeFeedItem,
  type ChangeFeedReadModel,
  buildChangeFeed,
  changeFeedSearchParams,
  partitionWatchedChanges,
} from "../../../lib/product/change-feed";
import { ErrorState, LoadingState } from "../../radar/ui/DataState";
import { Panel } from "../../radar/ui/Panel";
import { StatCard } from "../../radar/ui/StatCard";
import { DemoNotice } from "../common/DemoNotice";
import { useWatchlist } from "../watchlist/use-watchlist";
import { GroundedProse } from "../ui/GroundedProse";
import { ChangeFeedFilters } from "./ChangeFeedFilters";
import { ChangeFeedList } from "./ChangeFeedList";

const FEED_LIMIT = 100;

type FeedStatus = "ready" | "loading" | "error";

interface ChangeFeedViewProps {
  /** Server-rendered first page, so the feed is populated on first paint. */
  initialFeed: ChangeFeedReadModel;
  initialFilters: Filters;
  /**
   * Filter options derived from the unfiltered bundle. Held stable so choosing
   * one provider never removes the others from the control.
   */
  providerOptions: ChangeFeedReadModel["providerOptions"];
  categoryOptions: ChangeFeedReadModel["categoryOptions"];
}

export function ChangeFeedView({
  initialFeed,
  initialFilters,
  providerOptions,
  categoryOptions,
}: ChangeFeedViewProps) {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [feed, setFeed] = useState<ChangeFeedReadModel>(initialFeed);
  const [status, setStatus] = useState<FeedStatus>("ready");
  const [error, setError] = useState<string | null>(null);
  const isFirstRender = useRef(true);

  const watchlist = useWatchlist();

  const query = changeFeedSearchParams(filters, { limit: FEED_LIMIT }).toString();

  useEffect(() => {
    // The first page is already rendered from the server.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const controller = new AbortController();
    setStatus("loading");
    setError(null);

    fetch(`/api/intelligence/changes?${query}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as EvidenceBundle & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "The change feed could not be read.");
        setFeed(buildChangeFeed(payload));
        setStatus("ready");
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "The change feed could not be read.");
        setStatus("error");
      });

    return () => controller.abort();
  }, [query]);

  const { watched, rest } = useMemo(
    () => partitionWatchedChanges(feed.items, watchlist.watchedKeys),
    [feed.items, watchlist.watchedKeys],
  );

  const onToggleWatch = useCallback(
    (item: ChangeFeedItem) =>
      watchlist.toggle({
        providerSlug: item.providerSlug,
        modelId: item.modelId,
        providerName: item.providerName,
        displayName: item.modelLabel,
      }),
    [watchlist],
  );

  return (
    <div className="radar-surface-stack">
      {feed.isDemoData && (
        <DemoNotice title="This feed is showing the seeded demo dataset.">
          Every event below is labelled <strong>Demo</strong> and comes from the temporal
          intelligence demo evidence, not from observed production collection. Clear the
          demo filter to read live data.
        </DemoNotice>
      )}

      <dl className="radar-stat-grid">
        <StatCard label="Changes" value={feed.stats.totalEvents} hint="In this window" />
        <StatCard
          label="Price cuts"
          value={feed.stats.priceDecreases}
          status={feed.stats.priceDecreases > 0 ? "positive" : "neutral"}
        />
        <StatCard
          label="Price rises"
          value={feed.stats.priceIncreases}
          status={feed.stats.priceIncreases > 0 ? "warning" : "neutral"}
        />
        <StatCard label="Models added" value={feed.stats.modelsAdded} />
        <StatCard
          label="Deprecations"
          value={feed.stats.deprecationsScheduled}
          status={feed.stats.deprecationsScheduled > 0 ? "warning" : "neutral"}
        />
        <StatCard
          label="Retirements"
          value={feed.stats.retirementsScheduled}
          status={feed.stats.retirementsScheduled > 0 ? "negative" : "neutral"}
        />
      </dl>

      {feed.narrativeSummary && (
        <Panel
          id="change-summary"
          title="What changed"
          subtitle="Deterministic summary of the events below"
        >
          <GroundedProse text={feed.narrativeSummary} />
        </Panel>
      )}

      <ChangeFeedFilters
        filters={filters}
        providerOptions={providerOptions}
        categoryOptions={categoryOptions}
        onChange={setFilters}
        busy={status === "loading"}
      />

      {watched.length > 0 && (
        <Panel
          id="watched-changes"
          title="Affects My Stack"
          subtitle={`${watched.length} change${watched.length === 1 ? "" : "s"} to models you watch`}
          className="radar-panel-priority"
        >
          <ChangeFeedList
            items={watched}
            label="Changes affecting models in My Stack"
            watchedKeys={watchlist.watchedKeys}
            onToggleWatch={onToggleWatch}
            watchDisabled={!watchlist.ready}
          />
        </Panel>
      )}

      <Panel
        id="all-changes"
        title="Change feed"
        subtitle={
          watched.length > 0
            ? "Every other change in this window, newest first"
            : "Every change in this window, newest first"
        }
      >
        {status === "loading" ? (
          <LoadingState title="Loading changes…" />
        ) : status === "error" ? (
          <ErrorState
            title="The change feed could not be read"
            description={error ?? undefined}
          />
        ) : (
          <ChangeFeedList
            items={rest}
            label="Ecosystem change feed"
            watchedKeys={watchlist.watchedKeys}
            onToggleWatch={onToggleWatch}
            watchDisabled={!watchlist.ready}
            emptyTitle={
              watched.length > 0 ? "No other changes in this window" : "No changes in this window"
            }
            emptyDescription="Nothing else matched these filters. Widen the time range or clear a filter."
          />
        )}
      </Panel>
    </div>
  );
}
