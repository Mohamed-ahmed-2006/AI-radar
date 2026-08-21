/** UI-facing types for the AI Radar dashboard. Replace fixture imports with API contracts at integration. */

import type { AuthorityLevel } from "../../lib/intelligence/contracts";

export type HealthStatus = "healthy" | "operational" | "degraded" | "down" | "unknown";

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
  /** Canonical `provider:apiModelId` when the catalog observed it; never guessed. */
  modelCanonicalId?: string | null;
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
  /**
   * Models from this provider that currently carry a canonical price. Not the
   * provider's whole catalog — see `EcosystemSummary` for the two counts and
   * why they differ.
   */
  pricedModels: number;
  /** Sources registered for this provider in the collection fleet. */
  sourcesMonitored: number;
  /** Records accepted by this provider's most recent runs. */
  acceptedRecords: number | null;
  lastCollectionAt: string | null;
  collectorId: string;
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
  /**
   * What the source is an authority on, as its registered Sentinel contract
   * declares it. Null when no contract governs the source, which the trust
   * vocabulary renders as Unverified rather than guessing.
   */
  authority: AuthorityLevel | null;
}

export interface EcosystemSummary {
  status: HealthStatus;
  /** Fleet remainder for the overall status only, e.g. "9/10 sources healthy". */
  statusHint?: string;
  /**
   * Distinct provider+model pairs that currently carry a canonical price.
   *
   * This is deliberately NOT the number of models AI Radar knows about. A
   * model observed on a catalog or lifecycle page but not yet on a pricing
   * page is a tracked identity with no canonical price, so it is counted by
   * `modelIdentities` and not here. The Model Explorer lists identities, which
   * is why its total is the larger of the two.
   */
  pricedModels: number;
  /** Every canonical model identity on record, priced or not. */
  modelIdentities: number;
  providersTracked: number;
  sourcesMonitored: number;
  changesLast24h: number;
  priceChangesLast7d: number;
  lifecycleChangesLast7d: number;
  activeAlerts: number;
  lastGlobalRefreshAt: string;
}

/**
 * Sentinel fleet counts for the dashboard. Null counts mean the read failed
 * or was never attempted — they must not render as zero.
 */
export interface SentinelFleetSnapshot {
  available: boolean;
  unavailableReason: string | null;
  isDemo: boolean;
  totalSources: number | null;
  healthy: number | null;
  degraded: number | null;
  quarantined: number | null;
  recovered: number | null;
  healing: number | null;
  needsReview: number | null;
}

export interface RadarDashboardData {
  /** True only when the explicit development/demo fixture is displayed. */
  isMock: boolean;
  fixtureVersion: string;
  /**
   * When set, live dashboard reads failed or were never configured.
   * The UI must show this reason rather than substituting fixture catalog data.
   */
  unavailableReason?: string | null;
  ecosystem: EcosystemSummary;
  sentinel: SentinelFleetSnapshot;
  changes: ChangeEvent[];
  models: ModelPricing[];
  providers: ProviderHealth[];
  sources: SourceFreshness[];
  provenance: ProvenanceRecord[];
}

export type DataState = "loaded" | "loading" | "empty" | "error";
