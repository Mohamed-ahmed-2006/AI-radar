"use client";

import { WatchButton } from "./WatchButton";
import { useWatchlist } from "./use-watchlist";
import type { ModelIdentityView } from "../../../lib/product/explorer";

/** Adds the current catalog model to this browser's My Stack. */
export function ModelWatchControl({
  identity,
  size = "sm",
}: {
  identity: Pick<
    ModelIdentityView,
    "canonicalId" | "providerSlug" | "providerName" | "displayName" | "apiModelId" | "modelId"
  >;
  size?: "sm" | "md";
}) {
  const watchlist = useWatchlist();
  const modelId = identity.apiModelId ?? identity.modelId;
  const watched = watchlist.isWatched(identity.canonicalId) || watchlist.isWatched(
    `${identity.providerSlug}:${modelId}`.toLowerCase(),
  );

  return (
    <WatchButton
      watched={watched}
      modelLabel={identity.displayName}
      disabled={!watchlist.ready}
      size={size}
      onToggle={() =>
        watchlist.toggle({
          providerSlug: identity.providerSlug,
          modelId,
          providerName: identity.providerName,
          displayName: identity.displayName,
        })
      }
    />
  );
}
