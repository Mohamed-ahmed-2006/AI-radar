/**
 * HTTP shape of the Ask AI Radar endpoint.
 *
 * Kept in `lib` so request parsing, the 400 contract and the response body are
 * unit-testable without a Next.js server, and so the explorer port and
 * temporal corpus can be injected in tests.
 *
 * The only free-text field is `question` (aliased as `query` for the product
 * seam). There is no SQL, no sort expression, and no way to reach the
 * database except through the typed plan the interpreter emits.
 */

import { z } from "zod";

import { answerQuestion, type AskOptions } from "./execute";

const AskRequestSchema = z.object({
  question: z.string().max(4000),
  workload: z
    .object({
      monthlyInputTokens: z.number().finite().nonnegative(),
      monthlyOutputTokens: z.number().finite().nonnegative(),
    })
    .optional(),
  demo: z.boolean().optional(),
  referenceDate: z.string().min(1).optional(),
});

export type AskRequestInput = z.infer<typeof AskRequestSchema>;

function badRequest(error: z.ZodError): Response {
  return Response.json(
    {
      error: "Invalid ask request",
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
    { status: 400 },
  );
}

function serverError(): Response {
  return Response.json({ error: "Failed to answer the question" }, { status: 500 });
}

function readQuestion(params: URLSearchParams): string {
  return (params.get("q") ?? params.get("query") ?? params.get("question") ?? "").trim();
}

export function parseAskParams(params: URLSearchParams): unknown {
  const demoRaw = params.get("demo");
  return {
    question: readQuestion(params),
    demo: demoRaw === null ? undefined : demoRaw === "true" || demoRaw === "1",
    referenceDate: params.get("referenceDate")?.trim() || undefined,
  };
}

async function run(candidate: unknown, options: AskOptions): Promise<Response> {
  const parsed = AskRequestSchema.safeParse(candidate);
  if (!parsed.success) return badRequest(parsed.error);

  try {
    return Response.json(
      await answerQuestion(parsed.data.question, {
        ...options,
        workload: parsed.data.workload ?? options.workload,
        demo: parsed.data.demo ?? options.demo,
        referenceDate: parsed.data.referenceDate ?? options.referenceDate,
      }),
    );
  } catch {
    return serverError();
  }
}

export async function handleAskGet(
  request: Request,
  options: AskOptions = {},
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  return run(parseAskParams(searchParams), options);
}

export async function handleAskPost(
  request: Request,
  options: AskOptions = {},
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const question =
    typeof record.question === "string"
      ? record.question
      : typeof record.query === "string"
        ? record.query
        : "";

  return run(
    {
      question,
      workload: record.workload,
      demo: record.demo,
      referenceDate: record.referenceDate,
    },
    options,
  );
}
