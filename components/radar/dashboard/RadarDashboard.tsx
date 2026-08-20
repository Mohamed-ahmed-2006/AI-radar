import type { RadarDashboardData } from "../types";
import { EvidenceState } from "../ui/DataState";
import { DecisionActions } from "./DecisionActions";
import { EcosystemStatus } from "./EcosystemStatus";
import { PricingMatrix } from "./PricingMatrix";
import { ProviderHealthOverview } from "./ProviderHealthOverview";
import { RecentChangesFeed } from "./RecentChangesFeed";
import { SourceFreshnessPanel } from "./SourceFreshnessPanel";
import { SourceProvenance } from "./SourceProvenance";
import { StackPulseCard } from "./StackPulseCard";

interface RadarDashboardProps {
  data: RadarDashboardData;
  loading?: boolean;
}

export function RadarDashboard({ data, loading = false }: RadarDashboardProps) {
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
          <EcosystemStatus
            data={data.ecosystem}
            sentinel={data.sentinel}
            loading={loading}
          />

          <div className="radar-dashboard-grid">
            <div className="radar-dashboard-primary">
              <RecentChangesFeed changes={data.changes} loading={loading} />
            </div>
            <div className="radar-dashboard-secondary space-y-4">
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

          <PricingMatrix models={data.models} loading={loading} />
        </>
      )}
    </div>
  );
}
