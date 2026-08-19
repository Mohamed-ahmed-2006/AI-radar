/**
 * HTTP shape of the Stack Optimizer endpoint.
 *
 * Kept in `lib` for the same reason the explorer handler is: request parsing,
 * the 400 contract and the response body are unit-testable without a Next.js
 * server, and the read port can be injected in tests.
 *
 * The request is a closed schema. There is no free-text field, no sort
 * expression and no way to reach the database except through the typed
 * constraints below — a caller cannot widen what the optimizer reads, only
 * choose among the constraints it already understands.
 *
 * Both verbs accept the same request. GET carries it in the query string for
 * links and bookmarks; POST carries it as JSON, which is the honest shape for
 * a nested workload and long exclusion lists.
 */

import { z } from "zod";

import { optimizeStack, type StackOptimizerOptions } from "./optimize";
import type { StackOptimizerRequest } from "./types";

const tokenCount = z
  .number()
  .finite()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

const positiveInteger = z.number().int().positive();

const slugList = z.array(z.string().trim().min(1)).max(50);

export const StackOptimizerRequestSchema = z.object({
  workload: z.object({
    monthlyInputTokens: tokenCount,
    monthlyOutputTokens: tokenCount,
  }),
  minContextWindow: positiveInteger.optional(),
  minMaxOutputTokens: positiveInteger.optional(),
  visionRequired: z.boolean().optional(),
  toolCallingRequired: z.boolean().optional(),
  providers: slugList.optional(),
  activeOnly: z.boolean().optional(),
  excludeModelIds: slugList.optional(),
  excludeProviders: slugList.optional(),
  priority: z
    .enum(["lowest_total_cost", "lowest_input_cost", "lowest_output_cost"])
    .optional(),
  limit: positiveInteger.max(500).optional(),
  currency: z.string().trim().length(3).optional(),
});

export type StackOptimizerRequestInput = z.infer<typeof StackOptimizerRequestSchema>;

function readList(params: URLSearchParams, name: string): string[] | undefined {
  const values = params.getAll(name).flatMap((value) => value.split(","));
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}

/** A malformed number is not a constraint: it is rejected, never guessed at. */
function readNumber(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** Only an explicit true turns a requirement on. */
function readFlag(params: URLSearchParams, name: string): boolean | undefined {
  const raw = params.get(name);
  if (raw === null) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return undefined;
}

export function parseOptimizerParams(params: URLSearchParams): unknown {
  return {
    workload: {
      monthlyInputTokens: readNumber(params, "inputTokens") ?? 0,
      monthlyOutputTokens: readNumber(params, "outputTokens") ?? 0,
    },
    minContextWindow: readNumber(params, "minContext"),
    minMaxOutputTokens: readNumber(params, "minMaxOutputTokens"),
    visionRequired: readFlag(params, "visionRequired"),
    toolCallingRequired: readFlag(params, "toolCallingRequired"),
    providers: readList(params, "provider"),
    activeOnly: readFlag(params, "activeOnly"),
    excludeModelIds: readList(params, "excludeModel"),
    excludeProviders: readList(params, "excludeProvider"),
    priority: params.get("priority")?.trim() || undefined,
    limit: readNumber(params, "limit"),
    currency: params.get("currency")?.trim() || undefined,
  };
}

function badRequest(error: z.ZodError): Response {
  return Response.json(
    {
      error: "Invalid optimizer request",
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
    { status: 400 },
  );
}

/** Upstream error text can echo collector or database detail; never returned. */
function serverError(): Response {
  return Response.json({ error: "Failed to run the stack optimizer" }, { status: 500 });
}

async function run(
  candidate: unknown,
  options: StackOptimizerOptions,
): Promise<Response> {
  const parsed = StackOptimizerRequestSchema.safeParse(candidate);
  if (!parsed.success) return badRequest(parsed.error);

  try {
    return Response.json(
      await optimizeStack(parsed.data as StackOptimizerRequest, options),
    );
  } catch {
    return serverError();
  }
}

export async function handleStackOptimizerGet(
  request: Request,
  options: StackOptimizerOptions = {},
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  return run(parseOptimizerParams(searchParams), options);
}

export async function handleStackOptimizerPost(
  request: Request,
  options: StackOptimizerOptions = {},
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  return run(body, options);
}
