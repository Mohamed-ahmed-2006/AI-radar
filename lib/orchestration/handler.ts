/**
 * HTTP shape of the orchestration endpoints.
 *
 * Kept in `lib` rather than in the route files so the authorization, request
 * parsing and response contract are unit-testable without a Next.js server.
 */

import {
  authorizeSchedulerRequest,
  isAuthorizedSchedulerRequest,
  schedulerUnauthorizedResponse,
} from "./auth";
import { runCollectionFleet, type RunCollectionFleetOptions } from "./fleet";
import {
  getOrchestrationReadModel,
  type GetOrchestrationReadModelOptions,
} from "./read-model";
import { isCollectionSourceKey } from "./registry";
import type { CollectionSourceKey } from "./types";

interface SchedulerRequestSelection {
  sourceKeys?: CollectionSourceKey[];
  force?: boolean;
  invalidKeys: string[];
}

async function readSelection(request: Request): Promise<SchedulerRequestSelection> {
  const requested: string[] = [];
  let force = false;

  const url = new URL(request.url);
  requested.push(...url.searchParams.getAll("source"));
  if (["1", "true", "yes"].includes((url.searchParams.get("force") ?? "").toLowerCase())) {
    force = true;
  }

  if (request.method !== "GET" && request.body) {
    try {
      const body = (await request.json()) as { sources?: unknown; force?: unknown };
      if (Array.isArray(body.sources)) requested.push(...body.sources.map(String));
      if (body.force === true) force = true;
    } catch {
      // An empty or unparsable body means "run everything that is due".
    }
  }

  const invalidKeys = requested.filter((key) => !isCollectionSourceKey(key));
  const sourceKeys = requested.filter(isCollectionSourceKey);
  return {
    sourceKeys: sourceKeys.length > 0 ? sourceKeys : undefined,
    force,
    invalidKeys,
  };
}

/**
 * Runs the fleet for an authorized caller. A per-source failure is reported in
 * the body, not as a transport error; only a fleet where every executed source
 * failed answers 500 so the platform surfaces it.
 */
export async function handleSchedulerRequest(
  request: Request,
  options: RunCollectionFleetOptions = {},
): Promise<Response> {
  const authorization = authorizeSchedulerRequest(request);
  if (!authorization.authorized) return schedulerUnauthorizedResponse();

  const selection = await readSelection(request);
  if (selection.invalidKeys.length > 0) {
    return Response.json(
      { success: false, error: "unknown_source", sources: selection.invalidKeys },
      { status: 400 },
    );
  }

  const trigger = options.trigger ?? (request.method === "GET" ? "cron" : "manual");
  const fleet = await runCollectionFleet({
    ...options,
    trigger,
    sourceKeys: options.sourceKeys ?? selection.sourceKeys,
    force: options.force ?? selection.force,
  });

  return Response.json(
    {
      success: fleet.status !== "failed",
      principal: authorization.principal,
      ...fleet,
    },
    { status: fleet.status === "failed" ? 500 : 200 },
  );
}

/**
 * Read-only orchestration status. Public by design so a dashboard can render
 * it, with raw collector diagnostics added only for authorized callers.
 */
export async function handleOrchestrationStatusRequest(
  request: Request,
  options: GetOrchestrationReadModelOptions = {},
): Promise<Response> {
  try {
    const readModel = await getOrchestrationReadModel({
      ...options,
      includeDiagnostics: options.includeDiagnostics ?? isAuthorizedSchedulerRequest(request),
    });
    return Response.json(readModel);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to read orchestration status",
      },
      { status: 500 },
    );
  }
}
