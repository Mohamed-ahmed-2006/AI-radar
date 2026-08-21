/**
 * Read-model vocabulary for Model Explorer, Model Detail and Model Compare.
 *
 * Three rules shape every type in this file.
 *
 *   * Unknown is never false. Capability booleans are three-state, numeric
 *     evidence is nullable, and a missing observation is null — never a zero,
 *     never a false, never an empty string standing in for a fact.
 *   * Catalog absence is not lifecycle evidence. Lifecycle lives in its own
 *     block, projected from the canonical model row, and no capability or
 *     pricing gap can influence it.
 *   * Every trusted value carries provenance for its evidence domain, so a
 *     reader can always ask who said this, and when.
 */

import type { ProvenanceView } from "../product/provenance";
import type { LifecycleState, RetirementNotBeforeObservation } from "../supabase/types";

/** The three evidence domains a canonical model can carry. */
export type EvidenceDomain = "pricing" | "capability" | "lifecycle";

export interface ModelProviderIdentity {
  providerId: string;
  slug: string;
  name: string;
}

/** One published price point: a (pricing mode, context tier) pair. */
export interface ModelPricingTier {
  pricingMode: string;
  contextTier: string;
  inputPricePer1MTokens: number | null;
  cachedInputPricePer1MTokens: number | null;
  cacheWritePricePer1MTokens: number | null;
  outputPricePer1MTokens: number | null;
  currency: string | null;
  /** Provider-published unit, for example "1M tokens". */
  unit: string | null;
  observedAt: string | null;
  snapshotId: string;
}

export interface ModelPricingEvidence {
  /**
   * The tier the explorer filters and compares on. Chosen deterministically by
   * `selectPrimaryPricingTier`, never by price, so two reads of the same rows
   * always agree.
   */
  primary: ModelPricingTier | null;
  /** Every current tier: the newest observation per (mode, tier). */
  tiers: ModelPricingTier[];
  observedAt: string | null;
  provenance: ProvenanceView | null;
}

export interface ModelCapabilityEvidence {
  apiModelId: string | null;
  displayName: string | null;
  family: string | null;
  stage: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  /** null = unobserved. Never coerced to false. */
  supportsVision: boolean | null;
  /** null = unobserved. Never coerced to false. */
  supportsToolCalling: boolean | null;
  inputModalities: string[];
  outputModalities: string[];
  supportedFeatures: string[];
  /**
   * The source's own sentence enumerating which modalities the model supports,
   * verbatim, when it published one.
   *
   * Its presence is what closes the modality lists above. Without it a modality
   * missing from `inputModalities` is merely unobserved; with it, the source has
   * said what the supported set is, and a modality outside that set is
   * unsupported according to this quotable statement.
   */
  modalityStatement: string | null;
  /**
   * True when several API model ids currently claim this canonical model while
   * publishing different capability evidence. The evidence is then withheld in
   * full rather than resolved by arrival order.
   */
  conflicted: boolean;
  observedAt: string | null;
  provenance: ProvenanceView | null;
}

export interface ModelLifecycleEvidence {
  state: LifecycleState | null;
  deprecationDate: string | null;
  retirementDate: string | null;
  retirementNotBeforeDate: string | null;
  retirementNotBeforeObservation: RetirementNotBeforeObservation | null;
  /** Provider-native replacement identifier, exactly as published. */
  recommendedReplacement: string | null;
  /** Set only when the replacement resolved to a canonical model safely. */
  recommendedReplacementModelId: string | null;
  /** True only when the model is observed to be deprecated or retired. */
  endOfLife: boolean;
  observedAt: string | null;
  provenance: ProvenanceView | null;
}

export interface ModelFreshness {
  /** Newest observation across every evidence domain. */
  lastVerifiedAt: string | null;
  ageMinutes: number | null;
  byDomain: Record<EvidenceDomain, string | null>;
}

/** One canonical model as the explorer grid reads it. */
export interface ModelExplorerEntry {
  canonicalModelId: string;
  /** Canonical model name. Identity is the id; this is for display only. */
  modelName: string;
  displayName: string | null;
  apiModelId: string | null;
  provider: ModelProviderIdentity;
  family: string | null;
  stage: string | null;
  pricing: ModelPricingEvidence;
  capabilities: ModelCapabilityEvidence;
  lifecycle: ModelLifecycleEvidence;
  freshness: ModelFreshness;
  /** Which domains carry trusted evidence right now. */
  evidenceDomains: EvidenceDomain[];
  provenance: Record<EvidenceDomain, ProvenanceView | null>;
}

