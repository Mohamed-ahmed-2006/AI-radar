import { handleSourceCatalogRequest } from "@/lib/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Source catalog: every monitored source with its identity, contract and
 * current health. Read-only and public; the detail endpoint carries the rest.
 */
export function GET(): Promise<Response> {
  return handleSourceCatalogRequest();
}
