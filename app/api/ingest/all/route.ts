import { ingestAllPricing, isAuthorizedIngestRequest } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorizedIngestRequest(request)) {
    return Response.json({ success: false, error: "unauthorized" }, { status: 401 });
  }
  const providers = await ingestAllPricing({ triggeredBy: "manual-api-all" });
  return Response.json({
    success: providers.every((provider) => provider.success),
    status: providers.every((provider) => provider.success) ? "completed" : "partial",
    providers,
  });
}
