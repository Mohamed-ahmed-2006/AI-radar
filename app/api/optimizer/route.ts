import { NextResponse } from "next/server";

import {
  getOptimizerAdapter,
  optimizerInputFromParams,
  optimizerInputWithDefaults,
} from "@/lib/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Presentation-state optimizer controls in, ranked read model out.
 *
 * This route does not rank, filter, or estimate cost. The installed adapter
 * calls `optimizeStack`; eligibility, arithmetic and order live there. Client
 * refetch and the Optimizer page share that same projection.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const input = optimizerInputWithDefaults(
      optimizerInputFromParams(searchParams),
      searchParams,
    );
    const adapter = getOptimizerAdapter();
    const result = await adapter.optimize(input);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read the optimizer";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
