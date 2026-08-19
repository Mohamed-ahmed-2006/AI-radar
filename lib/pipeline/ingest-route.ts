import { timingSafeEqual } from "node:crypto";

import {
  PricingIngestionError,
  type OpenAiPricingIngestionResult,
} from "./openai-pricing";
import { SentinelQuarantineError } from "./sentinel-gate";
import {
  consumeRateLimit,
  rateLimitedResponse,
  rateLimitIdentity,
  RATE_LIMIT_POLICIES,
} from "../rate-limit";

/** Constant-time shared-secret comparison. Absent secrets never match. */
export function secretsMatch(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

export function isAuthorizedIngestRequest(request: Request): boolean {
  return secretsMatch(
    request.headers.get("x-ai-radar-ingest-secret"),
    process.env.AI_RADAR_INGEST_SECRET,
  );
}

export async function handleProviderIngest(
  request: Request,
  ingest: () => Promise<OpenAiPricingIngestionResult>,
): Promise<Response> {
  if (!isAuthorizedIngestRequest(request)) {
    return Response.json({ success: false, error: "unauthorized" }, { status: 401 });
  }
  // Every manual ingest is a real Bright Data collector job. The credential is
  // the control; this bounds the damage a leaked or shared one can do.
  const decision = consumeRateLimit(
    "manual-ingest",
    rateLimitIdentity(request),
    RATE_LIMIT_POLICIES.manualIngest,
  );
  if (!decision.allowed) {
    return rateLimitedResponse(decision, "Manual ingest is rate limited.");
  }
  try {
    const result = await ingest();
    return Response.json({
      success: true,
      status: result.idempotent ? "already_processed" : "completed",
      collectionRunId: result.collectionRunId,
      externalBrightDataRunId: result.externalRunId ?? null,
      acceptedCount: result.acceptedCount,
      rejectedCount: result.rejectedCount,
      changesDetected: result.changesDetected,
      durationMs: result.durationMs,
      sentinelStatus: result.sentinel?.status ?? null,
    });
  } catch (error) {
    // A quarantine is a refusal, not a server fault: the collection was
    // rejected by Sentinel and canonical state was left untouched.
    if (error instanceof SentinelQuarantineError) {
      return Response.json({
        success: false,
        status: "quarantined",
        collectionRunId: error.collectionRunId ?? null,
        externalBrightDataRunId: error.externalRunId ?? null,
        sentinelIncidentId: error.incidentId,
        reasonCodes: error.reasonCodes,
        recordsSeen: error.recordsSeen,
        recordsValid: error.recordsValid,
        recordsInvalid: error.recordsInvalid,
        error: "sentinel_quarantined",
      }, { status: 409 });
    }
    const ingestionError = error instanceof PricingIngestionError ? error : undefined;
    return Response.json({
      success: false,
      status: "failed",
      collectionRunId: ingestionError?.collectionRunId ?? null,
      externalBrightDataRunId: ingestionError?.externalRunId ?? null,
      error: "ingestion_failed",
    }, { status: 500 });
  }
}
