/** UI-facing types for the AI Radar dashboard. Replace fixture imports with API contracts at integration. */

export type HealthStatus = "healthy" | "degraded" | "down" | "unknown";

export type ChangeType =
  | "price_change"
  | "model_launch"
  | "model_removal"
  | "deprecation"
  | "source_refresh"
  | "schema_update"
  | "capability_change";


export type PricingTier = "short" | "long";

export interface PricingRate {
  tier: string;
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cachedInputPerMillion?: number | null;
}

export interface ModelPricing {
  id: string;
  provider: string;
  name: string;
  slug: string;
  status: "active" | "legacy" | "deprecated" | "retired" | "preview";
  rates: PricingRate[];
  contextWindow: number | null;
  lastVerifiedAt: string;
}

export interface ChangeEvent {
  id: string;
  type: ChangeType;
  provider: string;
  model?: string;
  summary: string;
  detail?: string;
  detectedAt: string;
  sourceId: string;
  severity: "info" | "warning" | "critical";
}

export interface ProviderHealth {
  id: string;
  name: string;
  status: HealthStatus;
  modelsTracked: number;
  lastCollectionAt: string | null;
  collectorId: string;
  errorRate24h: number | null;
  latencyP95Ms: number | null;
  notes?: string;
}

export interface SourceFreshness {
  id: string;
  label: string;
  provider: string;
  collectorType: string;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  status: HealthStatus;
  stalenessMinutes: number | null;
  expectedIntervalMinutes: number | null;
}

export interface ProvenanceRecord {
  sourceId: string;
  label: string;
  url: string;
  collector: string;
  datasetVersion: string;
  scrapedAt: string | null;
}

export interface EcosystemSummary {
  status: HealthStatus;
  modelsTracked: number;
  providersTracked: number;
  changesLast24h: number;
  priceChangesLast7d: number;
  activeAlerts: number;
  lastGlobalRefreshAt: string;
}

export interface RadarDashboardData {
  /** True only when the explicit development/demo fixture is displayed. */
  isMock: boolean;
  fixtureVersion: string;
  ecosystem: EcosystemSummary;
  changes: ChangeEvent[];
  models: ModelPricing[];
  providers: ProviderHealth[];
  sources: SourceFreshness[];
  provenance: ProvenanceRecord[];
}

export type DataState = "loaded" | "loading" | "empty" | "error";
