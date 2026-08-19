/**
 * Provenance lookup.
 *
 * For any trusted value the product shows — a current price, a lifecycle
 * assertion, a change-feed item — this answers the same question in the same
 * shape: which provider published it, from which source and URL, collected by
 * which Bright Data collector, observed when, in which collection run, from
 * which snapshot, and how far that evidence should be trusted.
 *
 * The reference kinds are a closed union today (pricing, lifecycle, change
 * events) but the resolution path is generic: a new evidence table only needs a
 * new `kind` plus a row → provenance mapping, not a new API shape.
 */

import type {
  ChangeEventRow,
  LifecycleSnapshotRow,
  PricingSnapshotRow,
  ProviderRow,
  SourceRow,
} from "../supabase/types";
import { resolveSourceCategory, resolveSourceContractView } from "./contract-view";
import {
  createSourceReadPort,
  type PublicCollectionRunRow,
  type SourceReadPort,
} from "./port";
import { safeSourceUrl, sanitizeText } from "./sanitize";
import type {
  ProvenanceKind,
  ProvenanceRecord,
  ProvenanceReference,
  ProvenanceValidationState,
} from "./types";

export interface ProvenanceOptions {
  port?: SourceReadPort;
}

const PROVENANCE_KINDS: readonly ProvenanceKind[] = [
  "pricing_snapshot",
  "lifecycle_snapshot",
  "change_event",
];

export function isProvenanceKind(value: string): value is ProvenanceKind {
  return (PROVENANCE_KINDS as readonly string[]).includes(value);
}

/**
 * Parses an untrusted `kind`/`id` pair from a query string. Returns null rather
 * than throwing so a route can answer 400 without a stack trace in the body.
 */
export function parseProvenanceReference(
  kind: string | null,
  id: string | null,
): ProvenanceReference | null {
  if (!kind || !id) return null;
  if (!isProvenanceKind(kind)) return null;
  const trimmed = id.trim();
  if (trimmed.length === 0 || trimmed.length > 100) return null;
  return { kind, id: trimmed };
}

function buildSourceView(
  source: SourceRow | null,
  providerSlug: string,
): ProvenanceRecord["source"] {
  if (!source) return null;
  const category = resolveSourceCategory(
    source.kind,
    providerSlug,
    source.collector_id,
    source.source_url,
  );
  return {
    id: source.id,
    name:
      sanitizeText(source.label, 120) ??
      `${providerSlug} ${category === "lifecycle" ? "model lifecycle" : source.kind}`,
    url: safeSourceUrl(source.source_url),
    kind: source.kind,
    category,
    collectorId: source.collector_id,
    enabled: source.is_active,
  };
}

function buildRunView(run: PublicCollectionRunRow | null): ProvenanceRecord["run"] {
  if (!run) return null;
  return {
    runId: run.id,
    externalRunId: run.external_run_id,
    status: run.status,
    startedAt: run.started_at,
    completedAt: run.completed_at,
  };
}

/**
 * How far the evidence behind a value should be trusted.
 *
 * A run that Sentinel quarantined can still have left snapshot rows behind —
 * they are history, not current truth — so an open incident on the same run
 * outranks the run status itself.
 */
function deriveValidationState(
  run: PublicCollectionRunRow | null,
  quarantinedRunIds: ReadonlySet<string>,
): ProvenanceValidationState {
  if (!run) return "unknown";
  if (quarantinedRunIds.has(run.id)) return "quarantined";
  if (run.status === "succeeded") return "validated";
  if (run.status === "partial" || run.status === "failed") return "provisional";
  return "unknown";
}

interface ResolutionContext {
  source: SourceRow | null;
  provider: ProviderRow | null;
  run: PublicCollectionRunRow | null;
  quarantinedRunIds: ReadonlySet<string>;
  sentinelStatus: ProvenanceRecord["trust"]["sentinelStatus"];
}

async function loadContext(
  port: SourceReadPort,
  sourceId: string | null,
  runId: string | null,
): Promise<ResolutionContext> {
  const source = sourceId ? await port.getSource(sourceId) : null;
  const [provider, run, incidents, sentinelRows] = await Promise.all([
    source ? port.getProvider(source.provider_id) : Promise.resolve(null),
    runId ? port.getRun(runId) : Promise.resolve(null),
    source ? port.listIncidents(source.id) : Promise.resolve([]),
    port.listSentinelHealth(),
  ]);

  const quarantinedRunIds = new Set(
    incidents
      .filter(
        (incident) =>
          incident.run_id !== null &&
          (incident.status === "open" ||
            incident.status === "healing" ||
            incident.status === "needs_review"),
      )
      .map((incident) => incident.run_id as string),
  );

  return {
    source,
    provider,
    run,
    quarantinedRunIds,
    sentinelStatus: source
      ? (sentinelRows.find((row) => row.source_id === source.id)?.sentinel_health_status ??
        null)
      : null,
  };
}

