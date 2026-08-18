import { EmptyState, ErrorState } from "../ui/DataState";
import { Panel } from "../ui/Panel";
import { IncidentSpotlight } from "./IncidentSpotlight";
import { SentinelSummaryHeader } from "./SentinelSummaryHeader";
import { SourceHealthCard } from "./SourceHealthCard";
import type { SentinelView } from "./types";
import { sortSentinelSources } from "./utils";

function SkeletonGrid() {
  return (
    <div className="radar-sentinel" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading source health…</span>
      <div className="radar-sentinel-hero">
        <div className="radar-verdict animate-pulse">
          <div className="h-2.5 w-24 rounded bg-radar-surface-raised" />
          <div className="h-7 w-4/5 rounded bg-radar-surface-raised" />
          <div className="h-1.5 w-full rounded-full bg-radar-surface-raised" />
        </div>
        <div className="radar-sentinel-stats">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="radar-stat-card animate-pulse">
              <div className="mb-2 h-3 w-20 rounded bg-radar-surface-raised" />
              <div className="h-6 w-12 rounded bg-radar-surface-raised" />
            </div>
          ))}
        </div>
      </div>
      <div className="radar-sentinel-grid">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="radar-source-card animate-pulse">
            <div className="radar-source-card-header">
              <div className="h-4 w-40 rounded bg-radar-surface-raised" />
              <div className="h-4 w-16 rounded bg-radar-surface-raised" />
            </div>
            <div className="radar-source-card-body">
              <div className="radar-metric-row">
                {Array.from({ length: 3 }).map((_, metric) => (
                  <div key={metric} className="radar-metric">
                    <div className="h-2 w-10 rounded bg-radar-surface-raised" />
                    <div className="mt-2 h-3 w-12 rounded bg-radar-surface-raised" />
                  </div>
                ))}
              </div>
              <div className="h-16 w-full rounded bg-radar-surface-raised" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface SourceHealthDashboardProps {
  view: SentinelView | null;
  loading?: boolean;
  /** Message from the Sentinel read path when it failed entirely. */
  error?: string | null;
}

export function SourceHealthDashboard({
  view,
  loading = false,
  error = null,
}: SourceHealthDashboardProps) {
  const sources = view ? sortSentinelSources(view.sources) : [];
  const spotlight =
    sources.find((source) => source.sourceId === view?.spotlightSourceId) ?? null;
  const rest = spotlight
    ? sources.filter((source) => source.sourceId !== spotlight.sourceId)
    : sources;

  return (
    <div className="radar-sentinel">
      <div className="radar-dashboard-intro">
        <h1 className="radar-page-title">Source Health · Sentinel</h1>
        <p className="radar-page-description">
          Every collection run is validated before it reaches the read model.
          This page shows what each source is serving right now, what Sentinel
          rejected, and how a broken source got back to a trusted state.
          {view?.isDemo && (
            <span className="radar-mock-notice">
              {" "}
              Demo simulation
              {view.demoScenario ? ` — ${view.demoScenario}` : ""}. Deterministic
              in-memory scenario, not live collector telemetry.
            </span>
          )}
        </p>
      </div>

      {error ? (
        <ErrorState title="Source health unavailable" description={error} />
      ) : loading || !view ? (
        <SkeletonGrid />
      ) : sources.length === 0 ? (
        <Panel
          id="sources"
          title="Monitored sources"
          subtitle="Nothing registered yet"
        >
          <EmptyState
            title="No sources are being monitored"
            description="Source health appears once a collector registers a source and Sentinel evaluates its first run."
          />
        </Panel>
      ) : (
        <>
          <SentinelSummaryHeader summary={view.summary} />

          {spotlight && <IncidentSpotlight source={spotlight} />}

          {/* Omitted when the spotlight is the whole fleet, rather than
              rendering a panel with nothing in it. */}
          {rest.length > 0 && (
            <Panel
              id="sources"
              title="Monitored sources"
              subtitle={`${view.summary.totalSources} source${view.summary.totalSources === 1 ? "" : "s"} across ${view.summary.providers} provider${view.summary.providers === 1 ? "" : "s"}`}
            >
              <div className="radar-sentinel-grid">
                {rest.map((source) => (
                  <SourceHealthCard key={source.sourceId} source={source} />
                ))}
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
