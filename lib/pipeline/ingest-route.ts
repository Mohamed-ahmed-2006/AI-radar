import { timingSafeEqual } from "node:crypto";

import {
  PricingIngestionError,
  type OpenAiPricingIngestionResult,
} from "./openai-pricing";

function secretsMatch(provided: string | null, expected: string | undefined): boolean {
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
    });
  } catch (error) {
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
