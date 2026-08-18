/**
 * Scheduler authorization.
 *
 * Two credentials are accepted, both compared in constant time by the existing
 * ingest helper:
 *
 *   * `Authorization: Bearer $CRON_SECRET` — what Vercel Cron sends once
 *     CRON_SECRET is set on the project.
 *   * `x-ai-radar-ingest-secret: $AI_RADAR_INGEST_SECRET` — the convention the
 *     manual ingest routes already use, so operators keep one habit.
 *
 * Fails closed: with neither secret configured the endpoint is unreachable
 * rather than open. The `x-vercel-cron` header is metadata, not a credential,
 * and is never treated as one.
 */

import { secretsMatch } from "../pipeline";

export type SchedulerPrincipal = "vercel-cron" | "ingest-secret";

export type SchedulerAuthorization =
  | { authorized: true; principal: SchedulerPrincipal }
  | {
      authorized: false;
      reason: "not_configured" | "missing_credentials" | "invalid_credentials";
    };

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  if (scheme.toLowerCase() !== "bearer" || rest.length === 0) return null;
  return rest.join(" ").trim() || null;
}

export function authorizeSchedulerRequest(request: Request): SchedulerAuthorization {
  const cronSecret = process.env.CRON_SECRET;
  const ingestSecret = process.env.AI_RADAR_INGEST_SECRET;
  if (!cronSecret && !ingestSecret) {
    return { authorized: false, reason: "not_configured" };
  }

  const bearer = bearerToken(request);
  const ingestHeader = request.headers.get("x-ai-radar-ingest-secret");
  if (!bearer && !ingestHeader) {
    return { authorized: false, reason: "missing_credentials" };
  }
  if (secretsMatch(bearer, cronSecret)) {
    return { authorized: true, principal: "vercel-cron" };
  }
  if (secretsMatch(ingestHeader, ingestSecret)) {
    return { authorized: true, principal: "ingest-secret" };
  }
  // A cron secret presented in the ingest header (or the reverse) is still a
  // valid operator credential; only an unmatched secret is rejected.
  if (secretsMatch(ingestHeader, cronSecret)) {
    return { authorized: true, principal: "vercel-cron" };
  }
  if (secretsMatch(bearer, ingestSecret)) {
    return { authorized: true, principal: "ingest-secret" };
  }
  return { authorized: false, reason: "invalid_credentials" };
}

export function isAuthorizedSchedulerRequest(request: Request): boolean {
  return authorizeSchedulerRequest(request).authorized;
}

/** Uniform 401 with no detail about which secret was expected. */
export function schedulerUnauthorizedResponse(): Response {
  return Response.json({ success: false, error: "unauthorized" }, { status: 401 });
}
