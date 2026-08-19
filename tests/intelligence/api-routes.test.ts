// These tests exercise the explicit demo mode, which is gated behind a
// server-side opt-in so production can never substitute the fabricated corpus.
// `tests/security/fixture-isolation.test.ts` covers the ungated case.
process.env.AI_RADAR_DEMO_EVIDENCE = "1";

import test from "node:test";
import assert from "node:assert/strict";

import { GET as getChangesRoute } from "../../app/api/intelligence/changes/route";
import { GET as getQueryRoute } from "../../app/api/intelligence/query/route";
import { GET as getCompareRoute } from "../../app/api/intelligence/compare/route";
import { GET as getSignificantRoute } from "../../app/api/intelligence/significant/route";

test("API: GET /api/intelligence/changes returns filtered structured evidence", async () => {
  const req = new Request("http://localhost:3000/api/intelligence/changes?provider=anthropic&range=30d&demo=true");
  const res = await getChangesRoute(req);
  assert.equal(res.status, 200);

  const json = await res.json();
  assert(json.totalEvents > 0);
  assert(json.events.every((e: { provider: string }) => e.provider === "anthropic"));
  assert(json.narrativeSummary, "Must include narrative summary");
  assert(json.metrics, "Must include metrics");
});

test("API: GET /api/intelligence/query answers 'What changed in Claude this month?'", async () => {
  const req = new Request("http://localhost:3000/api/intelligence/query?q=What changed in Claude this month?&demo=true");
  const res = await getQueryRoute(req);
  assert.equal(res.status, 200);

  const json = await res.json();
  assert.equal(json.question, "What changed in Claude this month?");
  assert(json.bundle.totalEvents > 0);
  assert(json.summary.includes("claude-3-5-sonnet") || json.summary.includes("Claude 3.5 Sonnet"));
});

test("API: GET /api/intelligence/compare returns cross-provider comparative analytics", async () => {
  const req = new Request("http://localhost:3000/api/intelligence/compare?providers=anthropic,google,openai&range=30d&demo=true");
  const res = await getCompareRoute(req);
  assert.equal(res.status, 200);

  const json = await res.json();
  assert(json.providers.anthropic);
  assert(json.providers.google);
  assert(json.providers.openai);
  assert(json.comparisonHighlights.length > 0);
});

test("API: GET /api/intelligence/significant returns ranked high-impact changes", async () => {
  const req = new Request("http://localhost:3000/api/intelligence/significant?range=30d&limit=5&demo=true");
  const res = await getSignificantRoute(req);
  assert.equal(res.status, 200);

  const json = await res.json();
  assert(json.topChanges.length > 0);
  assert(json.topChanges.length <= 5);
  assert(json.headline);
});
