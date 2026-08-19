/**
 * Short-lived operator sessions for browser-driven operator controls.
 *
 * The problem this solves is narrow. The scheduler credential is a header
 * secret: `curl` can send it, a page in a judge's browser cannot — not without
 * shipping the secret into the bundle, which is exactly what must never happen.
 * So the healing demo's buttons were only reachable by setting
 * `AI_RADAR_HEALING_DEMO_OPEN_CONTROLS=1`, which opens real Bright Data jobs to
 * anyone who finds the URL. That flag must not be what a public deployment
 * relies on.
 *
 * The mechanism here is the standard one:
 *
 *   1. An operator POSTs the credential once to `/api/operator/session`.
 *   2. The server verifies it in constant time and returns an `HttpOnly`,
 *      `Secure`, `SameSite=Strict` cookie.
 *   3. The cookie holds `expiry.HMAC(expiry)`, signed with the credential —
 *      not the credential itself. It is unforgeable without the secret, it
 *      expires on its own, and JavaScript in the page can never read it.
 *   4. Subsequent mutating requests from that browser are authorized by the
 *      cookie.
 *
 * The secret therefore never enters the bundle, never enters a URL, and never
 * reaches client JavaScript. `SameSite=Strict` means another origin cannot use
 * a live session to drive the demo, so the cookie needs no separate CSRF token.
 *
 * Sessions grant no new authority: they are exactly the scheduler credential,
 * time-boxed. The demo's own allowlists — one action enum, one collector, two
 * URLs — are unchanged and still the real containment.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const OPERATOR_SESSION_COOKIE = "ai_radar_operator";

/** One hour: long enough to run a demo, short enough to not be a standing key. */
export const OPERATOR_SESSION_TTL_SECONDS = 60 * 60;

export type OperatorSessionRejection =
  | "not_configured"
  | "missing_credentials"
  | "invalid_credentials";

/**
 * Every credential that may open an operator session, most specific first.
 *
 * `AI_RADAR_OPERATOR_KEY` exists so a deployment can hand a judge a credential
 * that is *not* the cron secret, and rotate it independently. Where it is
 * unset, the existing operator secrets are accepted, so nothing new has to be
 * configured for the mechanism to work.
 */
function operatorCredentials(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.AI_RADAR_OPERATOR_KEY, env.CRON_SECRET, env.AI_RADAR_INGEST_SECRET]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

export function isOperatorSessionConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return operatorCredentials(env).length > 0;
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Mints a session token for a presented credential.
 *
 * Returns null when the credential matches nothing, so a caller cannot tell a
 * misconfigured deployment from a wrong key by the shape of the result.
 */
export function issueOperatorSessionToken(
  presented: string | null | undefined,
  options: { now?: () => number; ttlSeconds?: number; env?: NodeJS.ProcessEnv } = {},
): string | null {
  const candidate = presented?.trim();
  if (!candidate) return null;
  const credentials = operatorCredentials(options.env);
  const matched = credentials.find((secret) => constantTimeEquals(candidate, secret));
  if (!matched) return null;

  const now = options.now ? options.now() : Date.now();
  const ttl = options.ttlSeconds ?? OPERATOR_SESSION_TTL_SECONDS;
  const expiresAt = Math.floor(now / 1000) + ttl;
  return `${expiresAt}.${sign(matched, String(expiresAt))}`;
}

/**
 * Verifies a session token against every configured credential.
 *
 * A token signed with a credential that has since been rotated away stops
 * verifying immediately — rotation is revocation.
 */
export function verifyOperatorSessionToken(
  token: string | null | undefined,
  options: { now?: () => number; env?: NodeJS.ProcessEnv } = {},
): boolean {
  if (!token) return false;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;

  const expiryPart = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!/^\d+$/.test(expiryPart) || !/^[a-f0-9]{64}$/.test(signature)) return false;

  const expiresAt = Number(expiryPart);
  const nowSeconds = Math.floor((options.now ? options.now() : Date.now()) / 1000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds) return false;

  return operatorCredentials(options.env).some((secret) =>
    constantTimeEquals(signature, sign(secret, expiryPart)),
  );
}

/** Minimal cookie parse: the request may legitimately carry unrelated cookies. */
export function readOperatorSessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== OPERATOR_SESSION_COOKIE) continue;
    return decodeURIComponent(part.slice(separator + 1).trim()) || null;
  }
  return null;
}

export function hasOperatorSession(
  request: Request,
  options: { now?: () => number; env?: NodeJS.ProcessEnv } = {},
): boolean {
  return verifyOperatorSessionToken(readOperatorSessionCookie(request), options);
}

/**
 * `Secure` is dropped only for plain-HTTP local development; a browser will not
 * store a `Secure` cookie from `http://localhost` in every configuration, and
 * refusing to work locally is not a security property.
 */
export function operatorSessionCookieHeader(
  token: string,
  options: { ttlSeconds?: number; secure?: boolean } = {},
): string {
  const ttl = options.ttlSeconds ?? OPERATOR_SESSION_TTL_SECONDS;
  const secure = options.secure ?? process.env.NODE_ENV === "production";
  return [
    `${OPERATOR_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${ttl}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearedOperatorSessionCookieHeader(
  options: { secure?: boolean } = {},
): string {
  const secure = options.secure ?? process.env.NODE_ENV === "production";
  return [
    `${OPERATOR_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
