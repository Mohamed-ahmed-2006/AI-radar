/**
 * HTTP surface for the self-healing demonstration.
 *
 * Two endpoints and nothing else:
 *
 *   * a protected POST that runs one named step
 *   * a public GET that reads the current state
 *
 * The security posture is deliberately narrow. The request body carries a
 * single enum — which *step* to run — and never a source, a collector id, a URL
 * or a prompt. There is therefore no request that can aim the demo at another
 * collector, scrape an arbitrary page, or push arbitrary text into a Bright
 * Data refactor.
 */

import {
  authorizeSchedulerRequest,
  schedulerUnauthorizedResponse,
} from "../orchestration/auth";
import {
  DemoHealingOrchestrator,
  isDemoAction,
  type DemoAction,
  type DemoOrchestratorDependencies,
} from "./orchestrator";
import { getDemoHealingReadModel } from "./read-model";
import { DemoSourceNotConfiguredError } from "./source";

async function readAction(request: Request): Promise<string | null> {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("action");
  if (fromQuery) return fromQuery;
  try {
    const body = (await request.json()) as { action?: unknown };
    return typeof body.action === "string" ? body.action : null;
  } catch {
    return null;
  }
}

function notConfiguredResponse(error: DemoSourceNotConfiguredError): Response {
  // The message names an environment variable, never its value.
  return Response.json(
    { success: false, error: "demo_not_configured", message: error.message },
    { status: 503 },
  );
}

/**
 * Runs one demo step. Requires the same operator credential the collection
 * scheduler requires, so a mutating demo action is never reachable anonymously.
 */
export async function handleDemoActionRequest(
  request: Request,
  dependencies: DemoOrchestratorDependencies = {},
): Promise<Response> {
  const authorization = authorizeSchedulerRequest(request);
  if (!authorization.authorized) return schedulerUnauthorizedResponse();

  const requested = await readAction(request);
  if (!isDemoAction(requested)) {
    return Response.json(
      { success: false, error: "unknown_action", action: requested },
      { status: 400 },
    );
  }
  const action: DemoAction = requested;

  let orchestrator: DemoHealingOrchestrator;
  try {
    orchestrator = new DemoHealingOrchestrator(dependencies);
  } catch (error) {
    if (error instanceof DemoSourceNotConfiguredError) return notConfiguredResponse(error);
    throw error;
  }

  try {
    const result = await orchestrator.execute(action);
    const readModel = await getDemoHealingReadModel({
      configuration: orchestrator.getConfiguration(),
      harness: orchestrator.getHarnessRepository(),
      includeOperatorDetail: true,
    });
    return Response.json(
      {
        success: result.status !== "failed",
        principal: authorization.principal,
        action: result.action,
        // A refusal is the system working. It is reported as a refusal, with a
        // 200, rather than dressed up as a transport error.
        result: {
          status: result.status,
          phase: result.phase,
          summary: result.summary,
          detail: result.detail ?? null,
        },
        demo: readModel,
      },
      { status: result.status === "failed" ? 500 : 200 },
    );
  } catch (error) {
    if (error instanceof DemoSourceNotConfiguredError) return notConfiguredResponse(error);
    return Response.json(
      {
        success: false,
        error: "demo_action_failed",
        message: error instanceof Error ? error.message : "Demo action failed",
      },
      { status: 500 },
    );
  }
}

/**
 * Reads the demo state. Public so a dashboard can poll it; operator detail
 * (collector id, prompts, job ids, sampled records) is added only when the
 * caller presents the operator credential.
 */
export async function handleDemoStatusRequest(
  request: Request,
  dependencies: DemoOrchestratorDependencies = {},
): Promise<Response> {
  let orchestrator: DemoHealingOrchestrator;
  try {
    orchestrator = new DemoHealingOrchestrator(dependencies);
  } catch (error) {
    if (error instanceof DemoSourceNotConfiguredError) return notConfiguredResponse(error);
    throw error;
  }

  try {
    const readModel = await getDemoHealingReadModel({
      configuration: orchestrator.getConfiguration(),
      harness: orchestrator.getHarnessRepository(),
      includeOperatorDetail: authorizeSchedulerRequest(request).authorized,
    });
    return Response.json(readModel);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to read demo status",
      },
      { status: 500 },
    );
  }
}
