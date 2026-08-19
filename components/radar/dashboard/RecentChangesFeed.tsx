import Link from "next/link";
import type { ChangeEvent } from "../types";
import { Badge } from "../ui/Badge";
import { EmptyState, LoadingState } from "../ui/DataState";
import { Panel } from "../ui/Panel";
import { changeTypeLabel, formatRelativeTime } from "../utils";
import { modelDetailHref } from "../../../lib/product/explorer";

const severityVariant = {
  info: "info" as const,
  warning: "warning" as const,
  critical: "critical" as const,
};

interface RecentChangesFeedProps {
  changes: ChangeEvent[];
  loading?: boolean;
  maxItems?: number;
}

function sourceDetailHref(sourceId: string): string | null {
  if (!sourceId || sourceId === "—") return null;
  return `/sources/${encodeURIComponent(sourceId)}`;
}

export function RecentChangesFeed({
  changes,
  loading,
  maxItems = 8,
}: RecentChangesFeedProps) {
  const items = changes.slice(0, maxItems);

  return (
    <Panel
      id="changes"
      title="Recent changes"
      subtitle="Detected pricing, model, and source events"
      action={
        <Link href="/changes" className="radar-inline-link">
          View Changes
        </Link>
      }
    >
      {loading ? (
        <LoadingState title="Loading change feed…" />
      ) : items.length === 0 ? (
        <EmptyState
          title="No changes detected"
          description="The change-detection pipeline has not recorded any events yet."
          action={
            <Link href="/changes" className="radar-inline-link">
              Open the change feed
            </Link>
          }
        />
      ) : (
        <ol className="radar-feed" aria-label="Recent ecosystem changes">
          {items.map((change) => {
            const sourceHref = sourceDetailHref(change.sourceId);
            const modelHref = change.modelCanonicalId
              ? modelDetailHref(change.modelCanonicalId)
              : null;
            return (
              <li key={change.id} className="radar-feed-item">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <Badge variant={severityVariant[change.severity]}>
                        {changeTypeLabel(change.type)}
                      </Badge>
                      <span className="text-[10px] text-radar-text-muted font-mono">
                        {change.provider}
                        {change.model && ` · ${change.model}`}
                      </span>
                    </div>
                    <p className="text-sm text-radar-text-primary leading-snug">
                      {change.summary}
                    </p>
                    {change.detail && (
                      <p className="text-xs text-radar-text-muted mt-0.5 font-mono">
                        {change.detail}
                      </p>
                    )}
                    <div className="radar-feed-links">
                      {modelHref && (
                        <Link href={modelHref} className="radar-inline-link">
                          Model
                        </Link>
                      )}
                      {sourceHref && (
                        <Link href={sourceHref} className="radar-inline-link">
                          Source
                        </Link>
                      )}
                      <Link href="/changes" className="radar-inline-link">
                        Provenance
                      </Link>
                    </div>
                  </div>
                  <time
                    dateTime={change.detectedAt}
                    className="text-[10px] text-radar-text-muted whitespace-nowrap shrink-0 tabular-nums"
                    title={change.detectedAt}
                  >
                    {formatRelativeTime(change.detectedAt)}
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
