/**
 * HTTP shape of the source-detail and provenance endpoints.
 *
 * Kept in `lib` rather than in the route files so request parsing, the 404/400
 * contract and the response body are unit-testable without a Next.js server —
 * and so the read port can be injected in tests instead of reaching Supabase.
 *
 * Every handler here is a read. There is deliberately no POST/PATCH/DELETE
 * counterpart: source configuration, incidents and healing state are written by
 * ingestion and Sentinel through the service-role client, never over HTTP.
 */

import { getProvenance, parseProvenanceReference } from "./provenance";
import type { SourceReadPort } from "./port";
import { getSourceCatalog, getSourceDetail } from "./read-model";

export interface SourceHandlerOptions {
  port?: SourceReadPort;
  now?: () => Date;
}

/**
 * Upstream error text can echo collector output or database detail, so it is
 * never returned to the caller; the status code carries the failure.
 */
function serverError(message: string): Response {
  return Response.json({ error: message }, { status: 500 });
}

export async function handleSourceCatalogRequest(
  options: SourceHandlerOptions = {},
): Promise<Response> {
  try {
    return Response.json(await getSourceCatalog(options));
  } catch {
    return serverError("Failed to load source catalog");
  }
}

const LIMITS = {
  runs: { param: "runs", fallback: 20, max: 100 },
  incidents: { param: "incidents", fallback: 20, max: 100 },
  healing: { param: "healing", fallback: 20, max: 100 },
  observations: { param: "observations", fallback: 50, max: 200 },
} as const;

function readLimit(
  params: URLSearchParams,
  limit: { param: string; fallback: number; max: number },
): number {
  const raw = params.get(limit.param);
  if (raw === null) return limit.fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return limit.fallback;
  return Math.min(limit.max, Math.floor(parsed));
}

export async function handleSourceDetailRequest(
  request: Request,
  sourceId: string,
  options: SourceHandlerOptions = {},
): Promise<Response> {
  const { searchParams } = new URL(request.url);

  try {
    const detail = await getSourceDetail(sourceId, {
      ...options,
      runLimit: readLimit(searchParams, LIMITS.runs),
      incidentLimit: readLimit(searchParams, LIMITS.incidents),
      healingLimit: readLimit(searchParams, LIMITS.healing),
      observationLimit: readLimit(searchParams, LIMITS.observations),
    });

    if (!detail) {
      return Response.json({ error: "Source not found" }, { status: 404 });
    }
    return Response.json(detail);
  } catch {
    return serverError("Failed to load source detail");
  }
}

export async function handleProvenanceRequest(
  request: Request,
  options: SourceHandlerOptions = {},
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const reference = parseProvenanceReference(
    searchParams.get("kind"),
    searchParams.get("id"),
  );

  if (!reference) {
    return Response.json(
      {
        error:
          "Provide kind=pricing_snapshot|lifecycle_snapshot|change_event and a valid id",
      },
      { status: 400 },
    );
  }

  try {
    const record = await getProvenance(reference, { port: options.port });
    if (!record) {
      return Response.json({ error: "Evidence not found" }, { status: 404 });
    }
    return Response.json(record);
  } catch {
    return serverError("Failed to resolve provenance");
  }
}
