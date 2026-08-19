import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  InMemorySourceReadPort,
  handleProvenanceRequest,
  handleSourceCatalogRequest,
  handleSourceDetailRequest,
  safeSourceUrl,
  sanitizeText,
} from "../../lib/sources";
import * as catalogRoute from "../../app/api/sources/route";
import * as detailRoute from "../../app/api/sources/[id]/route";
import * as provenanceRoute from "../../app/api/provenance/route";
import {
  NOW,
  PRICING_SOURCE,
  healingAttempt,
  healthySourceData,
  incident,
  minutesAgo,
  run,
} from "./support/fixtures";

const now = () => NOW;
const detailRequest = new Request("http://localhost:3000/api/sources/x");

test("Public API: the source endpoints are read-only — no mutating handler is exported", () => {
  const mutations = ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
  for (const [name, route] of [
    ["/api/sources", catalogRoute],
    ["/api/sources/[id]", detailRoute],
    ["/api/provenance", provenanceRoute],
  ] as const) {
    assert.equal(typeof route.GET, "function", `${name} must expose GET`);
    for (const method of mutations) {
      assert.equal(
        method in route,
        false,
        `${name} must not export a ${method} handler`,
      );
    }
  }
});

test("Public API: detail answers 404 for an unknown source and 400 for a malformed provenance query", async () => {
  const port = new InMemorySourceReadPort(healthySourceData());

  const missing = await handleSourceDetailRequest(detailRequest, "src-nope", {
    port,
    now,
  });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "Source not found" });

  const found = await handleSourceDetailRequest(detailRequest, PRICING_SOURCE.id, {
    port,
    now,
  });
  assert.equal(found.status, 200);

  const catalog = await handleSourceCatalogRequest({ port, now });
  assert.equal(catalog.status, 200);

  const badKind = await handleProvenanceRequest(
    new Request("http://localhost:3000/api/provenance?kind=quarantine_payload&id=1"),
    { port },
  );
  assert.equal(badKind.status, 400);

  const unknownEvidence = await handleProvenanceRequest(
    new Request("http://localhost:3000/api/provenance?kind=pricing_snapshot&id=nope"),
    { port },
  );
  assert.equal(unknownEvidence.status, 404);
});

test("Public API: section limits are bounded so one request cannot ask for everything", async () => {
  const port = new InMemorySourceReadPort(healthySourceData());
  const response = await handleSourceDetailRequest(
    new Request("http://localhost:3000/api/sources/x?runs=9999&observations=-4"),
    PRICING_SOURCE.id,
    { port, now },
  );

  const detail = await response.json();
  // Three runs exist; the point is that the clamp did not throw and the
  // negative observation limit fell back to the default rather than inverting.
  assert.equal(detail.runs.length, 3);
  assert.ok(detail.history.length <= 50);
});

test("Public output: operator text is redacted and truncated before it is published", async () => {
  const data = healthySourceData();
  const port = new InMemorySourceReadPort({
    ...data,
    runs: [
      run({
        id: "run-leaky",
        source_id: PRICING_SOURCE.id,
        started_at: minutesAgo(10),
        status: "failed",
        error_message:
          'Bright Data request failed: GET https://api.brightdata.com/dca/trigger api_key=abc123SECRETVALUE <div class="price">$1.25</div>',
      }),
      ...(data.runs ?? []),
    ],
    incidents: [
      incident({
        id: "inc-leaky",
        source_id: PRICING_SOURCE.id,
        summary: `Validation failed Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.longtokenvalue.signature ${"x".repeat(400)}`,
      }),
    ],
    healingAttempts: [
      healingAttempt({ id: "heal-1", source_id: PRICING_SOURCE.id, incident_id: "inc-leaky" }),
    ],
  });

  const response = await handleSourceDetailRequest(detailRequest, PRICING_SOURCE.id, {
    port,
    now,
  });
  const body = await response.text();

  assert.equal(body.includes("abc123SECRETVALUE"), false);
  assert.equal(body.includes("eyJhbGciOiJIUzI1NiJ9"), false);
  assert.equal(body.includes("<div"), false);
  assert.ok(body.includes("[redacted]"));

  const detail = JSON.parse(body);
  assert.ok(detail.runs[0].failureReason.length <= 240);
  assert.ok(detail.incidents[0].summary.length <= 240);

  // The healing prompt is operator text about collector internals; the public
  // read path does not carry it at all.
  assert.equal("prompt" in detail.healing[0], false);
  assert.equal(body.includes("Fix selector"), false);
});

