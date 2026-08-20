import type { RadarDashboardData } from "../types";
import { EvidenceState } from "../ui/DataState";
import { DecisionActions } from "./DecisionActions";
import { EcosystemStatus } from "./EcosystemStatus";
import { PricingMatrix } from "./PricingMatrix";
import { ProviderHealthOverview } from "./ProviderHealthOverview";
import { RadarPulse } from "./RadarPulse";
import { RecentChangesFeed } from "./RecentChangesFeed";
import { SourceFreshnessPanel } from "./SourceFreshnessPanel";
import { SourceProvenance } from "./SourceProvenance";
import { StackPulseCard } from "./StackPulseCard";
import Link from "next/link";

interface RadarDashboardProps {
  data: RadarDashboardData;
  loading?: boolean;
}

export function RadarDashboard({ data, loading = false }: RadarDashboardProps) {
  const latest = data.changes[0];

  return (
    <div className="radar-dashboard">
      <div className="radar-dashboard-intro">
        <h1 className="radar-page-title">Intelligence Console</h1>
        <p className="radar-page-description">
          Command center for StackPulse and SourcePulse: live catalog, changes,
          stack decisions, and collection integrity.
          {data.isMock && (
            <span className="radar-mock-notice">
              {" "}Displaying fixture data — not connected to live collectors.
            </span>
          )}
        </p>
      </div>

      <DecisionActions />

      {data.unavailableReason ? (
        <EvidenceState
          tone="unavailable"
          title="Live dashboard data is not available"
          description={data.unavailableReason}
        />
      ) : (
        <>
          <div className="radar-command-hero radar-stagger">
            <RadarPulse
              pricedModels={data.ecosystem.pricedModels}
              modelIdentities={data.ecosystem.modelIdentities}
              status={data.ecosystem.status}
            />
            <div className="flex min-w-0 flex-col gap-3">
              <EcosystemStatus
                data={data.ecosystem}
                sentinel={data.sentinel}
                loading={loading}
              />
              {latest && (
                <p className="radar-ticker">
                  <span className="radar-ticker-label">Latest change</span>
                  <span className="radar-ticker-copy">
                    {latest.provider}
                    {latest.model ? ` · ${latest.model}` : ""} — {latest.summary}
                  </span>
                  <Link href="/changes" className="radar-inline-link shrink-0">
                    Feed
                  </Link>
                </p>
              )}
            </div>
          </div>

          <div className="radar-dashboard-grid">
            <div className="radar-dashboard-primary">
              <RecentChangesFeed changes={data.changes} loading={loading} maxItems={5} />
            </div>
            <div className="radar-dashboard-secondary space-y-3">
              <StackPulseCard changes={data.changes} />
              <ProviderHealthOverview providers={data.providers} loading={loading} />
              <SourceFreshnessPanel sources={data.sources} loading={loading} />
              <SourceProvenance
                records={data.provenance}
                loading={loading}
                isDemo={data.isMock}
              />
            </div>
          </div>

          <details className="radar-panel">
            <summary className="radar-panel-header cursor-pointer">
              <div>
                <h2 className="radar-panel-title">Model pricing matrix</h2>
                <p className="radar-panel-subtitle">Expand for per-million-token rates</p>
              </div>
            </summary>
            <div className="radar-panel-body">
              <PricingMatrix models={data.models} loading={loading} />
            </div>
          </details>
        </>
      )}
    </div>
  );
}
