/**
 * One provenance vocabulary for the whole product surface.
 *
 * Every screen that shows a value a collector produced — the change feed, a
 * source detail page, and later the model explorer — inspects it through
 * `ProvenanceView`. Producers normalise their own shape into this type once;
 * the UI never reads a backend contract directly.
 *
 * Absent facts stay `null`. `provenanceRows` emits a row only for a fact that
 * is actually known, which is what stops the UI inventing provenance.
 */

import type { AuthorityLevel, TemporalEvidence } from "../intelligence/contracts";
import type {
  ProvenanceRecord,
  ProvenanceValidationState,
} from "../sources/types";
import type { SentinelStatus } from "../supabase/types";
import { sentinelStatusLabel } from "../../components/radar/sentinel/utils";

export type ProvenanceTrust = "official" | "verified" | "inferred" | "unverified";

export type ProvenanceValidationStatus = "passing" | "failing" | "unknown";

export interface ProvenanceValidation {
  /** Verbatim state from the producing system, e.g. a Sentinel status label. */
  label: string;
  status: ProvenanceValidationStatus;
}

export interface ProvenanceView {
  /** Human name of the official source, e.g. "Anthropic official API pricing". */
  sourceLabel: string | null;
  sourceUrl: string | null;
  /** Source category as the backend classifies it: pricing, changelog, models… */
  sourceKind: string | null;
  /** Bright Data collector that produced the observation. */
  collectorId: string | null;
  observedAt: string | null;
  authority: AuthorityLevel | null;
  /** 0–1 as scored by the producing system, or null when it does not score. */
  confidence: number | null;
  trust: ProvenanceTrust;
  validation: ProvenanceValidation | null;
  runId: string | null;
  externalRunId: string | null;
  snapshotId: string | null;
  previousSnapshotId: string | null;
  isDemo: boolean;
}

const TRUST_BY_AUTHORITY: Record<AuthorityLevel, ProvenanceTrust> = {
  authoritative: "official",
  verified_scrape: "verified",
  inferred: "inferred",
};

const TRUST_LABELS: Record<ProvenanceTrust, string> = {
  official: "Official source",
  verified: "Verified scrape",
  inferred: "Inferred",
  unverified: "Unverified",
};

const TRUST_DESCRIPTIONS: Record<ProvenanceTrust, string> = {
  official: "Read directly from the provider's own published page.",
  verified: "Scraped and validated against the source contract before acceptance.",
  inferred: "Derived from other observations rather than stated by the provider.",
  unverified: "The producing system did not report an authority level for this value.",
};

export function provenanceTrustLabel(trust: ProvenanceTrust): string {
  return TRUST_LABELS[trust];
}

export function provenanceTrustDescription(trust: ProvenanceTrust): string {
  return TRUST_DESCRIPTIONS[trust];
}

export function provenanceTrustFromAuthority(
  authority: AuthorityLevel | null | undefined,
): ProvenanceTrust {
  if (!authority) return "unverified";
  return TRUST_BY_AUTHORITY[authority] ?? "unverified";
}

function nullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Normalises a temporal-intelligence event into the shared provenance shape. */
export function provenanceFromEvidence(evidence: TemporalEvidence): ProvenanceView {
  return {
    sourceLabel: nullableString(evidence.source.label),
    sourceUrl: nullableString(evidence.source.url),
    sourceKind: nullableString(evidence.source.kind),
    collectorId: nullableString(evidence.source.collectorId),
    observedAt: evidence.observedAt,
    authority: evidence.authority,
    confidence: typeof evidence.confidence === "number" ? evidence.confidence : null,
    trust: provenanceTrustFromAuthority(evidence.authority),
    validation: null,
    runId: nullableString(evidence.provenance.runId),
    externalRunId: nullableString(evidence.provenance.externalRunId),
    snapshotId:
      nullableString(evidence.provenance.currentSnapshotId) ??
      nullableString(evidence.provenance.currentLifecycleSnapshotId),
    previousSnapshotId:
      nullableString(evidence.provenance.previousSnapshotId) ??
      nullableString(evidence.provenance.previousLifecycleSnapshotId),
    isDemo: evidence.isDemo === true,
  };
}

export interface SourceProvenanceInput {
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  sourceKind?: string | null;
  collectorId?: string | null;
  observedAt?: string | null;
  runId?: string | null;
  externalRunId?: string | null;
  validation?: ProvenanceValidation | null;
  authority?: AuthorityLevel | null;
  confidence?: number | null;
  isDemo?: boolean;
}

/**
 * Builds provenance for a collection source rather than a single value. The
 * authority level is only set when the caller actually knows it: a source page
 * being reachable says nothing about how authoritative its contents are.
 */
export function provenanceFromSource(input: SourceProvenanceInput): ProvenanceView {
  const authority = input.authority ?? null;
  return {
    sourceLabel: nullableString(input.sourceLabel),
    sourceUrl: nullableString(input.sourceUrl),
    sourceKind: nullableString(input.sourceKind),
    collectorId: nullableString(input.collectorId),
    observedAt: nullableString(input.observedAt),
    authority,
    confidence: typeof input.confidence === "number" ? input.confidence : null,
    trust: provenanceTrustFromAuthority(authority),
    validation: input.validation ?? null,
    runId: nullableString(input.runId),
    externalRunId: nullableString(input.externalRunId),
    snapshotId: null,
    previousSnapshotId: null,
    isDemo: input.isDemo === true,
  };
}

