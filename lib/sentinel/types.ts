/**
 * Sentinel Autonomous Health, Quarantine & Self-Healing Types
 */

import type { Json } from "../supabase/types";

export type SentinelStatus =
  | "healthy"
  | "degraded"
  | "quarantined"
  | "healing"
  | "recovered"
  | "needs_review";

export type SentinelIncidentStatus =
  | "open"
  | "healing"
  | "resolved"
  | "dismissed"
  | "needs_review";

export type SentinelReasonCode =
  | "SCHEMA_VALIDATION_FAILURE"
  | "RECORD_COUNT_COLLAPSE"
  | "RECORD_COUNT_SPIKE"
  | "ZERO_RECORDS"
  | "DUPLICATE_IDENTIFIERS"
  | "ILLEGAL_ENUM_VALUE"
  | "ALL_PRICES_NULL"
  | "SEMANTIC_INVARIANT_VIOLATION"
  | "STALE_SOURCE"
  | "COLLECTOR_EXECUTION_FAILURE";

export type SentinelSeverity = "info" | "warning" | "critical";

export type SourceCategory = "pricing" | "lifecycle" | "models" | "catalog" | "other";

export type AuthorityDomain = "pricing" | "lifecycle" | "models" | "catalog" | "capabilities";


export interface RecordCountDriftConfig {
  /** Minimum expected record count before collapse alert */
  minExpectedCount?: number;
  /** Maximum acceptable drop ratio, e.g. 0.35 means > 35% drop triggers collapse */
  maxDropPercentage?: number;
  /** Maximum acceptable spike ratio, e.g. 3.0 means > 300% growth triggers spike */
  maxSpikePercentage?: number;
}

export interface SourceFreshnessExpectations {
  /** Maximum allowable minutes since last successful run before stale warning */
  maxStalenessMinutes?: number;
}

export interface FailurePolicy {
  /** Maximum autonomous healing retries before marking needs_review */
  maxHealingAttempts: number;
  /** Whether auto-healing via Scraper Studio is enabled */
  autoHeal: boolean;
  /**
   * Invalid record ratio threshold above which the whole run is quarantined.
   * e.g. 0.10 = if > 10% records are invalid, quarantine candidate.
   * For strict sources, use 0.0 (any failure quarantines).
   */
  quarantineThresholdPercentage: number;
}

export interface SemanticInvariantCheckResult {
  passed: boolean;
  code: SentinelReasonCode;
  reason: string;
}

export interface SourceHealthContract<T = unknown> {
  sourceId: string;
  sourceCategory: SourceCategory;
  authorityDomain: AuthorityDomain;
  isAuthoritative: boolean;
  requiredFields: string[];
  expectedEnumDomains?: Record<string, readonly string[]>;
  minViableRecords: number;
  recordCountDrift: RecordCountDriftConfig;
  sourceFreshness: SourceFreshnessExpectations;
  failurePolicy: FailurePolicy;
  /** Deterministically extract a unique identity key for one record */
  extractKey: (record: T) => string;
  /** Validate and parse a raw record */
  validateRecord: (
    raw: unknown,
    index: number,
  ) => { success: boolean; data?: T; issues?: string[] };
  /** Domain-specific invariant checks on the valid batch */
  validateSemanticInvariants?: (
    records: readonly T[],
  ) => SemanticInvariantCheckResult[];
}

export interface LastKnownGoodBaseline {
  runId: string | null;
  recordCount: number;
  observedAt: string;
  externalRunId?: string | null;
}

export interface SentinelEvaluationIssue {
  recordIndex?: number;
  field?: string;
  message: string;
  code?: SentinelReasonCode;
}