test("Public output: only safe URLs are published", () => {
  assert.equal(
    safeSourceUrl("https://user:pw@example.com/pricing?token=abc#frag"),
    "https://example.com/pricing",
  );
  assert.equal(safeSourceUrl("javascript:alert(1)"), null);
  assert.equal(safeSourceUrl("file:///etc/passwd"), null);
  assert.equal(safeSourceUrl("not a url"), null);
  assert.equal(safeSourceUrl(null), null);
});

test("Public output: sanitizer strips credential-shaped values wherever they appear", () => {
  assert.equal(sanitizeText("token: sk-abcdefghijklmnop"), "[redacted]");
  assert.equal(sanitizeText("digest 0123456789abcdef0123456789abcdef"), "digest [redacted]");
  assert.equal(sanitizeText("   spaced\n\ttext  "), "spaced text");
  assert.equal(sanitizeText(null), null);
  assert.equal(sanitizeText(""), null);
});

test("Read path: quarantine diagnostics have no accessor and no anon-readable column", () => {
  const portSource = fs.readFileSync(
    path.join(process.cwd(), "lib", "sources", "port.ts"),
    "utf-8",
  );

  // The public read port must not be able to reach quarantine payloads, and the
  // explicit column lists must exclude the service-role-only diagnostics
  // (`select *` on these tables would be refused for anon anyway, but the lists
  // are what keep the queries honest).
  assert.equal(/from\(\s*"sentinel_quarantine_payloads"/.test(portSource), false);

  const columnLists = [...portSource.matchAll(/_COLUMNS\s*=([\s\S]*?);/g)]
    .map((match) => match[1])
    .join("\n");
  assert.ok(columnLists.includes("records_accepted"), "column lists must be found");
  for (const column of ["validation_errors", "error_details", "validation_details", "prompt"]) {
    assert.equal(
      columnLists.includes(column),
      false,
      `${column} must not appear in a public select list`,
    );
  }

  // Anon key, not service role: RLS and the column grants are in force.
  assert.ok(portSource.includes("createSupabaseServerClient"));
  assert.equal(portSource.includes("createSupabaseAdminClient"), false);

  // The in-memory port mirrors the same boundary, so a test cannot accidentally
  // assert on data that production could never return.
  const inMemory = fs.readFileSync(
    path.join(process.cwd(), "lib", "sources", "in-memory-port.ts"),
    "utf-8",
  );
  assert.equal(/quarantine\w*\s*[:?(]/i.test(inMemory), false);
});

test("Read path: no ingest or Bright Data secret is read anywhere in the source module", () => {
  const dir = path.join(process.cwd(), "lib", "sources");
  for (const file of fs.readdirSync(dir)) {
    const contents = fs.readFileSync(path.join(dir, file), "utf-8");
    assert.equal(
      /process\.env/.test(contents),
      false,
      `${file} must not read environment configuration`,
    );
    assert.equal(
      /BRIGHTDATA|SUPABASE_SECRET|SERVICE_ROLE|CRON_SECRET/.test(contents),
      false,
      `${file} must not reference ingest secrets`,
    );
  }
});

test("Read path: quarantine and healing diagnostics stay revoked in the schema", () => {
  const sql = fs.readFileSync(
    path.join(
      process.cwd(),
      "supabase",
      "migrations",
      "20260817000004_sentinel_health_and_quarantine.sql",
    ),
    "utf-8",
  );

  assert.ok(sql.includes("revoke select on sentinel_quarantine_payloads from anon, authenticated;"));
  assert.ok(sql.includes("revoke select on sentinel_healing_attempts from anon, authenticated;"));
  // `validation_details` must stay out of the anon column grant list.
  const grant = sql.slice(
    sql.indexOf("grant select ("),
    sql.indexOf(") on sentinel_healing_attempts to anon, authenticated;"),
  );
  assert.equal(grant.includes("validation_details"), false);
});
