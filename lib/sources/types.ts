/**
 * Source Detail & Provenance read model contracts.
 *
 * Everything in this file is a *public* projection: it is what the product UI
 * and the public read API are allowed to see. Operational detail — raw
 * quarantine payloads, per-record validation traces, collector credentials,
 * healing prompts — is deliberately absent from these shapes so it cannot leak
 * by accident when a new field is added upstream.
 */

import type {
  RunStatus,
  SentinelIncidentStatus,
  SentinelReasonCode,
  SentinelStatus,
  SourceKind,
} from "../supabase/types";

/** Domain-level classification of what a source is an authority on. */
export type SourceCategory = "pricing" | "lifecycle" | "models" | "other";

/** Mirrors the Sentinel contract vocabulary, which the catalog wave widened. */
export type AuthorityDomain =
  | "pricing"
  | "lifecycle"
  | "models"
  | "catalog"
  | "capabilities";

/** Freshness verdict relative to the contracted staleness budget. */
export type SourceFreshnessStatus = "fresh" | "aging" | "stale" | "unknown";

/** High-level validation verdict for one run, derived from run counters. */
export type RunValidationStatus = "passed" | "partial" | "failed" | "pending";

export interface SourceIdentity {
  sourceId: string;
  providerId: string;
  providerSlug: string;
  providerName: string;
  /** Human-readable source name; falls back to a derived provider + kind label. */
  name: string;
  kind: SourceKind;
  category: SourceCategory;
  /** Sanitized canonical URL: http(s) only, no credentials, no query string. */
  sourceUrl: string | null;
  /** Bright Data collector identity. Never a credential. */
  collectorId: string | null;
  enabled: boolean;
}

export interface SourceFreshness {
  status: SourceFreshnessStatus;
  /** Minutes since the last *successful* collection, when one exists. */
  ageMinutes: number | null;
  /** Contracted staleness budget in minutes, when a contract is known. */
  maxStalenessMinutes: number | null;
  /** Instant after which the source is considered stale. */
  staleAfter: string | null;
}

export interface SourceActiveIncidentSummary {
  incidentId: string;
  status: SentinelIncidentStatus;
  severity: "info" | "warning" | "critical";
  reasonCodes: SentinelReasonCode[];
  healingAttemptCount: number;
  openedAt: string | null;
}

export interface SourceHealthView {
  /** Current Sentinel state for the source. */
  status: SentinelStatus;
  freshness: SourceFreshness;
  lastAttemptedRunAt: string | null;
  lastAttemptedRunId: string | null;
  lastAttemptedRunStatus: RunStatus | null;
  lastSuccessfulRunAt: string | null;
  lastSuccessfulRunId: string | null;
  lastKnownGoodRunId: string | null;
  lastKnownGoodAt: string | null;
  lastKnownGoodCount: number | null;
  currentRecordCount: number | null;
  expectedRecordCount: number | null;
  activeIncident: SourceActiveIncidentSummary | null;
}

export interface SourceContractView {
  category: SourceCategory;
  authorityDomain: AuthorityDomain;
  isAuthoritative: boolean;
  /** Semantic fields every accepted record must carry. */
  requiredFields: string[];
  /** Allowed value domains for enum-like fields. */
  expectedEnumDomains: Record<string, string[]>;
  minViableRecords: number;
  recordCountDrift: {
    minExpectedCount: number | null;
    maxDropPercentage: number | null;
    maxSpikePercentage: number | null;
  };
  freshness: { maxStalenessMinutes: number | null };
  failurePolicy: {
    maxHealingAttempts: number;
    autoHeal: boolean;
    quarantineThresholdPercentage: number;
  };
}

export interface SourceRunView {
  runId: string;
  /** Bright Data run identity, for cross-referencing a collector execution. */
  externalRunId: string | null;
  status: RunStatus;
  validationStatus: RunValidationStatus;
  triggeredBy: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  recordsSeen: number;
  recordsAccepted: number;
  recordsRejected: number;
  /** Sanitized, truncated failure reason. Never a raw collector trace. */
  failureReason: string | null;
}

