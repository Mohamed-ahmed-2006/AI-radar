import type { ProviderHealth } from "../types";
import { Badge } from "../ui/Badge";
import { EmptyState, LoadingState } from "../ui/DataState";
import { Panel } from "../ui/Panel";
import { StatusDot } from "../ui/StatusDot";
import { formatRelativeTime } from "../utils";

interface ProviderHealthOverviewProps {
  providers: ProviderHealth[];
  loading?: boolean;
}

export function ProviderHealthOverview({
  providers,
  loading,
}: ProviderHealthOverviewProps) {
  return (
    <Panel
      title="Provider health"
      subtitle="Collection pipeline status by provider"
    >
      {loading ? (
        <LoadingState title="Loading provider status…" />
      ) : providers.length === 0 ? (
        <EmptyState
          title="No providers configured"
          description="Provider health data will appear once collectors are registered."
        />
      ) : (
        <ul className="divide-y divide-radar-border-subtle" aria-label="Provider health status">
          {providers.map((provider) => (
            <li
              key={provider.id}
              className={`py-3 first:pt-0 last:pb-0 ${provider.status === "degraded" ? "radar-degraded-row" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusDot status={provider.status} />
                    <span className="text-sm font-medium text-radar-text-primary">
                      {provider.name}
                    </span>
                    {provider.status === "degraded" && (
                      <Badge variant="warning">Degraded</Badge>
                    )}
                    {provider.status === "unknown" && (
                      <Badge variant="muted">Unknown</Badge>
                    )}
                  </div>
                  <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                    {/* Every metric here is read from a row a collection run
                        wrote. Request latency and per-run error rate are not
                        measured anywhere in the pipeline, so they are absent
                        rather than shown as an empty dash. */}
                    <div>
                      <dt className="text-radar-text-muted inline">Priced models </dt>
                      <dd className="inline font-mono text-radar-text-secondary">
                        {provider.pricedModels}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-radar-text-muted inline">Sources </dt>
                      <dd className="inline font-mono text-radar-text-secondary">
                        {provider.sourcesMonitored}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-radar-text-muted inline">Accepted records </dt>
                      <dd className="inline font-mono text-radar-text-secondary">
                        {provider.acceptedRecords === null
                          ? "not reported"
                          : provider.acceptedRecords.toLocaleString("en-US")}
                      </dd>
                    </div>
                    <div className="radar-advanced-id">
                      <dt className="text-radar-text-muted inline">Collector </dt>
                      <dd className="inline font-mono text-radar-text-muted truncate">
                        {provider.collectorId}
                      </dd>
                    </div>
                  </dl>
                  {provider.notes && (
                    <p className="mt-1 text-[10px] text-radar-warn">{provider.notes}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[10px] text-radar-text-muted block">Last collection</span>
                  <time
                    dateTime={provider.lastCollectionAt ?? undefined}
                    className="text-[11px] font-mono text-radar-text-secondary tabular-nums"
                  >
                    {provider.lastCollectionAt
                      ? formatRelativeTime(provider.lastCollectionAt)
                      : "—"}
                  </time>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
