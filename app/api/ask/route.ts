import { NextResponse } from "next/server";

import { askQueryFromParams, getAskAdapter } from "@/lib/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Natural-language query in, grounded read model out.
 *
 * This route does not interpret English, rank models, or walk change events.
 * The installed adapter does that. Claude's grounded NL backend can replace
 * the fixture adapter without changing this handler.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = askQueryFromParams(searchParams);
    const adapter = getAskAdapter();
    const result = await adapter.ask(query);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read Ask AI Radar";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { query?: unknown };
    const query = typeof body.query === "string" ? body.query : "";
    const adapter = getAskAdapter();
    const result = await adapter.ask(query);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read Ask AI Radar";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
