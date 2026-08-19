import { NextResponse } from "next/server";

import {
  explorerFiltersFromParams,
  getModelExplorerAdapter,
} from "@/lib/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Presentation-state filters in, catalog rows out. Matching is the adapter's
 * job so a richer read model can take over without changing this route.
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
