import { handleAskGet, handleAskPost } from "@/lib/ask";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ask AI Radar: a natural-language question in, a grounded answer out.
 *
 * The route does not interpret English, rank models, or walk change events.
 * `lib/ask` compiles a typed plan and the deterministic engines execute it.
 * There is no pretrained-fact fallback.
 */
export function GET(request: Request): Promise<Response> {
  return handleAskGet(request);
}

export function POST(request: Request): Promise<Response> {
  return handleAskPost(request);
}
