"use client";

import Link from "next/link";
import { EmptyState } from "../ui/DataState";
import { Panel } from "../ui/Panel";
import { useWatchlist } from "../../product/watchlist/use-watchlist";
import type { ChangeEvent } from "../types";

/**
 * My Stack is browser-local. The dashboard only reports what this visitor
 * actually watches — it never invents a shared production watchlist.
 */
export function StackPulseCard({ changes }: { changes: readonly ChangeEvent[] }) {
  const watchlist = useWatchlist();

  if (!watchlist.ready) {
    return (
      <Panel
        id="my-stack-glance"
        title="My Stack"
        subtitle="Stored in this browser only"
        action={
          <Link href="/my-stack" className="radar-inline-link">
            Open
          </Link>
        }
      >
        <p className="text-xs text-radar-text-muted" role="status">
          Reading this browser’s stack…
        </p>
      </Panel>
    );
  }

  const entries = watchlist.state.entries;
  const keys = new Set(watchlist.watchedKeys);
  const names = new Set(
    entries.flatMap((entry) =>
      [entry.modelId, entry.displayName, entry.modelKey]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.toLowerCase()),
    ),
  );

  const matchingChanges = changes.filter((change) => {
    if (change.modelCanonicalId && keys.has(change.modelCanonicalId.toLowerCase())) {
      return true;
    }
    if (!change.model) return false;
    return names.has(change.model.toLowerCase());
  });

  return (
    <Panel
      id="my-stack-glance"
      title="My Stack"
      subtitle="Stored in this browser only"
      action={
        <Link href="/my-stack" className="radar-inline-link">
          Open My Stack
        </Link>
      }
    >
      {entries.length === 0 ? (
        <EmptyState
          title="No models in this browser’s stack"
          description="Add models from explorer, detail or the change feed. Nothing is sent to a server."
          action={
            <Link href="/models" className="radar-inline-link">
              Explore Models
            </Link>
          }
        />
      ) : (
        <div className="radar-stack-glance">
          <p className="radar-stack-glance-count">
            <span className="tabular-nums">{entries.length}</span> watched model
            {entries.length === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-radar-text-secondary">
            {matchingChanges.length === 0
              ? "No recent dashboard changes match this stack."
              : `${matchingChanges.length} recent dashboard change${matchingChanges.length === 1 ? "" : "s"} affect this stack.`}
          </p>
          {matchingChanges.slice(0, 3).map((change) => (
            <p key={change.id} className="radar-stack-glance-item">
              {change.summary}
            </p>
          ))}
        </div>
      )}
    </Panel>
  );
}
