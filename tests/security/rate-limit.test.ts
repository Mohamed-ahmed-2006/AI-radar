import assert from "node:assert/strict";
import test from "node:test";

import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
  resetRateLimits,
  RATE_LIMIT_POLICIES,
} from "../../lib/rate-limit";

const POLICY = { limit: 3, windowMs: 60_000 };

test("a caller is allowed up to the limit and then refused", () => {
  resetRateLimits();
  const now = 1_000_000;
  for (let attempt = 1; attempt <= POLICY.limit; attempt += 1) {
    const decision = consumeRateLimit("test", "caller-a", POLICY, now);
    assert.equal(decision.allowed, true, `attempt ${attempt}`);
    assert.equal(decision.remaining, POLICY.limit - attempt);
  }
  const refused = consumeRateLimit("test", "caller-a", POLICY, now);
  assert.equal(refused.allowed, false);
  assert.equal(refused.remaining, 0);
  assert.ok(refused.retryAfterSeconds > 0);
});

test("callers do not consume each other's budget", () => {
  resetRateLimits();
  const now = 2_000_000;
  for (let attempt = 0; attempt < POLICY.limit; attempt += 1) {
    consumeRateLimit("test", "caller-a", POLICY, now);
  }
  assert.equal(consumeRateLimit("test", "caller-a", POLICY, now).allowed, false);
  assert.equal(consumeRateLimit("test", "caller-b", POLICY, now).allowed, true);
});

test("buckets are independent", () => {
  resetRateLimits();
  const now = 3_000_000;
  for (let attempt = 0; attempt < POLICY.limit; attempt += 1) {
    consumeRateLimit("expensive", "caller-a", POLICY, now);
  }
  assert.equal(consumeRateLimit("expensive", "caller-a", POLICY, now).allowed, false);
  assert.equal(consumeRateLimit("cheap", "caller-a", POLICY, now).allowed, true);
});

test("the window reopens once it elapses", () => {
  resetRateLimits();
  const now = 4_000_000;
  for (let attempt = 0; attempt < POLICY.limit; attempt += 1) {
    consumeRateLimit("test", "caller-a", POLICY, now);
  }
  assert.equal(consumeRateLimit("test", "caller-a", POLICY, now).allowed, false);
  assert.equal(
    consumeRateLimit("test", "caller-a", POLICY, now + POLICY.windowMs + 1).allowed,
    true,
  );
});

test("the expensive healing-demo policy is tighter than the cheap one", () => {
  const expensive = RATE_LIMIT_POLICIES.healingDemoExpensive;
  const cheap = RATE_LIMIT_POLICIES.healingDemoCheap;
  const expensivePerMinute = expensive.limit / (expensive.windowMs / 60_000);
  const cheapPerMinute = cheap.limit / (cheap.windowMs / 60_000);
  assert.ok(
    expensivePerMinute < cheapPerMinute,
    "steps that spend Bright Data quota must be the most restricted",
  );
});

test("identity comes from the forwarded client address, falling back to a shared bucket", () => {
  assert.equal(
    rateLimitIdentity(
      new Request("https://radar.test/", {
        headers: { "x-forwarded-for": "203.0.113.9, 70.41.3.18" },
      }),
    ),
    "203.0.113.9",
  );
  assert.equal(
    rateLimitIdentity(
      new Request("https://radar.test/", { headers: { "x-real-ip": "203.0.113.7" } }),
    ),
    "203.0.113.7",
  );
  assert.equal(rateLimitIdentity(new Request("https://radar.test/")), "unknown");
});

test("a refusal is a 429 carrying retry guidance and no internal detail", async () => {
  const decision = { allowed: false, limit: 3, remaining: 0, resetAt: Date.now() + 1000, retryAfterSeconds: 42 };
  const response = rateLimitedResponse(decision, "Slow down.");
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "42");
  const body = (await response.json()) as { error: string; retryAfterSeconds: number };
  assert.equal(body.error, "rate_limited");
  assert.equal(body.retryAfterSeconds, 42);
});
