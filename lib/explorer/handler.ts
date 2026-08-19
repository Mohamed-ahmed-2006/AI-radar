/**
 * HTTP shape of the model explorer, detail and compare endpoints.
 *
 * Kept in `lib` rather than in the route files so query parsing, the 400/404
 * contract and the response body are unit-testable without a Next.js server,
 * and so the read port can be injected in tests.
 *
 * Every handler here is a read. Model identity, pricing, lifecycle and
 * capability state are written by ingestion through the service-role client,
 * never over HTTP.
 */

import type { LifecycleState } from "../supabase/types";
import { compareModels, getModelDetail, getModelExplorer } from "./read-model";
import type { ModelExplorerReadPort } from "./port";
import type { ModelExplorerFilters, ModelExplorerSort } from "./types";

export interface ModelHandlerOptions {
  port?: ModelExplorerReadPort;
  now?: () => Date;
}

/** Upstream error text can echo collector or database detail; never returned. */
function serverError(message: string): Response {
  return Response.json({ error: message }, { status: 500 });
}

function readList(params: URLSearchParams, name: string): string[] | undefined {
  const values = params.getAll(name).flatMap((value) => value.split(","));
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}

/** A malformed number is not a filter: it is ignored rather than guessed at. */
function readNumber(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

/** Only an explicit "true" turns a requirement on. */
function readRequirement(params: URLSearchParams, name: string): boolean | undefined {
  const raw = params.get(name);
  if (raw === null) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return undefined;
}

const LIFECYCLE_STATES: readonly LifecycleState[] = [
  "active",
  "legacy",
  "deprecated",
  "retired",
];

const SORTS: readonly ModelExplorerSort[] = [
  "provider",
  "input_price",
  "output_price",
  "context_window",
  "last_verified",
];

export function parseExplorerFilters(params: URLSearchParams): ModelExplorerFilters {
  const lifecycleStates = readList(params, "lifecycleState")?.filter(
    (value): value is LifecycleState =>
      (LIFECYCLE_STATES as readonly string[]).includes(value),
  );

  return {
    providers: readList(params, "provider"),
    maxInputPrice: readNumber(params, "maxInputPrice"),
    maxOutputPrice: readNumber(params, "maxOutputPrice"),
    minContextWindow: readNumber(params, "minContext"),
    minMaxOutputTokens: readNumber(params, "minMaxOutputTokens"),
    visionRequired: readRequirement(params, "visionRequired"),
    toolCallingRequired: readRequirement(params, "toolCallingRequired"),
    activeOnly: readRequirement(params, "activeOnly"),
    lifecycleStates: lifecycleStates?.length ? lifecycleStates : undefined,
    families: readList(params, "family"),
    stages: readList(params, "stage"),
    inputModalities: readList(params, "inputModality"),
    outputModalities: readList(params, "outputModality"),
    search: params.get("q")?.trim() || undefined,
  };
}

function parseSort(params: URLSearchParams): ModelExplorerSort | undefined {
  const raw = params.get("sort")?.trim();
  if (!raw) return undefined;
  return (SORTS as readonly string[]).includes(raw)
    ? (raw as ModelExplorerSort)
    : undefined;
}

const MAX_EXPLORER_LIMIT = 500;
const MAX_COMPARE_IDS = 8;

export async function handleModelExplorerRequest(
  request: Request,
  options: ModelHandlerOptions = {},
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const limit = (() => {
    const parsed = Number(searchParams.get("limit"));
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return Math.min(MAX_EXPLORER_LIMIT, Math.floor(parsed));
  })();

  try {
    return Response.json(
      await getModelExplorer({
        ...options,
        filters: parseExplorerFilters(searchParams),
        sort: parseSort(searchParams),
        limit,
      }),
    );
  } catch {
    return serverError("Failed to load model explorer");
  }
}

export async function handleModelDetailRequest(
  request: Request,
  canonicalModelId: string,
  options: ModelHandlerOptions = {},
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const historyLimit = (() => {
    const parsed = Number(searchParams.get("history"));
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return Math.min(200, Math.floor(parsed));
  })();
  const changeLimit = (() => {
    const parsed = Number(searchParams.get("changes"));
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return Math.min(200, Math.floor(parsed));
  })();

  if (!canonicalModelId.trim()) {
    return Response.json({ error: "Provide a canonical model id" }, { status: 400 });
  }

  try {
    const detail = await getModelDetail(canonicalModelId.trim(), {
      ...options,
      pricingHistoryLimit: historyLimit,
      capabilityHistoryLimit: historyLimit,
      lifecycleHistoryLimit: historyLimit,
      changeLimit,
    });
    if (!detail) {
      return Response.json({ error: "Model not found" }, { status: 404 });
    }
    return Response.json(detail);
  } catch {
    return serverError("Failed to load model detail");
  }
}

/**
 * `GET /api/models/compare?ids=<uuid>,<uuid>`
 *
 * Canonical ids only. Comparing by display name is refused by omission: there
 * is no name parameter to pass.
 */
export async function handleModelCompareRequest(
  request: Request,
  options: ModelHandlerOptions = {},
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const ids = readList(searchParams, "ids") ?? [];

  if (ids.length < 2) {
    return Response.json(
      { error: "Provide at least two canonical model ids as ids=<id>,<id>" },
      { status: 400 },
    );
  }
  if (new Set(ids).size > MAX_COMPARE_IDS) {
    return Response.json(
      { error: `Compare at most ${MAX_COMPARE_IDS} models at a time` },
      { status: 400 },
    );
  }

  try {
    return Response.json(await compareModels(ids, options));
  } catch {
    return serverError("Failed to compare models");
  }
}
