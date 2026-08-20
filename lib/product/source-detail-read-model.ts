/**
 * The source-detail adapter backed by the Source Detail & Provenance read
 * model.
 *
 * This is the richer backend the `SourceDetailAdapter` seam was built for. It
 * answers everything the Sentinel-backed adapter could, plus the things that
 * one had to report unavailable: full per-run history with validation counts,
 * the incident record, every healing attempt, the last-known-good snapshot,
 * and a worked raw → normalized example taken from a real observation.
 *
 * It calls the read model directly rather than having a server component fetch
 * its own HTTP route: the pages are server components, the read model is a
 * server module, and going out through the network would only add a hop, a
 * failure mode and a serialization boundary.
 *
 * The rule the seam exists to enforce still holds. Where this backend genuinely
 * cannot answer — the raw collector payload, or a section for a source that has
 * no contract registered — the section reports itself unavailable with the
 * reason, and nothing is invented to fill the space.
 */

import type { HealthStatus } from "../../components/radar/types";
import type {
  SentinelStageStatus,
  SentinelTimelineStage,
} from "../../components/radar/sentinel/types";
import {
  healthForSentinelStatus,
  sentinelStatusLabel,
} from "../../components/radar/sentinel/utils";
import type {
  SourceContractView,
  SourceDetail as BackendSourceDetail,
  SourceHealingAttemptView,
  SourceIncidentView,
  SourceRunView,
  SourceSummary,
  SourceTransformationView,
} from "../sources/types";
import { provenanceFromSource, type ProvenanceValidationStatus } from "./provenance";
import {
  available,
  registerDefaultSourceDetailAdapter,
  type SectionState,
  type SourceDetailAdapter,
  type SourceDetailCapabilities,
  type SourceDetailView,
  type SourceDirectory,
  type SourceDirectoryEntry,
  type SourceIncidentRecord,
  type SourceNormalizationExplainer,
  type SourceNormalizationStage,
  type SourceObservedData,
  type SourceRunRecord,
  type SourceRunStatus,
  type SourceSnapshotRef,
  unavailable,
} from "./source-detail";

export const SOURCE_READ_MODEL_CAPABILITIES: SourceDetailCapabilities = {
  runHistory: true,
  observedData: true,
  incidents: true,
  healingTimeline: true,
  lastKnownGood: true,
  normalization: true,
  // The read model deliberately publishes sanitized field-level evidence, never
  // the raw Bright Data payload, so this stays false.
  rawPayload: false,
};

const NO_CONTRACT_REASON =
  "No Sentinel source contract is registered for this source, so its normalization expectations are unknown.";

/**
 * Where a source's contract is declared, in words a judge can check.
 *
 * Both are real, executable `SourceHealthContract`s built by the same factory
 * and evaluated by the same `evaluateSourceHealth` / `evaluateSentinelGate`.
 * The difference is which registry declares them and what they govern, and the
 * page states that rather than implying one is not a contract at all.
 */
const CONTRACT_REGISTRY_NOTE: Record<SourceContractView["registry"], string> = {
  "production-sources":
    "Registered in the production source registry: this contract governs a provider page whose accepted records reach the canonical tables.",
  "sentinel-demo-harness":
    "Registered by the Sentinel self-healing demo harness rather than the production source registry. It is a real source contract — same factory, same evaluator, same gate — but it governs the isolated demo source and its records never reach the canonical pricing, lifecycle or catalog tables.",
};

const NO_TRANSFORMATION_REASON =
  "No accepted observation has been recorded for this source yet, so there is no raw-to-normalized example to show.";

const NO_LKG_REASON =
  "No collection run has been accepted as last-known-good for this source yet.";

function validationStatusFor(status: SourceSummary["health"]["status"]): ProvenanceValidationStatus {
  if (status === "healthy" || status === "recovered") return "passing";
  if (status === "healing") return "unknown";
  return "failing";
}

function healthFor(status: SourceSummary["health"]["status"]): HealthStatus {
  return healthForSentinelStatus(status);
}

