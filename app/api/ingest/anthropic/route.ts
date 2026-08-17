import { handleProviderIngest, ingestAnthropicPricing } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return handleProviderIngest(request, () => ingestAnthropicPricing({ triggeredBy: "manual-api" }));
}
