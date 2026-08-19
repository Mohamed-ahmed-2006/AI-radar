import { handleModelExplorerRequest } from "@/lib/explorer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Model Explorer: every canonical model with its current trusted pricing,
 * capability and lifecycle evidence, plus provenance for each domain.
 *
 * Filters are deterministic and fail closed — unknown evidence never satisfies
 * a requirement:
 *
 *   ?provider=openai,anthropic
 *   &maxInputPrice=3&maxOutputPrice=15
 *   &minContext=200000&minMaxOutputTokens=8192
 *   &visionRequired=true&toolCallingRequired=true
 *   &activeOnly=true&lifecycleState=active,legacy
 *   &family=claude&stage=stable
 *   &inputModality=text,image&outputModality=text
 *   &q=sonnet&sort=input_price&limit=100
 */
export function GET(request: Request): Promise<Response> {
  return handleModelExplorerRequest(request);
}