function assemble(
  reference: ProvenanceReference,
  context: ResolutionContext,
  observedAt: string,
  snapshotId: string | null,
  transition: ProvenanceRecord["transition"],
): ProvenanceRecord {
  const providerSlug = context.provider?.slug ?? "unknown";
  const sourceView = buildSourceView(context.source, providerSlug);
  const contract = context.source
    ? resolveSourceContractView(
        context.source.kind,
        providerSlug,
        context.source.id,
        context.source.collector_id,
        context.source.source_url,
      )
    : null;

  return {
    reference,
    provider: {
      id: context.provider?.id ?? context.source?.provider_id ?? "",
      slug: providerSlug,
      name: context.provider?.name ?? providerSlug,
    },
    source: sourceView,
    observedAt,
    run: buildRunView(context.run),
    snapshotId,
    trust: {
      validationState: deriveValidationState(context.run, context.quarantinedRunIds),
      sentinelStatus: context.sentinelStatus,
      authorityDomain: contract?.authorityDomain ?? null,
      isAuthoritative: contract?.isAuthoritative ?? false,
    },
    transition,
  };
}

async function resolvePricingSnapshot(
  port: SourceReadPort,
  snapshot: PricingSnapshotRow,
  reference: ProvenanceReference,
): Promise<ProvenanceRecord> {
  const context = await loadContext(port, snapshot.source_id, snapshot.run_id);
  return assemble(reference, context, snapshot.observed_at, snapshot.id, null);
}

async function resolveLifecycleSnapshot(
  port: SourceReadPort,
  snapshot: LifecycleSnapshotRow,
  reference: ProvenanceReference,
): Promise<ProvenanceRecord> {
  const context = await loadContext(port, snapshot.source_id, snapshot.run_id);
  return assemble(reference, context, snapshot.observed_at, snapshot.id, null);
}

async function resolveChangeEvent(
  port: SourceReadPort,
  event: ChangeEventRow,
  reference: ProvenanceReference,
): Promise<ProvenanceRecord> {
  const context = await loadContext(port, event.source_id, event.run_id);

  const currentSnapshotId =
    event.current_snapshot_id ?? event.current_lifecycle_snapshot_id ?? null;
  const previousSnapshotId =
    event.previous_snapshot_id ?? event.previous_lifecycle_snapshot_id ?? null;

  // The observation instant is the snapshot's, not the detection instant:
  // change detection can run later than collection.
  let observedAt = event.detected_at;
  if (event.current_snapshot_id) {
    const snapshot = await port.getPricingSnapshot(event.current_snapshot_id);
    if (snapshot) observedAt = snapshot.observed_at;
  } else if (event.current_lifecycle_snapshot_id) {
    const snapshot = await port.getLifecycleSnapshot(
      event.current_lifecycle_snapshot_id,
    );
    if (snapshot) observedAt = snapshot.observed_at;
  }

  return assemble(reference, context, observedAt, currentSnapshotId, {
    previousSnapshotId,
    currentSnapshotId,
  });
}

/**
 * Resolves provenance for one reference, or null when the referenced row does
 * not exist (or is not readable through the public path).
 */
export async function getProvenance(
  reference: ProvenanceReference,
  options: ProvenanceOptions = {},
): Promise<ProvenanceRecord | null> {
  const port = options.port ?? createSourceReadPort();

  if (reference.kind === "pricing_snapshot") {
    const snapshot = await port.getPricingSnapshot(reference.id);
    return snapshot ? resolvePricingSnapshot(port, snapshot, reference) : null;
  }
  if (reference.kind === "lifecycle_snapshot") {
    const snapshot = await port.getLifecycleSnapshot(reference.id);
    return snapshot ? resolveLifecycleSnapshot(port, snapshot, reference) : null;
  }
  const event = await port.getChangeEvent(reference.id);
  return event ? resolveChangeEvent(port, event, reference) : null;
}

/** Resolves several references, dropping the ones that do not exist. */
export async function getProvenanceBatch(
  references: readonly ProvenanceReference[],
  options: ProvenanceOptions = {},
): Promise<ProvenanceRecord[]> {
  const port = options.port ?? createSourceReadPort();
  const resolved = await Promise.all(
    references.map((reference) => getProvenance(reference, { port })),
  );
  return resolved.filter((record): record is ProvenanceRecord => record !== null);
}
