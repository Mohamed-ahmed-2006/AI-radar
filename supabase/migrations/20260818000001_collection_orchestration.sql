-- AI Radar — autonomous collection orchestration
--
-- One row per orchestrated execution of one configured source. The row is both
-- the audit record and the lease:
--
--   * `orchestration_runs_single_active` — at most one `running` row per
--     source. A second scheduler tick that tries to start the same source hits
--     a unique violation and reports `already_running` instead of scraping in
--     parallel. Serverless invocations share no memory, so the lock has to
--     live here.
--   * `orchestration_runs_invocation_key` — one row per
--     (source, scheduler invocation). A retried or duplicated cron delivery is
--     therefore a no-op rather than a second collection.
--
-- Leases carry `lease_expires_at` because a serverless invocation can be killed
-- without unwinding. An expired lease is reclaimable; a live one is not.

create type orchestration_run_status as enum (
  'running',
  'succeeded',
  'failed',
  'quarantined',
  'skipped'
);

create table orchestration_runs (
  id                   uuid primary key default gen_random_uuid(),
  source_key           text not null,
  provider_slug        text not null,
  source_type          text not null,
  status               orchestration_run_status not null default 'running',
  -- 'cron' | 'manual' | test-supplied label.
  trigger              text not null default 'cron',
  -- Scheduler invocation identity, used for duplicate-delivery safety.
  invocation_id        text,
  attempt_count        integer not null default 0,
  started_at           timestamptz not null default now(),
  completed_at         timestamptz,
  duration_ms          integer,
  lease_expires_at     timestamptz not null,
  collection_run_id    uuid references collection_runs (id) on delete set null,
  external_run_id      text,
  sentinel_incident_id uuid references sentinel_incidents (id) on delete set null,
  records_accepted     integer not null default 0,
  records_rejected     integer not null default 0,
  changes_detected     integer not null default 0,
  -- Machine-readable result, e.g. completed / quarantined / timed_out.
  outcome              text,
  error_message        text,
  reason_codes         text[] not null default '{}',
  created_at           timestamptz not null default now(),

  constraint orchestration_runs_counts_non_negative check (
    attempt_count >= 0
    and records_accepted >= 0
    and records_rejected >= 0
    and changes_detected >= 0
  ),
  constraint orchestration_runs_completion_consistent check (
    (status = 'running' and completed_at is null)
    or (status <> 'running' and completed_at is not null)
  ),
  constraint orchestration_runs_completed_after_start check (
    completed_at is null or completed_at >= started_at
  ),
  constraint orchestration_runs_source_type_valid check (
    source_type in ('pricing', 'lifecycle')
  )
);

comment on table orchestration_runs is 'One orchestrated execution of a configured intelligence source. The running row is also the source lease.';
comment on column orchestration_runs.lease_expires_at is 'After this instant an abandoned running row may be reclaimed by another tick.';
comment on column orchestration_runs.invocation_id is 'Scheduler invocation identity; makes duplicate cron delivery a no-op.';

-- Overlap prevention: a source has at most one execution in flight.
create unique index orchestration_runs_single_active
  on orchestration_runs (source_key)
  where status = 'running';

-- Duplicate scheduler delivery prevention, still enforced after the run ends.
create unique index orchestration_runs_invocation_key
  on orchestration_runs (source_key, invocation_id)
  where invocation_id is not null;

create index orchestration_runs_source_started_idx
  on orchestration_runs (source_key, started_at desc);
create index orchestration_runs_status_started_idx
  on orchestration_runs (status, started_at desc);
create index orchestration_runs_success_idx
  on orchestration_runs (source_key, started_at desc)
  where status = 'succeeded';

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table orchestration_runs enable row level security;

create policy "public read" on orchestration_runs
  for select to anon, authenticated using (true);

-- `error_message` can echo collector diagnostics and upstream markup, so it
-- stays service-role only. Everything else is safe scheduling telemetry.
revoke select on orchestration_runs from anon, authenticated;
grant select (
  id, source_key, provider_slug, source_type, status, trigger,
  attempt_count, started_at, completed_at, duration_ms, lease_expires_at,
  collection_run_id, sentinel_incident_id, records_accepted, records_rejected,
  changes_detected, outcome, reason_codes, created_at
) on orchestration_runs to anon, authenticated;
