-- AI Radar — Sentinel self-healing demo harness
--
-- Adds the storage the controlled failure → quarantine → Bright Data heal →
-- preview → approve → recover demonstration needs, WITHOUT touching any
-- production pricing, lifecycle or catalog table.
--
-- The demo reuses the real machinery deliberately:
--   * its provider/source rows live in `providers` / `sources`
--   * its runs live in `collection_runs`, so last-known-good is the real
--     last-known-good lookup, not a demo-only shortcut
--   * its incidents, quarantined payloads and healing attempts live in the
--     existing `sentinel_*` tables
--
-- Only two things are new: a canonical table for the demo's own records, and a
-- small journal recording which phase the demonstration is in.

-- ---------------------------------------------------------------------------
-- demo_quote_snapshots — the demo source's canonical data
-- ---------------------------------------------------------------------------

create table demo_quote_snapshots (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references collection_runs (id) on delete cascade,
  source_id   uuid not null references sources (id) on delete cascade,
  provider_id uuid not null references providers (id) on delete cascade,
  quote_key   text not null,
  quote_text  text not null,
  author      text not null,
  tags        text[] not null default '{}',
  source_url  text not null,
  observed_at timestamptz not null,
  created_at  timestamptz not null default now(),

  constraint demo_quote_text_not_blank check (length(btrim(quote_text)) > 0),
  constraint demo_quote_author_not_blank check (length(btrim(author)) > 0)
);

comment on table demo_quote_snapshots is
  'Canonical records for the Sentinel self-healing demo source. A quarantined run contributes zero rows here, which is what makes "0 canonical writes" checkable.';

create index demo_quote_snapshots_run_idx on demo_quote_snapshots (run_id);
create index demo_quote_snapshots_source_idx on demo_quote_snapshots (source_id, observed_at desc);

-- ---------------------------------------------------------------------------
-- sentinel_demo_state — which phase the demonstration is in
-- ---------------------------------------------------------------------------

create table sentinel_demo_state (
  source_key                 text primary key,
  source_id                  uuid references sources (id) on delete set null,
  -- Which page layout the collector is currently pointed at. This is the
  -- controlled failure switch: it selects a URL from a two-entry allowlist,
  -- it does not edit any health status.
  armed_layout               text not null default 'healthy',
  -- How the controlled failure is produced. 'layout' re-points the collector at
  -- an alternate page rendering; 'template' installs a deliberately defective
  -- extraction template through a real Scraper Studio refactor. Both make the
  -- scraper itself fail; neither edits a health flag.
  break_mode                 text not null default 'layout',
  phase                      text not null default 'unprepared',
  baseline_run_id            uuid references collection_runs (id) on delete set null,
  broken_run_id              uuid references collection_runs (id) on delete set null,
  recovered_run_id           uuid references collection_runs (id) on delete set null,
  current_incident_id        uuid references sentinel_incidents (id) on delete set null,
  current_healing_attempt_id uuid references sentinel_healing_attempts (id) on delete set null,
  healing_job_id             text,
  healing_requested_at       timestamptz,
  preview_records_count      integer,
  preview_passed             boolean,
  preview_reason_codes       text[] not null default '{}',
  preview_summary            text,
  approval_state             text not null default 'not_requested',
  approved_at                timestamptz,
  -- False only when the harness ran against injected doubles. The read model
  -- surfaces this so nobody can mistake a rehearsal for a live proof.
  is_live                    boolean not null default true,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint sentinel_demo_layout_valid check (armed_layout in ('healthy', 'broken')),
  constraint sentinel_demo_break_mode_valid check (break_mode in ('layout', 'template')),
  constraint sentinel_demo_phase_valid check (
    phase in (
      'unprepared',
      'healthy',
      'failure_armed',
      'quarantined',
      'healing',
      'preview_rejected',
      'preview_validated',
      'approved',
      'recovered',
      'needs_review'
    )
  ),
  constraint sentinel_demo_approval_valid check (
    approval_state in ('not_requested', 'awaiting_decision', 'approved', 'rejected')
  )
);

comment on table sentinel_demo_state is
  'Single-row-per-demo-source phase marker for the Sentinel self-healing demonstration.';
comment on column sentinel_demo_state.armed_layout is
  'Controlled failure switch: selects one of two allowlisted page layouts. Never edits health directly.';

create trigger sentinel_demo_state_set_updated_at
  before update on sentinel_demo_state
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- sentinel_demo_events — the evidence trail
-- ---------------------------------------------------------------------------

create table sentinel_demo_events (
  id         uuid primary key default gen_random_uuid(),
  source_key text not null references sentinel_demo_state (source_key) on delete cascade,
  phase      text not null,
  action     text not null,
  status     text not null,
  summary    text not null,
  run_id     uuid references collection_runs (id) on delete set null,
  incident_id uuid references sentinel_incidents (id) on delete set null,
  -- Raw diagnostics: collector output fragments, validation errors, Bright
  -- Data step names. Service role only, same posture as quarantine payloads.
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint sentinel_demo_event_status_valid check (
    status in ('ok', 'refused', 'failed')
  )
);

comment on table sentinel_demo_events is
  'Append-only narrative of the self-healing demonstration. `detail` holds raw diagnostics and is service-role only.';

create index sentinel_demo_events_source_idx on sentinel_demo_events (source_key, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table demo_quote_snapshots enable row level security;
alter table sentinel_demo_state enable row level security;
alter table sentinel_demo_events enable row level security;

create policy "public read" on demo_quote_snapshots
  for select to anon, authenticated using (true);

create policy "public read" on sentinel_demo_state
  for select to anon, authenticated using (true);

create policy "public read" on sentinel_demo_events
  for select to anon, authenticated using (true);

-- The event `detail` column carries verbatim collector output and Bright Data
-- diagnostics. Withhold it from public reads exactly as quarantine payloads are
-- withheld; the demo read model never returns it to an unauthenticated caller.
revoke select on sentinel_demo_events from anon, authenticated;
grant select (
  id, source_key, phase, action, status, summary, run_id, incident_id, created_at
) on sentinel_demo_events to anon, authenticated;
