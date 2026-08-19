/**
 * Lightweight in-process rate limiting for mutating and manually triggered
 * endpoints.
 *
 * Deliberately small. This is a fixed-window counter in module memory: no
 * Redis, no database round trip, no new infrastructure. That buys a real
 * property and not more:
 *
 *   * It bounds how fast one caller — or one leaked operator session — can
 *     drive an endpoint that costs real Bright Data quota or real compute.
 *
 * What it is not: a distributed quota. On a serverless platform each instance
 * keeps its own counters, so the effective ceiling is `limit × live instances`
 * and a cold start resets the window. The primary control on expensive
 * endpoints is authorization — the demo's mutating actions require an operator
 * credential, so a public visitor cannot reach them at all. This is the second
 * line of defence, sized accordingly.
 */

export interface RateLimitPolicy {
  /** Requests permitted per window, per identity. */
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix ms at which the current window ends. */
  resetAt: number;
  retryAfterSeconds: number;
}

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Bounded so a hostile spread of identities cannot grow the map without limit. */
const MAX_TRACKED_KEYS = 5_000;

function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export function consumeRateLimit(
  bucket: string,
  identity: string,
  policy: RateLimitPolicy,
  now: number = Date.now(),
): RateLimitDecision {
  const key = `${bucket}:${identity}`;
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    if (windows.size >= MAX_TRACKED_KEYS) sweep(now);
    // Still full of live windows: refuse rather than grow without bound.
    if (windows.size >= MAX_TRACKED_KEYS) {
      const resetAt = now + policy.windowMs;
      return {
        allowed: false,
        limit: policy.limit,
        remaining: 0,
        resetAt,
        retryAfterSeconds: Math.ceil(policy.windowMs / 1000),
      };
    }
    const resetAt = now + policy.windowMs;
    windows.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      limit: policy.limit,
      remaining: policy.limit - 1,
      resetAt,
      retryAfterSeconds: 0,
    };
  }

  if (existing.count >= policy.limit) {
    return {
      allowed: false,
      limit: policy.limit,
      remaining: 0,
      resetAt: existing.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    limit: policy.limit,
    remaining: policy.limit - existing.count,
    resetAt: existing.resetAt,
    retryAfterSeconds: 0,
  };
}

/** Test seam. Never called from request handling. */
export function resetRateLimits(): void {
  windows.clear();
}

/**
 * A stable-enough identity for one caller.
 *
 * `x-forwarded-for` is client-controlled in general; behind Vercel it is set by
 * the platform, and the leftmost entry is the client. It is used only to spread
 * counters across callers, never to authorize anything, so a spoofed value buys
 * an attacker their own bucket and nothing else. `unknown` is a shared bucket
 * by design: an unattributable caller is rate limited collectively.
 */
export function rateLimitIdentity(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  const headers: Record<string, string> = {
    "ratelimit-limit": String(decision.limit),
    "ratelimit-remaining": String(decision.remaining),
    "ratelimit-reset": String(Math.max(0, Math.ceil((decision.resetAt - Date.now()) / 1000))),
  };
  if (!decision.allowed) headers["retry-after"] = String(decision.retryAfterSeconds);
  return headers;
}

export function rateLimitedResponse(decision: RateLimitDecision, message: string): Response {
  return Response.json(
    { success: false, error: "rate_limited", message, retryAfterSeconds: decision.retryAfterSeconds },
    { status: 429, headers: rateLimitHeaders(decision) },
  );
}

/**
 * The policies, in one place so the cost of each endpoint is legible.
 *
 * `healingDemoExpensive` covers the steps that run a real collector or a real
 * Scraper Studio refactor. It is deliberately the tightest: those are the only
 * requests in the product that spend Bright Data quota on demand.
 */
export const RATE_LIMIT_POLICIES = {
  /** Guessing an operator credential. */
  operatorUnlock: { limit: 5, windowMs: 60_000 },
  /** Collector runs and AI-Flow refactors on the demo source. */
  healingDemoExpensive: { limit: 8, windowMs: 10 * 60_000 },
  /** Cheap demo steps: state transitions with no outbound job. */
  healingDemoCheap: { limit: 60, windowMs: 60_000 },
  /** Manual fleet trigger — the scheduled path is unaffected. */
  manualOrchestration: { limit: 6, windowMs: 10 * 60_000 },
  /** Manual per-provider ingest. */
  manualIngest: { limit: 12, windowMs: 10 * 60_000 },
  /** Deterministic in-memory simulation: no quota, but unbounded CPU. */
  simulation: { limit: 20, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitPolicy>;
