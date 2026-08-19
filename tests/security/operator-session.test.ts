/**
 * Operator sessions.
 *
 * The property under test: a browser can be granted the scheduler's authority
 * for a bounded time without the credential ever leaving the server, and the
 * cookie that carries it is unforgeable, expiring, and revoked by rotation.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeOperatorRequest,
  authorizeSchedulerRequest,
} from "../../lib/orchestration/auth";
import {
  clearedOperatorSessionCookieHeader,
  isOperatorSessionConfigured,
  issueOperatorSessionToken,
  operatorSessionCookieHeader,
  OPERATOR_SESSION_COOKIE,
  readOperatorSessionCookie,
  verifyOperatorSessionToken,
} from "../../lib/orchestration/operator-session";

const OPERATOR_KEY = "operator-key-value";
const CRON_SECRET = "cron-secret-value";

function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const CLEAN = {
  AI_RADAR_OPERATOR_KEY: undefined,
  CRON_SECRET: undefined,
  AI_RADAR_INGEST_SECRET: undefined,
} as const;

function requestWithCookie(token: string): Request {
  return new Request("https://radar.test/api/demo/healing", {
    method: "POST",
    headers: { cookie: `${OPERATOR_SESSION_COOKIE}=${encodeURIComponent(token)}` },
  });
}

test("no configured credential means no session can be minted", () => {
  withEnv({ ...CLEAN }, () => {
    assert.equal(isOperatorSessionConfigured(), false);
    assert.equal(issueOperatorSessionToken("anything"), null);
    assert.equal(issueOperatorSessionToken(""), null);
  });
});

test("a correct credential mints a token that verifies", () => {
  withEnv({ ...CLEAN, AI_RADAR_OPERATOR_KEY: OPERATOR_KEY }, () => {
    const token = issueOperatorSessionToken(OPERATOR_KEY);
    assert.ok(token);
    assert.equal(verifyOperatorSessionToken(token), true);
  });
});

test("the token never contains the credential", () => {
  withEnv({ ...CLEAN, AI_RADAR_OPERATOR_KEY: OPERATOR_KEY }, () => {
    const token = issueOperatorSessionToken(OPERATOR_KEY);
    assert.ok(token);
    assert.equal(token.includes(OPERATOR_KEY), false);
    assert.equal(operatorSessionCookieHeader(token).includes(OPERATOR_KEY), false);
  });
});

test("a wrong credential mints nothing", () => {
  withEnv({ ...CLEAN, AI_RADAR_OPERATOR_KEY: OPERATOR_KEY }, () => {
    assert.equal(issueOperatorSessionToken("not-the-key"), null);
    assert.equal(issueOperatorSessionToken(`${OPERATOR_KEY}x`), null);
  });
});

test("the scheduler secrets also open a session", () => {
  withEnv({ ...CLEAN, CRON_SECRET }, () => {
    assert.ok(issueOperatorSessionToken(CRON_SECRET));
  });
});

test("a forged signature is rejected", () => {
  withEnv({ ...CLEAN, AI_RADAR_OPERATOR_KEY: OPERATOR_KEY }, () => {
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    assert.equal(verifyOperatorSessionToken(`${expiry}.${"a".repeat(64)}`), false);
    assert.equal(verifyOperatorSessionToken(`${expiry}.`), false);
    assert.equal(verifyOperatorSessionToken(String(expiry)), false);
    assert.equal(verifyOperatorSessionToken("not-a-token"), false);
    assert.equal(verifyOperatorSessionToken(null), false);
  });
});

test("an expired token is rejected", () => {
  withEnv({ ...CLEAN, AI_RADAR_OPERATOR_KEY: OPERATOR_KEY }, () => {
    const token = issueOperatorSessionToken(OPERATOR_KEY, { ttlSeconds: 60 });
    assert.ok(token);
    assert.equal(verifyOperatorSessionToken(token), true);
    assert.equal(
      verifyOperatorSessionToken(token, { now: () => Date.now() + 120_000 }),
      false,
    );
  });
});

test("rotating the credential revokes outstanding sessions", () => {
  const token = withEnv({ ...CLEAN, AI_RADAR_OPERATOR_KEY: OPERATOR_KEY }, () =>
    issueOperatorSessionToken(OPERATOR_KEY),
  );
  assert.ok(token);
  withEnv({ ...CLEAN, AI_RADAR_OPERATOR_KEY: "rotated-key-value" }, () => {
    assert.equal(verifyOperatorSessionToken(token), false);
  });
});

test("a session authorizes an operator request that carries no header secret", () => {
  withEnv({ ...CLEAN, AI_RADAR_OPERATOR_KEY: OPERATOR_KEY }, () => {
    const token = issueOperatorSessionToken(OPERATOR_KEY);
    assert.ok(token);
    const request = requestWithCookie(token);

    // The scheduler surface is unchanged: a cookie is not a header secret.
    assert.equal(authorizeSchedulerRequest(request).authorized, false);

    const operator = authorizeOperatorRequest(request);
    assert.equal(operator.authorized, true);
    assert.equal(operator.authorized && operator.principal, "operator-session");
  });
});

test("an anonymous request is not an operator", () => {
  withEnv({ ...CLEAN, AI_RADAR_OPERATOR_KEY: OPERATOR_KEY }, () => {
    const request = new Request("https://radar.test/api/demo/healing", { method: "POST" });
    assert.equal(authorizeOperatorRequest(request).authorized, false);
  });
});

test("the cookie is HttpOnly, SameSite=Strict and bounded", () => {
  const header = operatorSessionCookieHeader("1.2", { secure: true });
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Secure/);
  assert.match(header, /Max-Age=\d+/);
  assert.match(clearedOperatorSessionCookieHeader({ secure: true }), /Max-Age=0/);
});

test("the cookie is read out of a header carrying other cookies", () => {
  const request = new Request("https://radar.test/", {
    headers: { cookie: `theme=dark; ${OPERATOR_SESSION_COOKIE}=abc.def; other=1` },
  });
  assert.equal(readOperatorSessionCookie(request), "abc.def");
  assert.equal(
    readOperatorSessionCookie(new Request("https://radar.test/")),
    null,
  );
});