function toRunRecord(run: SourceRunView): SourceRunRecord {
  return {
    id: run.runId,
    status: run.status as SourceRunStatus,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    recordsSeen: run.recordsSeen,
    recordsAccepted: run.recordsAccepted,
    recordsRejected: run.recordsRejected,
    errorMessage: run.failureReason,
  };
}

function toIncidentRecord(incident: SourceIncidentView): SourceIncidentRecord {
  return {
    id: incident.incidentId,
    status: incident.status,
    severity: incident.severity,
    reasonCodes: incident.reasonCodes,
    summary: incident.summary,
    recordsSeen: incident.recordsSeen,
    recordsValid: incident.recordsValid,
    recordsInvalid: incident.recordsInvalid,
    healingAttemptCount: incident.healingAttemptCount,
    createdAt: incident.createdAt,
  };
}

const STAGE_STATUS_BY_OUTCOME: Record<
  SourceHealingAttemptView["outcome"],
  SentinelStageStatus
> = {
  in_progress: "active",
  recovered: "done",
  rejected: "failed",
  needs_review: "failed",
  failed: "failed",
};

const HEALING_DETAIL_BY_OUTCOME: Record<SourceHealingAttemptView["outcome"], string> = {
  in_progress: "Regenerating the collector template.",
  recovered: "The repaired collector passed validation and the source recovered.",
  rejected: "The candidate failed validation, so the existing template was kept.",
  needs_review: "The candidate failed validation and the source needs review.",
  failed: "The healing attempt did not complete.",
};

function toTimelineStage(attempt: SourceHealingAttemptView): SentinelTimelineStage {
  const counted =
    attempt.candidateRecordsCount === null
      ? null
      : `${attempt.candidateRecordsCount.toLocaleString("en-US")} candidate record${
          attempt.candidateRecordsCount === 1 ? "" : "s"
        }`;
  const base = HEALING_DETAIL_BY_OUTCOME[attempt.outcome];
  return {
    id: attempt.attemptId,
    label: `Healing attempt ${attempt.attemptNumber}`,
    detail: counted ? `${base} ${counted}.` : base,
    at: attempt.completedAt ?? attempt.startedAt,
    status: STAGE_STATUS_BY_OUTCOME[attempt.outcome],
  };
}

function formatCount(value: number | null): string | null {
  if (value === null) return null;
  return `${value.toLocaleString("en-US")} record${value === 1 ? "" : "s"}`;
}

/** One line per field showing the published text and the value it became. */
function describeTransformation(transformation: SourceTransformationView): string {
  return transformation.fields
    .map((field) => {
      const from = field.rawValue ?? field.rawField ?? "not published";
      const to = field.normalizedValue === null ? "unknown" : String(field.normalizedValue);
      return `${field.normalizedField}: ${from} → ${to}`;
    })
    .join(" · ");
}

/**
 * The collect → validate → normalize → gate → persist path, annotated with what
 * the contract actually expects and what the newest run and observation
 * actually reported. Every detail is omitted rather than guessed when the
 * backend did not report it.
 */
