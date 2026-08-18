import { NextResponse } from "next/server";
import {
  type EvidenceCategory,
  type RelativeDateRange,
  type TemporalChangeType,
  type TemporalQuery,
  queryTemporalIntelligence,
} from "@/lib/intelligence";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const providerParam = searchParams.get("provider");
    const providers = providerParam
      ? providerParam.includes(",")
        ? providerParam.split(",").map((s) => s.trim())
        : providerParam.trim()
      : undefined;

    const modelParam = searchParams.get("model");
    const models = modelParam
      ? modelParam.includes(",")
        ? modelParam.split(",").map((s) => s.trim())
        : modelParam.trim()
      : undefined;

    const categoriesParam = searchParams.get("categories");
    const categories = categoriesParam
      ? (categoriesParam.split(",").map((s) => s.trim()) as EvidenceCategory[])
      : undefined;

    const typesParam = searchParams.get("types");
    const types = typesParam
      ? (typesParam.split(",").map((s) => s.trim()) as TemporalChangeType[])
      : undefined;

    const range = (searchParams.get("range") as RelativeDateRange) || "30d";
    const since = searchParams.get("since") || undefined;
    const until = searchParams.get("until") || undefined;
    const significantOnly = searchParams.get("significantOnly") === "true";
    const demo = searchParams.get("demo") === "true";
    const includeSummary = searchParams.get("includeSummary") !== "false";
    const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : 100;
    const offset = searchParams.get("offset") ? Number(searchParams.get("offset")) : 0;
    const sort = (searchParams.get("sort") as "desc" | "asc") || "desc";
    const referenceDate = searchParams.get("referenceDate") || undefined;

    const query: TemporalQuery = {
      provider: providers,
      model: models,
      family: searchParams.get("family") || undefined,
      range,
      since,
      until,
      categories,
      types,
      significantOnly,
      limit,
      offset,
      sort,
      demo,
      includeSummary,
      referenceDate,
    };

    const bundle = await queryTemporalIntelligence(query);
    return NextResponse.json(bundle);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to query temporal changes";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
