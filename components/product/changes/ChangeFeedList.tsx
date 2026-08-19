import { EmptyState } from "../../radar/ui/DataState";
import type { ChangeFeedItem } from "../../../lib/product/change-feed";
import { ChangeFeedItemCard } from "./ChangeFeedItemCard";

interface ChangeFeedListProps {
  items: readonly ChangeFeedItem[];
  /** Accessible name for the list; every feed on a page needs its own. */
  label: string;
  watchedKeys?: readonly string[];
  onToggleWatch?: (item: ChangeFeedItem) => void;
  watchDisabled?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}

/** An ordered list of changes, newest first. */
export function ChangeFeedList({
  items,
  label,
  watchedKeys = [],
  onToggleWatch,
  watchDisabled = false,
  emptyTitle = "No changes in this window",
  emptyDescription = "Nothing matched these filters. Widen the time range or clear a filter.",
}: ChangeFeedListProps) {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  const watched = new Set(watchedKeys);

  return (
    <ol className="radar-change-list" aria-label={label}>
      {items.map((item) => (
        <ChangeFeedItemCard
          key={item.id}
          item={item}
          watched={watched.has(item.modelKey)}
          watchDisabled={watchDisabled}
          onToggleWatch={onToggleWatch ? () => onToggleWatch(item) : undefined}
        />
      ))}
    </ol>
  );
}