function buildNormalization(
  contract: SourceContractView,
  collectorId: string | null,
  latestRun: SourceRunView | null,
  transformation: SourceTransformationView | null,
  status: SourceSummary["health"]["status"],
): SourceNormalizationExplainer {
  const required = contract.requiredFields.length
    ? `Every accepted record must carry ${contract.requiredFields.join(", ")}.`
    : "Every accepted record is checked against the source contract.";

  const stages: SourceNormalizationStage[] = [
    {
      id: "collect",
      label: "Collect",
      description: collectorId
        ? `Bright Data collector ${collectorId} fetches the provider's published page and returns a raw payload.`
        : "The collector fetches the provider's published page and returns a raw payload.",
      detail: formatCount(latestRun?.recordsSeen ?? null),
    },
    {
      id: "validate",
      label: "Validate raw payload",
      description: `${required} Records that fail are held back rather than partially applied.`,
      detail:
        latestRun === null ? null : `${latestRun.recordsRejected.toLocaleString("en-US")} rejected`,
    },
    {
      id: "normalize",
      label: "Normalize",
      description: transformation
        ? "Valid records are mapped onto the provider-independent contract, keeping the published text as evidence."
        : "Valid records are mapped onto the provider-independent contract.",
      detail: transformation ? describeTransformation(transformation) : formatCount(latestRun?.recordsAccepted ?? null),
    },
    {
      id: "gate",
      label: "Sentinel gate",
      description: `The normalized batch is evaluated against the contract for ${contract.authorityDomain}. A batch past the ${Math.round(
        contract.failurePolicy.quarantineThresholdPercentage * 100,
      )}% failure budget is quarantined and the last-known-good snapshot keeps serving.`,
      detail: sentinelStatusLabel(status),
    },
    {
      id: "persist",
      label: "Snapshot and diff",
      description:
        "Accepted records are stored as an immutable snapshot and compared with the previous one to emit change events.",
      detail: null,
    },
  ];

  stages.push({
    id: "contract-registry",
    label: "Contract registry",
    description: CONTRACT_REGISTRY_NOTE[contract.registry],
    detail: contract.isAuthoritative
      ? "Authoritative for its domain"
      : "Non-authoritative: validated, but not the canonical authority",
  });

  return { contractName: contract.contractName, stages };
}

export function buildSourceDirectoryFromReadModel(
  sources: readonly SourceSummary[],
  generatedAt: string,
): SourceDirectory {
  const entries = sources.map<SourceDirectoryEntry>((source) => ({
    sourceId: source.identity.sourceId,
    name: source.identity.name,
    providerName: source.identity.providerName,
    category: source.identity.category,
    collectorId: source.identity.collectorId,
    status: source.health.status,
    statusLabel: sentinelStatusLabel(source.health.status),
    health: healthFor(source.health.status),
    lastRunAt: source.health.lastAttemptedRunAt,
    stalenessMinutes: source.health.freshness.ageMinutes,
    recordCount: source.health.currentRecordCount,
    hasOpenIncident: source.health.activeIncident !== null,
    hasResolvedIncident:
      source.health.activeIncident === null && source.health.latestIncident !== null,
  }));

  return { entries, isDemo: false, demoScenario: null, generatedAt };
}

/**
 * Projects the backend detail onto the UI contract. Pure: given the same detail
 * it always produces the same view, so the screen is testable without a
 * database.
 */
