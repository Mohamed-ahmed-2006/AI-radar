/** UI-facing types for the AI Radar dashboard. Replace fixture imports with API contracts at integration. */

export type HealthStatus = "healthy" | "degraded" | "down" | "unknown";

export type ChangeType =
  | "price_change"
  | "model_launch"
  | "model_removal"
  | "deprecation"
  | "source_refresh"
  | "schema_update";

export type PricingTier = "short" | "long";

export interface PricingRate {
  tier: PricingTier;
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion?: number;
}

export interface ModelPricing {
  id: string;
  provider: string;
  name: string;
  slug: string;
  status: "active" | "deprecated" | "preview";
  rates: PricingRate[];
  contextWindow: number;
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
  errorRate24h: number;
  latencyP95Ms: number;
  notes?: string;
}

export interface SourceFreshness {
  id: string;
  label: string;
  provider: string;
  collectorType: string;
  lastSuccessAt: string | null;
  lastAttemptAt: string;
  status: HealthStatus;
  stalenessMinutes: number;
  expectedIntervalMinutes: number;
}

export interface ProvenanceRecord {
  sourceId: string;
  label: string;
  url: string;
  collector: string;
  datasetVersion: string;
  scrapedAt: string;
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
  /** Always true for fixture data — remove when wired to live API */
  isMock: true;
  fixtureVersion: string;
  ecosystem: EcosystemSummary;
  changes: ChangeEvent[];
  models: ModelPricing[];
  providers: ProviderHealth[];
  sources: SourceFreshness[];
  provenance: ProvenanceRecord[];
}

export type DataState = "loaded" | "loading" | "empty" | "error";
