import { NextResponse } from "next/server";

import {
  explorerFiltersFromParams,
  getModelExplorerAdapter,
} from "@/lib/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Model Explorer screen's own projection, for the client-side refetch that
 * happens when a filter control changes.
 *
 * Presentation-state filters in, explorer rows out. The route parses the
 * control state and hands it to the installed adapter; the adapter translates
 * it into the canonical explorer filters and the read model does the matching.
 * No filter rule lives here or in any component.
 *
 * The canonical, fully-parameterised model read API is `/api/models`.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const adapter = getModelExplorerAdapter();
    const catalog = await adapter.listModels(explorerFiltersFromParams(searchParams));
    return NextResponse.json(catalog);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read the model catalog";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