export function buildSourceDetailFromReadModel(
  detail: BackendSourceDetail,
): SourceDetailView {
  const { identity, health, contract } = detail;
  const latestRun = detail.runs[0] ?? null;

  const lastKnownGood: SectionState<SourceSnapshotRef> =
    health.lastKnownGoodRunId === null && health.lastKnownGoodAt === null
      ? unavailable(NO_LKG_REASON)
      : available({
          label: "Last known good",
          runId: health.lastKnownGoodRunId,
          observedAt: health.lastKnownGoodAt,
          recordCount: health.lastKnownGoodCount,
          invalidCount: null,
        });

  const observedData: SectionState<SourceObservedData> =
    latestRun === null
      ? unavailable("No collection run has been recorded for this source yet.")
      : available({
          observedRecords: latestRun.recordsSeen,
          trustedRecords: latestRun.recordsAccepted,
          rejectedRecords: latestRun.recordsRejected,
        });

  const normalization: SectionState<SourceNormalizationExplainer> = contract
    ? available(
        buildNormalization(
          contract,
          identity.collectorId,
          latestRun,
          detail.transformation,
          health.status,
        ),
      )
    : unavailable(detail.transformation === null ? NO_CONTRACT_REASON : NO_TRANSFORMATION_REASON);

  return {
    identity: {
      sourceId: identity.sourceId,
      name: identity.name,
      providerName: identity.providerName,
      providerSlug: identity.providerSlug,
      category: identity.category,
      collectorId: identity.collectorId,
      sourceUrl: identity.sourceUrl,
      isActive: identity.enabled,
    },
    health: {
      status: health.status,
      statusLabel: sentinelStatusLabel(health.status),
      health: healthFor(health.status),
      recordCount: health.currentRecordCount,
      openIncident:
        health.activeIncident === null
          ? null
          : {
              incidentId: health.activeIncident.incidentId,
              severity: health.activeIncident.severity,
              reasonCodes: [...health.activeIncident.reasonCodes],
              openedAt: health.activeIncident.openedAt,
            },
    },
    recovery: {
      resolvedIncidents: health.recovery.resolvedIncidents,
      healingAttempts: health.recovery.healingAttempts,
      lastRecoveredAt: health.recovery.lastRecoveredAt,
    },
    freshness: {
      lastRunAt: health.lastAttemptedRunAt,
      lastSuccessAt: health.lastSuccessfulRunAt,
      stalenessMinutes: health.freshness.ageMinutes,
      expectedIntervalMinutes: health.freshness.maxStalenessMinutes,
    },
    lastKnownGood,
    runHistory: available(detail.runs.map(toRunRecord)),
    observedData,
    incidents: available(detail.incidents.map(toIncidentRecord)),
    healingTimeline: available(detail.healing.map(toTimelineStage)),
    normalization,
    provenance: provenanceFromSource({
      sourceLabel: identity.name,
      sourceUrl: identity.sourceUrl,
      sourceKind: identity.category,
      collectorId: identity.collectorId,
      observedAt: health.lastSuccessfulRunAt ?? health.lastAttemptedRunAt,
      runId: health.lastSuccessfulRunId ?? health.lastAttemptedRunId,
      externalRunId: latestRun?.externalRunId ?? null,
      validation: {
        label: sentinelStatusLabel(health.status),
        status: validationStatusFor(health.status),
      },
      // Only the contract knows whether this source is an authority; a page
      // being reachable says nothing about how authoritative its contents are.
      // A contract-governed source that is passing the gate but is not the
      // authority for its domain is a verified scrape — the same rule
      // `provenanceFromRecord` applies, so the two surfaces cannot disagree.
      authority: contract === null
        ? null
        : contract.isAuthoritative
          ? "authoritative"
          : validationStatusFor(health.status) === "passing"
            ? "verified_scrape"
            : null,
      isDemo: false,
    }),
    isDemo: false,
    demoScenario: null,
    generatedAt: detail.generatedAt,
  };
}

export interface SourceReadModelAdapterOptions {
  loadCatalog: () => Promise<{ sources: SourceSummary[]; generatedAt: string }>;
  loadDetail: (sourceId: string) => Promise<BackendSourceDetail | null>;
}

export function createSourceReadModelAdapter(
  options: SourceReadModelAdapterOptions,
): SourceDetailAdapter {
  return {
    id: "source-detail-read-model-v1",
    label: "Source detail & provenance",
    capabilities: SOURCE_READ_MODEL_CAPABILITIES,
    async listSources() {
      const catalog = await options.loadCatalog();
      return buildSourceDirectoryFromReadModel(catalog.sources, catalog.generatedAt);
    },
    async getSourceDetail(sourceId) {
      const detail = await options.loadDetail(sourceId);
      return detail ? buildSourceDetailFromReadModel(detail) : null;
    },
  };
}

/**
 * Installs this adapter as the default. `lib/product` calls it after both
 * adapter modules have been evaluated, so the richer backend wins regardless of
 * the order a caller happens to import things in. Registration is not done at
 * module scope precisely because that would make the winner depend on import
 * order. Either adapter still satisfies the seam, and `setSourceDetailAdapter`
 * overrides both.
 */
export function installSourceReadModelAdapter(): void {
  registerDefaultSourceDetailAdapter(() =>
    createSourceReadModelAdapter({
      loadCatalog: async () => {
        const { getSourceCatalog } = await import("../sources/read-model");
        const catalog = await getSourceCatalog();
        return { sources: catalog.sources, generatedAt: catalog.generatedAt };
      },
      loadDetail: async (sourceId) => {
        const { getSourceDetail } = await import("../sources/read-model");
        return getSourceDetail(sourceId);
      },
    }),
  );
}
