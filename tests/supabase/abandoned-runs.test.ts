/**
 * A serverless invocation can be killed outright: the stack never unwinds, so
 * no handler runs and the `collection_runs` row stays `running` with no
 * completion timestamp forever. Production carried two such rows, and Source
 * Detail reported them as in-flight collections days after the fact.
 *
 * `orchestration_runs` already reclaims an abandoned lease when the next run
 * starts. These tests pin the same reconciliation onto `collection_runs`, whose
 * equivalent signal is simpler: a source only ever has one collection in flight,
 * so anything still open when a new one starts was abandoned.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ABANDONED_RUN_REASON,
  reconcileAbandonedRuns,
  startCollectionRun,
} from "../../lib/supabase";
import type { CollectionRunRow, SupabaseServerClient } from "../../lib/supabase";

type Row = Record<string, unknown>;

/**
 * The narrowest possible stand-in for the Supabase client: it records the
 * filters a query applied and answers from an in-memory table, so the query
 * this module builds is the thing under test rather than a mock's opinion of it.
 */
function fakeDb(rows: Row[]) {
  let nextId = 1;

  const builder = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let mode: "select" | "update" | "insert" = "select";
    let patch: Row = {};
    let inserted: Row | null = null;

    const matching = () =>
      rows.filter((row) => filters.every(([column, value]) => row[column] === value));

    const api = {
      select() {
        return api;
      },
      update(values: Row) {
        mode = "update";
        patch = values;
        return api;
      },
      insert(values: Row) {
        mode = "insert";
        inserted = { id: `run-${nextId++}`, completed_at: null, ...values };
        rows.push(inserted);
        return api;
      },
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return api;
      },
      async maybeSingle() {
        return { data: matching()[0] ?? null, error: null };
      },
      async single() {
        return { data: inserted ?? matching()[0] ?? null, error: null };
      },
      // Awaiting the builder is how an update-returning query resolves.
      then(resolve: (result: { data: Row[] | null; error: null }) => unknown) {
        assert.equal(table, "collection_runs");
        if (mode === "update") {
          const touched = matching();
          for (const row of touched) Object.assign(row, patch);
          return Promise.resolve(resolve({ data: touched, error: null }));
        }
        return Promise.resolve(resolve({ data: matching(), error: null }));
      },
    };
    return api;
  };

  return { from: builder } as unknown as SupabaseServerClient;
}

function runRow(overrides: Row): Row {
  return {
    id: "run-existing",
    source_id: "src-1",
    status: "running",
    completed_at: null,
    external_run_id: null,
    error_message: null,
    ...overrides,
  };
}

test("an open run for the source is reconciled and given a completion timestamp", async () => {
  const rows = [runRow({ id: "run-abandoned" })];
  const closed = await reconcileAbandonedRuns(fakeDb(rows), "src-1");

  assert.equal(closed, 1);
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[0].error_message, ABANDONED_RUN_REASON);
  assert.notEqual(rows[0].completed_at, null);
});

test("counts are left alone: the dead run's result is unknown, not zero", async () => {
  const rows = [
    runRow({ id: "run-abandoned", records_seen: 41, records_accepted: 40, records_rejected: 1 }),
  ];
  await reconcileAbandonedRuns(fakeDb(rows), "src-1");

  assert.equal(rows[0].records_seen, 41);
  assert.equal(rows[0].records_accepted, 40);
  assert.equal(rows[0].records_rejected, 1);
});

test("finished runs and other sources' runs are untouched", async () => {
  const rows = [
    runRow({ id: "run-done", status: "partial", completed_at: "2026-08-20T08:16:15Z" }),
    runRow({ id: "run-other-source", source_id: "src-2" }),
  ];
  const closed = await reconcileAbandonedRuns(fakeDb(rows), "src-1");

  assert.equal(closed, 0);
  assert.equal(rows[0].status, "partial");
  assert.equal(rows[1].status, "running");
});

test("starting a run reconciles whatever the last one left open", async () => {
  const rows = [runRow({ id: "run-abandoned" })];
  const started = (await startCollectionRun(fakeDb(rows), {
    sourceId: "src-1",
    triggeredBy: "test",
  })) as unknown as CollectionRunRow;

  assert.equal(rows[0].status, "failed");
  assert.equal(started.status, "running");
  assert.notEqual(started.id, "run-abandoned");
});
