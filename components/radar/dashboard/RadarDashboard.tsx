import type { RadarDashboardData } from "../types";
import { EcosystemStatus } from "./EcosystemStatus";
import { PricingMatrix } from "./PricingMatrix";
import { ProviderHealthOverview } from "./ProviderHealthOverview";
import { RecentChangesFeed } from "./RecentChangesFeed";
import { SourceFreshnessPanel } from "./SourceFreshnessPanel";
import { SourceProvenance } from "./SourceProvenance";

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
          Live ecosystem signals for AI model pricing, launches, and source health.
          {data.isMock && (
            <span className="radar-mock-notice">
              {" "}Displaying fixture data — not connected to live collectors.
            </span>
          )}
        </p>
      </div>

      <EcosystemStatus data={data.ecosystem} loading={loading} />

      <div className="radar-dashboard-grid">
        <div className="radar-dashboard-primary">
          <RecentChangesFeed changes={data.changes} loading={loading} />
        </div>
        <div className="radar-dashboard-secondary space-y-4">
          <ProviderHealthOverview providers={data.providers} loading={loading} />
          <SourceFreshnessPanel sources={data.sources} loading={loading} />
          <SourceProvenance records={data.provenance} loading={loading} />
        </div>
      </div>

      <PricingMatrix models={data.models} loading={loading} />
    </div>
  );
}
