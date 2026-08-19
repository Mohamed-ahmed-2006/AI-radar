import { handleProvenanceRequest } from "@/lib/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Provenance for one trusted value or event:
 *
 *   GET /api/provenance?kind=pricing_snapshot&id=<uuid>
 *   GET /api/provenance?kind=lifecycle_snapshot&id=<uuid>
 *   GET /api/provenance?kind=change_event&id=<uuid>
 *
 * Answers provider, source, source URL, collector id, observed time, collection
 * run, snapshot id, trust state and authority domain. The `kind` union is what
 * makes it extensible: a future evidence table is a new kind, not a new API.
 */
export function GET(request: Request): Promise<Response> {
  return handleProvenanceRequest(request);
}
