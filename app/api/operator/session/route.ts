import {
  clearedOperatorSessionCookieHeader,
  hasOperatorSession,
  isOperatorSessionConfigured,
  issueOperatorSessionToken,
  operatorSessionCookieHeader,
  OPERATOR_SESSION_TTL_SECONDS,
} from "@/lib/orchestration/operator-session";
import {
  consumeRateLimit,
  rateLimitedResponse,
  rateLimitIdentity,
  RATE_LIMIT_POLICIES,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Opens an operator session for the browser.
 *
 * This is the production-safe replacement for
 * `AI_RADAR_HEALING_DEMO_OPEN_CONTROLS=1`. An operator posts the credential
 * once; the browser gets an `HttpOnly` signed cookie and nothing else. The
 * credential itself is never returned, never stored client-side, and never
 * appears in a URL — so it stays out of history, referrers and access logs.
 *
 * The response body deliberately says nothing about which credential was
 * expected, or whether one is configured at all.
 */
export async function POST(request: Request): Promise<Response> {
  const decision = consumeRateLimit(
    "operator-unlock",
    rateLimitIdentity(request),
    RATE_LIMIT_POLICIES.operatorUnlock,
  );
  if (!decision.allowed) {
    return rateLimitedResponse(decision, "Too many unlock attempts. Wait and try again.");
  }

  if (!isOperatorSessionConfigured()) {
    // Fail closed: with no credential configured there is nothing to unlock.
    return Response.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  let key: unknown;
  try {
    const body = (await request.json()) as { key?: unknown };
    key = body.key;
  } catch {
    return Response.json({ success: false, error: "invalid_request" }, { status: 400 });
  }

  const token = issueOperatorSessionToken(typeof key === "string" ? key : null);
  if (!token) {
    return Response.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  return Response.json(
    { success: true, expiresInSeconds: OPERATOR_SESSION_TTL_SECONDS },
    { headers: { "set-cookie": operatorSessionCookieHeader(token) } },
  );
}

/** Whether this browser currently holds a session. Reveals no credential. */
export function GET(request: Request): Response {
  return Response.json({
    configured: isOperatorSessionConfigured(),
    active: hasOperatorSession(request),
  });
}

/** Ends the session. Always succeeds, so it is safe to call on sign-out. */
export function DELETE(): Response {
  return Response.json(
    { success: true },
    { headers: { "set-cookie": clearedOperatorSessionCookieHeader() } },
  );
}
