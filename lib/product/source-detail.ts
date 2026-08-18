/**
 * The single typed seam between the Source Detail UI and whatever backend
 * supplies it.
 *
 * The screen is written against `SourceDetailView` only. Today the sole
 * implementation projects the Sentinel dashboard read model plus the
 * `source_health` view (see `sentinel-source-detail.ts`). A richer
 * source-detail/provenance API can be dropped in by implementing
 * `SourceDetailAdapter` and calling `setSourceDetailAdapter` — no component
 * changes, and no other module needs to know which adapter is installed.
 *
 * Two rules make that swap safe:
 *
 * 1. Optional sections are `SectionState<T>`, so an adapter must either supply
 *    data or state why it cannot. There is no third "empty-looking" outcome
 *    that the UI could mistake for "nothing happened".
 * 2. `capabilities` declares up front which sections an adapter can ever fill,
 *    so the UI can omit a section entirely rather than render a wall of
 *    "unavailable" for a backend that was never going to have it.
 */

import type { HealthStatus } from "../../components/radar/types";
import type {
  SentinelIncidentStatus,
  SentinelReasonCode,
  SentinelSeverity,
  SentinelStatus,
  SentinelTimelineStage,
} from "../../components/radar/sentinel/types";
import type { ProvenanceView } from "./provenance";

/** Either the data, or an explicit reason it is not available. */
export type SectionState<T> =
  | { available: true; data: T }
  | { available: false; reason: string };

export function available<T>(data: T): SectionState<T> {
  return { available: true, data };
}

export function unavailable<T>(reason: string): SectionState<T> {
  return { available: false, reason };
}

export interface SourceIdentity {
  sourceId: string;
  name: string;
  providerName: string;
  providerSlug: string | null;
  /** Source category as the backend classifies it: pricing, changelog, models… */
  category: string;
  /** Bright Data Collector ID, or null when the source is not collector-backed. */
  collectorId: string | null;
  sourceUrl: string | null;
  isActive: boolean | null;
}

export interface SourceHealthState {
  status: SentinelStatus;
  statusLabel: string;
  /** Mapped onto the app-wide dot vocabulary so status reads consistently. */
  health: HealthStatus;
  recordCount: number | null;
}

export interface SourceFreshnessState {
  lastRunAt: string | null;
  /** Null when no run has succeeded, or when success cannot be determined. */
  lastSuccessAt: string | null;
  stalenessMinutes: number | null;
  expectedIntervalMinutes: number | null;
}

export interface SourceSnapshotRef {
  label: string;
  runId: string | null;
  observedAt: string | null;
  recordCount: number | null;
  invalidCount: number | null;
}

export type SourceRunStatus = "running" | "succeeded" | "partial" | "failed";

export interface SourceRunRecord {
  id: string;
  status: SourceRunStatus | null;
  startedAt: string | null;
  completedAt: string | null;
  recordsSeen: number | null;
  recordsAccepted: number | null;
  recordsRejected: number | null;
  errorMessage: string | null;
}

/** What the collector saw versus what passed validation and was trusted. */
export interface SourceObservedData {
  observedRecords: number | null;
  trustedRecords: number | null;
  rejectedRecords: number | null;
}

export interface SourceIncidentRecord {
  id: string;
  status: SentinelIncidentStatus;
  severity: SentinelSeverity;
  reasonCodes: SentinelReasonCode[];
  summary: string | null;
  recordsSeen: number | null;
  recordsValid: number | null;
  recordsInvalid: number | null;
  healingAttemptCount: number;
  createdAt: string;
}

export interface SourceNormalizationStage {
  id: string;
  label: string;
  description: string;
  /** Observed figure for this stage, when the backend reports one. */
  detail: string | null;
}

/** How a raw collector payload becomes a trusted, normalized record. */
export interface SourceNormalizationExplainer {
  /** Name of the normalized contract this source produces, when known. */
  contractName: string | null;
  stages: SourceNormalizationStage[];
}

export interface SourceDetailCapabilities {
  runHistory: boolean;
  observedData: boolean;
  incidents: boolean;
  healingTimeline: boolean;
  lastKnownGood: boolean;
  normalization: boolean;
  /** Raw collector payload inspection — no current backend exposes it. */
  rawPayload: boolean;
}

export interface SourceDetailView {
  identity: SourceIdentity;
  health: SourceHealthState;
  freshness: SourceFreshnessState;
  lastKnownGood: SectionState<SourceSnapshotRef>;
  runHistory: SectionState<SourceRunRecord[]>;
  observedData: SectionState<SourceObservedData>;
  incidents: SectionState<SourceIncidentRecord[]>;
  healingTimeline: SectionState<SentinelTimelineStage[]>;
  normalization: SectionState<SourceNormalizationExplainer>;
  provenance: ProvenanceView;
  /** True only for the explicitly enabled deterministic demo simulation. */
  isDemo: boolean;
  demoScenario: string | null;
  generatedAt: string;
}

/** Row shape for the source directory that links into the detail pages. */
export interface SourceDirectoryEntry {
  sourceId: string;
  name: string;
  providerName: string;
  category: string;
  collectorId: string | null;
  status: SentinelStatus;
  statusLabel: string;
  health: HealthStatus;
  lastRunAt: string | null;
  stalenessMinutes: number | null;
  recordCount: number | null;
  hasOpenIncident: boolean;
}

export interface SourceDirectory {
  entries: SourceDirectoryEntry[];
  isDemo: boolean;
  demoScenario: string | null;
  generatedAt: string;
}

export interface SourceDetailAdapter {
  /** Identifies the installed implementation in footers and diagnostics. */
  readonly id: string;
  readonly label: string;
  readonly capabilities: SourceDetailCapabilities;
  listSources(): Promise<SourceDirectory>;
  getSourceDetail(sourceId: string): Promise<SourceDetailView | null>;
}

let installedAdapter: SourceDetailAdapter | null = null;
let defaultAdapterFactory: (() => SourceDetailAdapter) | null = null;

/**
 * Registers the fallback used when nothing has been installed explicitly. The
 * Sentinel adapter self-registers here so importing it is enough to make the
 * pages work, while a replacement can still take precedence.
 */
export function registerDefaultSourceDetailAdapter(factory: () => SourceDetailAdapter): void {
  defaultAdapterFactory = factory;
}

export function setSourceDetailAdapter(adapter: SourceDetailAdapter | null): void {
  installedAdapter = adapter;
}

export function getSourceDetailAdapter(): SourceDetailAdapter {
  if (installedAdapter) return installedAdapter;
  if (!defaultAdapterFactory) {
    throw new Error(
      "No source-detail adapter is installed. Import the Sentinel adapter or call setSourceDetailAdapter().",
    );
  }
  installedAdapter = defaultAdapterFactory();
  return installedAdapter;
}

/**
 * Which optional sections this adapter could ever fill. The UI omits the rest
 * instead of showing an unavailable state for data that will never exist.
 */
export function supportedSections(
  capabilities: SourceDetailCapabilities,
): (keyof SourceDetailCapabilities)[] {
  return (Object.keys(capabilities) as (keyof SourceDetailCapabilities)[]).filter(
    (section) => capabilities[section],
  );
}
