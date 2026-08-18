import { handleProviderIngest, ingestOpenAiPricing } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return handleProviderIngest(request, () => ingestOpenAiPricing({ triggeredBy: "manual-api" }));
}