export interface SentinelEvaluationResult<T = unknown> {
  status: SentinelStatus;
  isHealthy: boolean;
  shouldQuarantine: boolean;
  reasonCodes: SentinelReasonCode[];
  summary: string;
  recordsSeen: number;
  recordsValid: number;
  recordsInvalid: number;
  validRecords: T[];
  invalidRecords: { raw: unknown; issues: string[] }[];
  issues: SentinelEvaluationIssue[];
  driftInfo?: {
    previousCount: number;
    currentCount: number;
    changePercentage: number;
    driftType: "collapse" | "spike" | "within_tolerance";
  };
}

export interface SentinelIncident {
  id: string;
  sourceId: string;
  providerId: string;
  runId: string | null;
  status: SentinelIncidentStatus;
  severity: SentinelSeverity;
  reasonCodes: SentinelReasonCode[];
  summary: string | null;
  recordsSeen: number;
  recordsValid: number;
  recordsInvalid: number;
  expectedCount: number | null;
  lastKnownGoodCount: number | null;
  lastKnownGoodRunId: string | null;
  lastKnownGoodAt: string | null;
  healingAttemptCount: number;
  resolutionNote?: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
}

export interface SentinelHealingAttempt {
  id: string;
  incidentId: string;
  sourceId: string;
  collectorId: string | null;
  attemptNumber: number;
  prompt: string;
  status:
    | "initiated"
    | "in_progress"
    | "awaiting_approval"
    | "candidate_validated"
    | "candidate_rejected"
    | "approved"
    | "rejected"
    | "failed"
    | "timed_out";
  refactorJobId: string | null;
  candidateRecordsCount: number | null;
  candidatePassedValidation: boolean | null;
  validationDetails: Json | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}

export interface SentinelHealingProgress {
  attemptNumber: number;
  status: string;
  step?: string;
  message?: string;
  refactorJobId?: string;
}

export interface SentinelHealingExecutionOptions {
  collectorId: string;
  prompt: string;
  sourceUrl?: string;
  timeoutSeconds?: number;
  onProgress?: (progress: SentinelHealingProgress) => void;
}

export interface SentinelHealingExecutionResult<TOutput = unknown> {
  success: boolean;
  status: "approved" | "rejected" | "failed" | "timed_out" | "needs_approval";
  jobId?: string;
  candidateData?: TOutput[];
  candidateRaw?: unknown[];
  error?: string;
  diffSummary?: string;
  viewUrl?: string;
}

export interface SentinelDashboardReadModel {
  sources: {
    sourceId: string;
    providerId: string;
    providerName: string;
    providerSlug: string;
    kind: string;
    collectorId: string | null;
    sourceUrl: string;
    label: string | null;
    status: SentinelStatus;
    lastRunId: string | null;
    lastRunStatus: string | null;
    lastRunAt: string | null;
    currentRecordCount: number;
    lastKnownGoodCount: number | null;
    lastKnownGoodAt: string | null;
    activeIncident: {
      id: string;
      status: SentinelIncidentStatus;
      severity: SentinelSeverity;
      reasonCodes: SentinelReasonCode[];
      healingAttemptCount: number;
      createdAt: string;
    } | null;
    stalenessMinutes: number | null;
  }[];
  activeIncidents: {
    id: string;
    sourceId: string;
    providerName: string;
    status: SentinelIncidentStatus;
    severity: SentinelSeverity;
    reasonCodes: SentinelReasonCode[];
    summary: string | null;
    recordsSeen: number;
    recordsValid: number;
    recordsInvalid: number;
    lastKnownGoodCount: number | null;
    healingAttemptCount: number;
    createdAt: string;
  }[];
  recentHealingAttempts: {
    id: string;
    incidentId: string;
    sourceId: string;
    collectorId: string | null;
    attemptNumber: number;
    prompt: string;
    status: string;
    candidatePassedValidation: boolean | null;
    startedAt: string;
    completedAt: string | null;
  }[];
  summary: {
    totalSources: number;
    healthySources: number;
    degradedSources: number;
    quarantinedSources: number;
    healingSources: number;
    needsReviewSources: number;
    openIncidents: number;
  };
}
