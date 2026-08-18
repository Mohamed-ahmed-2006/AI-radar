import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  getSentinelDashboardReadModel,
  InMemorySentinelRepository,
} from "../../lib/sentinel";

test("Sentinel Read-Model: transforms source health and incidents into dashboard summary", async () => {
  const repo = new InMemorySentinelRepository();

  // Create an incident
  await repo.createIncident({
    sourceId: "src-1",
    providerId: "prov-1",
    status: "open",
    severity: "warning",
    reasonCodes: ["RECORD_COUNT_COLLAPSE"],
    summary: "Record count collapsed by 50%",
    recordsSeen: 5,
    recordsValid: 2,
    recordsInvalid: 3,
    lastKnownGoodCount: 10,
  });

  await repo.recordHealingAttempt({
    incidentId: repo.incidents[0]?.id as string,
    sourceId: "src-1",
    collectorId: "c_test",
    attemptNumber: 1,
    prompt: "Fix selector",
    status: "in_progress",
  });

  const readModel = await getSentinelDashboardReadModel(repo);

  assert.equal(readModel.activeIncidents.length, 1);
  assert.equal(readModel.activeIncidents[0]?.reasonCodes[0], "RECORD_COUNT_COLLAPSE");
  assert.equal(readModel.recentHealingAttempts.length, 1);
  assert.equal(readModel.summary.openIncidents, 1);
});

test("Sentinel Security: migration enables RLS and protects quarantine payloads", () => {
  const migrationPath = path.join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260817000004_sentinel_health_and_quarantine.sql",
  );

  assert.ok(fs.existsSync(migrationPath), "Migration file must exist");
  const sql = fs.readFileSync(migrationPath, "utf-8");

  // Verify RLS enabled on all Sentinel tables
  assert.ok(sql.includes("alter table sentinel_incidents enable row level security;"));
  assert.ok(sql.includes("alter table sentinel_quarantine_payloads enable row level security;"));
  assert.ok(sql.includes("alter table sentinel_healing_attempts enable row level security;"));

  // Verify public select is revoked for quarantine payloads
  assert.ok(sql.includes("revoke select on sentinel_quarantine_payloads from anon, authenticated;"));

  // Verify healing attempt sensitive details are restricted via column grant
  assert.ok(sql.includes("revoke select on sentinel_healing_attempts from anon, authenticated;"));
  assert.ok(sql.includes("grant select (") && sql.includes(") on sentinel_healing_attempts to anon, authenticated;"));
});
