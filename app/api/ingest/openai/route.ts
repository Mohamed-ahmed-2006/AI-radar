import { handleProviderIngest, ingestOpenAiPricing, isAuthorizedIngestRequest } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export { isAuthorizedIngestRequest };

export function POST(request: Request): Promise<Response> {
  return handleProviderIngest(request, () => ingestOpenAiPricing({ triggeredBy: "manual-api" }));
}