export interface ModelExplorerFilters {
  /** Provider slugs. Absent or empty means every provider. */
  providers?: readonly string[];
  /** Inclusive ceiling. A model with no observed input price never matches. */
  maxInputPrice?: number;
  /** Inclusive ceiling. A model with no observed output price never matches. */
  maxOutputPrice?: number;
  /** Inclusive floor. An unobserved context window never matches. */
  minContextWindow?: number;
  /** Inclusive floor. Unobserved max output tokens never matches. */
  minMaxOutputTokens?: number;
  /** true keeps only supportsVision === true. false imposes no constraint. */
  visionRequired?: boolean;
  /** true keeps only supportsToolCalling === true. false imposes no constraint. */
  toolCallingRequired?: boolean;
  /** Drops models observed to be deprecated or retired. */
  activeOnly?: boolean;
  /** Exact lifecycle states. An unobserved state never matches. */
  lifecycleStates?: readonly LifecycleState[];
  families?: readonly string[];
  stages?: readonly string[];
  inputModalities?: readonly string[];
  outputModalities?: readonly string[];
  /** Case-insensitive substring over canonical name, display name, API id. */
  search?: string;
}

export type ModelExplorerSort =
  | "provider"
  | "input_price"
  | "output_price"
  | "context_window"
  | "last_verified";

export interface ModelExplorerFacets {
  providers: Array<{ slug: string; name: string; count: number }>;
  lifecycleStates: Array<{ state: LifecycleState; count: number }>;
  families: Array<{ family: string; count: number }>;
  stages: Array<{ stage: string; count: number }>;
}

export interface ModelExplorerResult {
  entries: ModelExplorerEntry[];
  /** Entries before filtering, so the grid can report "n of m". */
  totalCount: number;
  filteredCount: number;
  /** Facets are computed over the unfiltered set, so the UI can offer them. */
  facets: ModelExplorerFacets;
  generatedAt: string;
}

export interface ModelPricingHistoryEntry {
  snapshotId: string;
  pricingMode: string;
  contextTier: string;
  inputPricePer1MTokens: number | null;
  cachedInputPricePer1MTokens: number | null;
  cacheWritePricePer1MTokens: number | null;
  outputPricePer1MTokens: number | null;
  currency: string | null;
  unit: string | null;
  observedAt: string;
  provenance: ProvenanceView;
}

export interface ModelCapabilityHistoryEntry {
  snapshotId: string;
  apiModelId: string;
  displayName: string | null;
  family: string | null;
  stage: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsVision: boolean | null;
  supportsToolCalling: boolean | null;
  inputModalities: string[];
  outputModalities: string[];
  supportedFeatures: string[];
  observedAt: string;
  provenance: ProvenanceView;
}

export interface ModelLifecycleHistoryEntry {
  snapshotId: string;
  apiModelId: string;
  state: LifecycleState | null;
  deprecationDate: string | null;
  retirementDate: string | null;
  retirementNotBeforeDate: string | null;
  retirementNotBeforeObservation: RetirementNotBeforeObservation;
  recommendedReplacement: string | null;
  recommendedReplacementModelId: string | null;
  observedAt: string;
  provenance: ProvenanceView;
}

export interface ModelChangeEntry {
  eventId: string;
  changeType: string;
  domain: EvidenceDomain | "other";
  fieldName: string | null;
  pricingMode: string | null;
  contextTier: string | null;
  oldValue: unknown;
  newValue: unknown;
  summary: string | null;
  detectedAt: string;
  provenance: ProvenanceView;
}

export interface ModelDetail {
  /** Current trusted evidence: the same projection the grid renders. */
  current: ModelExplorerEntry;
  pricingHistory: ModelPricingHistoryEntry[];
  capabilityHistory: ModelCapabilityHistoryEntry[];
  lifecycleHistory: ModelLifecycleHistoryEntry[];
  recentChanges: ModelChangeEntry[];
  /** Known API model ids for this canonical model, from the alias table. */
  apiModelIds: string[];
  generatedAt: string;
}

export type ComparisonFieldKind =
  | "price"
  | "tokens"
  | "boolean"
  | "list"
  | "date"
  | "text";

export interface ComparisonCell {
  canonicalModelId: string;
  value: string | number | boolean | string[] | null;
  /** False whenever the underlying evidence is unobserved or withheld. */
  known: boolean;
  provenance: ProvenanceView | null;
}

export interface ComparisonRow {
  field: string;
  label: string;
  kind: ComparisonFieldKind;
  domain: EvidenceDomain;
  cells: ComparisonCell[];
}

export interface ModelComparison {
  /** Requested order preserved; duplicate ids collapsed. */
  models: ModelExplorerEntry[];
  rows: ComparisonRow[];
  /** Requested ids that resolve to no canonical model. */
  unresolvedIds: string[];
  generatedAt: string;
}