export type ProvenanceRowKind = "text" | "mono" | "time" | "url";

export interface ProvenanceRow {
  id: string;
  label: string;
  value: string;
  kind: ProvenanceRowKind;
  /** Present only for `url` rows, so the renderer can build the anchor. */
  href?: string;
}

/**
 * The inspectable facts, in the order a reader asks for them: what said this,
 * where, when, who collected it, and which run can be traced back to.
 */
export function provenanceRows(provenance: ProvenanceView): ProvenanceRow[] {
  const rows: ProvenanceRow[] = [];

  if (provenance.sourceLabel) {
    rows.push({
      id: "source",
      label: "Official source",
      value: provenance.sourceLabel,
      kind: "text",
    });
  }
  if (provenance.sourceUrl) {
    rows.push({
      id: "source-url",
      label: "Source URL",
      value: provenance.sourceUrl,
      kind: "url",
      href: provenance.sourceUrl,
    });
  }
  if (provenance.observedAt) {
    rows.push({
      id: "observed-at",
      label: "Observed",
      value: provenance.observedAt,
      kind: "time",
    });
  }
  if (provenance.collectorId) {
    rows.push({
      id: "collector",
      label: "Collector ID",
      value: provenance.collectorId,
      kind: "mono",
    });
  }
  if (provenance.validation) {
    rows.push({
      id: "validation",
      label: "Validation",
      value: provenance.validation.label,
      kind: "text",
    });
  }
  rows.push({
    id: "trust",
    label: "Trust",
    value: provenanceTrustLabel(provenance.trust),
    kind: "text",
  });
  if (provenance.confidence !== null) {
    rows.push({
      id: "confidence",
      label: "Confidence",
      value: `${Math.round(provenance.confidence * 100)}%`,
      kind: "text",
    });
  }
  if (provenance.runId) {
    rows.push({ id: "run", label: "Run", value: provenance.runId, kind: "mono" });
  }
  if (provenance.externalRunId) {
    rows.push({
      id: "external-run",
      label: "Collector run",
      value: provenance.externalRunId,
      kind: "mono",
    });
  }
  if (provenance.snapshotId) {
    rows.push({
      id: "snapshot",
      label: "Snapshot",
      value: provenance.snapshotId,
      kind: "mono",
    });
  }
  if (provenance.previousSnapshotId) {
    rows.push({
      id: "previous-snapshot",
      label: "Compared against",
      value: provenance.previousSnapshotId,
      kind: "mono",
    });
  }

  return rows;
}

/** False when nothing beyond the derived trust label is known. */
export function hasProvenanceDetail(provenance: ProvenanceView): boolean {
  return provenanceRows(provenance).some((row) => row.id !== "trust");
}

/**
 * Normalises a Source Detail & Provenance `ProvenanceRecord` into the shared
 * shape, so `ProvenanceDisclosure` renders backend provenance through exactly
 * the same rows, trust vocabulary and ordering as every other surface. This is
 * the only place that knows the two models differ.
 *
 * Two facts are deliberately not carried across. That backend does not score
 * confidence, so `confidence` stays null rather than inventing a number. And
 * its `isAuthoritative` flag only distinguishes an authoritative source; a
 * non-authoritative source that passed the Sentinel gate is a verified scrape,
 * which is what `validated` means there, and anything else stays unverified.
 */
export function provenanceFromRecord(record: ProvenanceRecord): ProvenanceView {
  const authority: AuthorityLevel | null = record.trust.isAuthoritative
    ? "authoritative"
    : record.trust.validationState === "validated"
      ? "verified_scrape"
      : null;

  return {
    sourceLabel: nullableString(record.source?.name),
    sourceUrl: nullableString(record.source?.url),
    sourceKind: nullableString(record.source?.category),
    collectorId: nullableString(record.source?.collectorId),
    observedAt: nullableString(record.observedAt),
    authority,
    confidence: null,
    trust: provenanceTrustFromAuthority(authority),
    validation: provenanceValidationFromState(
      record.trust.validationState,
      record.trust.sentinelStatus,
    ),
    runId: nullableString(record.run?.runId),
    externalRunId: nullableString(record.run?.externalRunId),
    snapshotId:
      nullableString(record.snapshotId) ??
      nullableString(record.transition?.currentSnapshotId),
    previousSnapshotId: nullableString(record.transition?.previousSnapshotId),
    isDemo: false,
  };
}

const VALIDATION_STATUS_BY_STATE: Record<
  ProvenanceValidationState,
  ProvenanceValidationStatus
> = {
  validated: "passing",
  quarantined: "failing",
  provisional: "unknown",
  unknown: "unknown",
};

const VALIDATION_LABEL_BY_STATE: Record<ProvenanceValidationState, string> = {
  validated: "Validated",
  quarantined: "Quarantined",
  provisional: "Provisional",
  unknown: "Not reported",
};

/**
 * Prefers the source's live Sentinel status as the label, because that is the
 * verbatim state of the producing system, and falls back to the per-value
 * validation state when no status was reported.
 */
export function provenanceValidationFromState(
  state: ProvenanceValidationState,
  sentinelStatus: SentinelStatus | null,
): ProvenanceValidation | null {
  if (state === "unknown" && !sentinelStatus) return null;
  return {
    label: sentinelStatus ? sentinelStatusLabel(sentinelStatus) : VALIDATION_LABEL_BY_STATE[state],
    status: VALIDATION_STATUS_BY_STATE[state],
  };
}
