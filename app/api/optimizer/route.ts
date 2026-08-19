import {
  handleStackOptimizerGet,
  handleStackOptimizerPost,
} from "@/lib/optimizer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stack Optimizer: a stated monthly workload in, a deterministic ranking out.
 *
 * GET carries the request in the query string. POST carries the same shape as
 * JSON. Neither verb accepts free text, and neither path lets a language model
 * calculate a price or choose a rank.
 */
export function GET(request: Request): Promise<Response> {
  return handleStackOptimizerGet(request);
}

export function POST(request: Request): Promise<Response> {
  return handleStackOptimizerPost(request);
}