export interface SourceIncidentView {
  incidentId: string;
  runId: string | null;
  status: SentinelIncidentStatus;
  severity: "info" | "warning" | "critical";
  reasonCodes: SentinelReasonCode[];
  /** Sanitized incident summary. */
  summary: string | null;
  recordsSeen: number;
  recordsValid: number;
  recordsInvalid: number;
  expectedCount: number | null;
  lastKnownGoodCount: number | null;
  lastKnownGoodRunId: string | null;
  lastKnownGoodAt: string | null;
  healingAttemptCount: number;
  quarantined: boolean;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface SourceHealingAttemptView {
  attemptId: string;
  incidentId: string;
  attemptNumber: number;
  collectorId: string | null;
  status: string;
  refactorJobId: string | null;
  candidateRecordsCount: number | null;
  candidatePassedValidation: boolean | null;
  /** Derived outcome: what this attempt means for the source. */
  outcome: "in_progress" | "recovered" | "rejected" | "needs_review" | "failed";
  startedAt: string;
  completedAt: string | null;
}

export interface SourceObservationView {
  snapshotId: string;
  runId: string;
  modelId: string;
  modelName: string | null;
  observedAt: string;
  /** Canonical values this source contributed, already normalized. */
  values: Record<string, string | number | boolean | null>;
}

export interface TransformationFieldView {
  /** Raw key observed in the collector payload, when one could be matched. */
  rawField: string | null;
  /** Sanitized, truncated raw value. */
  rawValue: string | null;
  normalizedField: string;
  normalizedValue: string | number | boolean | null;
  /** How the canonical value was produced from the observation. */
  derivation: "mapped" | "derived";
}

export interface SourceTransformationView {
  snapshotId: string;
  runId: string;
  observedAt: string;
  modelId: string;
  modelName: string | null;
  fields: TransformationFieldView[];
}

export interface SourceSummary {
  identity: SourceIdentity;
  health: SourceHealthView;
  contract: SourceContractView | null;
}

export interface SourceDetail extends SourceSummary {
  generatedAt: string;
  runs: SourceRunView[];
  incidents: SourceIncidentView[];
  healing: SourceHealingAttemptView[];
  /** Accepted observations currently attributed to this source. */
  observations: SourceObservationView[];
  /** Historical values this source has published, newest first. */
  history: SourceObservationView[];
  /** Worked example of raw collector output becoming a canonical value. */
  transformation: SourceTransformationView | null;
  counts: {
    runs: number;
    incidents: number;
    healingAttempts: number;
    observations: number;
  };
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export type ProvenanceKind =
  | "pricing_snapshot"
  | "lifecycle_snapshot"
  | "change_event";

export interface ProvenanceReference {
  kind: ProvenanceKind;
  id: string;
}

/** Whether the evidence behind a value passed the Sentinel gate. */
export type ProvenanceValidationState =
  | "validated"
  | "provisional"
  | "quarantined"
  | "unknown";

export interface ProvenanceRecord {
  reference: ProvenanceReference;
  provider: { id: string; slug: string; name: string };
  /** Null only for a change event whose source row has since been removed. */
  source: {
    id: string;
    name: string;
    url: string | null;
    kind: SourceKind;
    category: SourceCategory;
    collectorId: string | null;
    enabled: boolean;
  } | null;
  observedAt: string;
  run: {
    runId: string | null;
    externalRunId: string | null;
    status: RunStatus | null;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
  /** Snapshot the value was read from; null for events with no snapshot link. */
  snapshotId: string | null;
  trust: {
    validationState: ProvenanceValidationState;
    sentinelStatus: SentinelStatus | null;
    authorityDomain: AuthorityDomain | null;
    isAuthoritative: boolean;
  };
  /** Populated for change events: which snapshots the diff was taken between. */
  transition: {
    previousSnapshotId: string | null;
    currentSnapshotId: string | null;
  } | null;
}
