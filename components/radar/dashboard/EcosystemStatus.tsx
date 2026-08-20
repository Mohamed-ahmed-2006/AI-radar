import Link from "next/link";
import type { EcosystemSummary, SentinelFleetSnapshot } from "../types";
import { EvidenceState } from "../ui/DataState";
import { StatCard } from "../ui/StatCard";
import { StatusDot } from "../ui/StatusDot";
import { formatAbsoluteTime } from "../utils";

interface EcosystemStatusProps {
  data: EcosystemSummary;
  sentinel: SentinelFleetSnapshot;
  loading?: boolean;
}

function countLabel(value: number | null): string {
  return value === null ? "—" : String(value);
}

export function EcosystemStatus({ data, sentinel, loading }: EcosystemStatusProps) {
  if (loading) {
    return (
      <section aria-label="Ecosystem status" className="radar-stat-grid radar-stat-grid-wide">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="radar-stat-card">
            <div className="radar-skeleton mb-2 h-3 w-20" />
            <div className="radar-skeleton h-5 w-12" />
          </div>
        ))}
      </section>
    );
  }

  const statusMap = {
    healthy: "positive" as const,
    degraded: "warning" as const,
    down: "negative" as const,
    unknown: "neutral" as const,
  };

  const freshnessHint = data.lastGlobalRefreshAt
    ? "global collection"
    : "not observed";

  return (
    <div className="radar-ecosystem-block">
      <section aria-label="Ecosystem status" className="radar-stat-grid radar-stat-grid-wide">
        <StatCard
          label="Ecosystem"
          value={
            <span className="inline-flex items-center gap-2">
              <StatusDot status={data.status} pulse={data.status === "healthy"} />
              <span className="capitalize">{data.status}</span>
            </span>
          }
          status={statusMap[data.status]}
        />
        <StatCard
          label="Models priced"
          value={data.pricedModels}
          hint="canonical pricing on record"
        />
        <StatCard
          label="Model identities"
          value={data.modelIdentities}
          hint="observed and tracked"
        />
        <StatCard label="Providers" value={data.providersTracked} />
        <StatCard
          label="Monitored sources"
          value={data.sourcesMonitored}
          hint="collection registry"
        />
        <StatCard
          label="Changes (24h)"
          value={data.changesLast24h}
          hint={data.changesLast24h > 0 ? "meaningful events" : "none observed"}
        />
        <StatCard
          label="Lifecycle (7d)"
          value={data.lifecycleChangesLast7d}
          status={data.lifecycleChangesLast7d > 0 ? "warning" : "neutral"}
          hint="deprecation & removal"
        />
        <StatCard
          label="Price changes (7d)"
          value={data.priceChangesLast7d}
          status={data.priceChangesLast7d > 0 ? "warning" : "neutral"}
        />
        <StatCard
          label="Last refresh"
          value={formatAbsoluteTime(data.lastGlobalRefreshAt)}
          hint={freshnessHint}
        />
      </section>

      <section aria-label="Source health" className="radar-sentinel-glance">
        {sentinel.available ? (
          <div className="radar-stat-grid radar-stat-grid-sentinel">
            <StatCard
              label="Source health"
              value={countLabel(sentinel.totalSources)}
              hint={sentinel.isDemo ? "labelled demo fleet" : "Sentinel fleet"}
            />
            <StatCard
              label="Degraded"
              value={countLabel(sentinel.degraded)}
              status={sentinel.degraded && sentinel.degraded > 0 ? "warning" : "neutral"}
            />
            <StatCard
              label="Quarantined"
              value={countLabel(sentinel.quarantined)}
              status={sentinel.quarantined && sentinel.quarantined > 0 ? "negative" : "neutral"}
            />
            <StatCard
              label="Recovered"
              value={countLabel(sentinel.recovered)}
              status={sentinel.recovered && sentinel.recovered > 0 ? "positive" : "neutral"}
            />
          </div>
        ) : (
          <EvidenceState
            tone="unavailable"
            title="Source health counts are not available"
            description={
              sentinel.unavailableReason ??
              "Sentinel did not return a fleet snapshot. No production numbers are invented."
            }
            action={
              <Link href="/source-health" className="radar-inline-link">
                Open Source Health
              </Link>
            }
          />
        )}
      </section>
    </div>
  );
}
