/**
 * Sentinel enforcement for the ingestion pipelines.
 *
 * Every pipeline calls `assertSentinelSafe` after the collector returns and
 * before its first canonical write. When the gate refuses a payload this
 * throws, so there is no code path in which a quarantined collection can go on
 * to touch `models`, `pricing_snapshots`, `lifecycle_snapshots`,
 * `change_events` or the model lifecycle projections.
 */

import { evaluateSentinelGate, type SentinelGateDecision } from "../sentinel/gate";
import {
  createSourceHealthContractFor,
  type SourceHealthContractTarget,
} from "../sentinel/contracts";
import type { SentinelRepository } from "../sentinel/repository";
import type {
  SentinelReasonCode,
  SentinelStatus,
  SourceHealthContract,
} from "../sentinel/types";
import type { Json } from "../supabase";
import { PricingIngestionError } from "./errors";

/** Raised when Sentinel refuses a payload. Canonical state is untouched. */
export class SentinelQuarantineError extends PricingIngestionError {
  readonly incidentId: string;
  readonly sourceId: string;
  readonly providerId: string;
  readonly reasonCodes: SentinelReasonCode[];
  readonly recordsSeen: number;
  readonly recordsValid: number;
  readonly recordsInvalid: number;

  constructor(
    message: string,
    details: {
      collectionRunId?: string;
      externalRunId?: string;
      incidentId: string;
      sourceId: string;
      providerId: string;
      reasonCodes: SentinelReasonCode[];
      recordsSeen: number;
      recordsValid: number;
      recordsInvalid: number;
    },
  ) {
    super(message, {
      collectionRunId: details.collectionRunId,
      externalRunId: details.externalRunId,
    });
    this.name = "SentinelQuarantineError";
    this.incidentId = details.incidentId;
    this.sourceId = details.sourceId;
    this.providerId = details.providerId;
    this.reasonCodes = details.reasonCodes;
    this.recordsSeen = details.recordsSeen;
    this.recordsValid = details.recordsValid;
    this.recordsInvalid = details.recordsInvalid;
  }
}

/** Health summary attached to a successful ingestion result. */
export interface SentinelIngestionSummary {
  status: SentinelStatus;
  reasonCodes: SentinelReasonCode[];
  recordsSeen: number;
  recordsValid: number;
  recordsInvalid: number;
  summary: string;
}

/**
 * Either name a configured production source and let the registry resolve its
 * contract, or supply a contract directly. Supplying neither does not compile,
 * so no caller can reach the gate without a contract governing the payload.
 */
export type SentinelContractSelection =
  | { target: SourceHealthContractTarget; contract?: SourceHealthContract<unknown> }
  | { target?: undefined; contract: SourceHealthContract<unknown> };

export type AssertSentinelSafeInput = SentinelContractSelection & {
  source: {
    id: string;
    providerId: string;
    collectorId?: string | null;
    sourceUrl: string;
    label?: string | null;
  };
  rawRecords: unknown[];
  collectorError?: Error | string | null;
  observedAt: string;
  runId: string;
  externalRunId?: string | null;
  repository?: SentinelRepository;
  /** Closes the collection run before the quarantine error propagates. */
  failRun: (message: string, details: Json) => Promise<unknown>;
};

function resolveContract(input: AssertSentinelSafeInput): SourceHealthContract<unknown> {
  if (input.contract) return input.contract;
  // The union guarantees a target whenever no contract was supplied; this
  // check keeps that guarantee true at runtime for untyped callers.
  if (!input.target) {
    throw new Error("assertSentinelSafe requires either a contract or a source target");
  }
  return createSourceHealthContractFor(input.target, input.source.id);
}

/**
 * Runs the gate and either returns the safe decision or throws. There is no
 * third outcome and no way to opt out: a caller that skips this call would
 * have to be written to skip it deliberately.
 */
export async function assertSentinelSafe(
  input: AssertSentinelSafeInput,
): Promise<Extract<SentinelGateDecision, { safe: true }>> {
  const contract = resolveContract(input);

  const decision = await evaluateSentinelGate({
    contract,
    source: input.source,
    rawRecords: input.rawRecords,
    collectorError: input.collectorError ?? null,
    observedAt: input.observedAt,
    runId: input.runId,
    repository: input.repository,
  });

  if (decision.safe) return decision;

  await input.failRun(decision.evaluation.summary, {
    sentinelIncidentId: decision.incident.id,
    reasonCodes: decision.evaluation.reasonCodes,
    recordsSeen: decision.evaluation.recordsSeen,
    recordsValid: decision.evaluation.recordsValid,
    recordsInvalid: decision.evaluation.recordsInvalid,
  });

  throw new SentinelQuarantineError(decision.evaluation.summary, {
    collectionRunId: input.runId,
    externalRunId: input.externalRunId ?? undefined,
    incidentId: decision.incident.id,
    sourceId: input.source.id,
    providerId: input.source.providerId,
    reasonCodes: decision.evaluation.reasonCodes,
    recordsSeen: decision.evaluation.recordsSeen,
    recordsValid: decision.evaluation.recordsValid,
    recordsInvalid: decision.evaluation.recordsInvalid,
  });
}

export function toSentinelSummary(
  decision: Extract<SentinelGateDecision, { safe: true }>,
): SentinelIngestionSummary {
  return {
    status: decision.evaluation.status,
    reasonCodes: decision.evaluation.reasonCodes,
    recordsSeen: decision.evaluation.recordsSeen,
    recordsValid: decision.evaluation.recordsValid,
    recordsInvalid: decision.evaluation.recordsInvalid,
    summary: decision.evaluation.summary,
  };
}
