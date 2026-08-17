import type { EcosystemSummary } from "../types";
import { StatCard } from "../ui/StatCard";
import { StatusDot } from "../ui/StatusDot";
import { formatAbsoluteTime } from "../utils";

interface EcosystemStatusProps {
  data: EcosystemSummary;
  loading?: boolean;
}

export function EcosystemStatus({ data, loading }: EcosystemStatusProps) {
  if (loading) {
    return (
      <section aria-label="Ecosystem status" className="radar-stat-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="radar-stat-card animate-pulse">
            <div className="h-3 w-20 bg-radar-surface-raised rounded mb-2" />
            <div className="h-6 w-12 bg-radar-surface-raised rounded" />
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

  return (
    <section aria-label="Ecosystem status" className="radar-stat-grid">
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
        label="Models tracked"
        value={data.modelsTracked}
      />
      <StatCard
        label="Providers"
        value={data.providersTracked}
      />
      <StatCard
        label="Changes (24h)"
        value={data.changesLast24h}
        hint={data.changesLast24h > 0 ? "since last cycle" : undefined}
      />
      <StatCard
        label="Price changes (7d)"
        value={data.priceChangesLast7d}
        status={data.priceChangesLast7d > 0 ? "warning" : "neutral"}
      />
      <StatCard
        label="Last refresh"
        value={formatAbsoluteTime(data.lastGlobalRefreshAt)}
        hint="global collection"
      />
    </section>
  );
}
