-- AI Radar — Sentinel Source Health, Quarantine & Self-Healing Migration
--
-- Sentinel monitors collector outputs, intercepts anomalous or corrupt scraper runs,
-- isolates invalid candidate payloads into quarantine tables, preserves last-known-good
-- state, records health incidents, and orchestrates Scraper Studio healing attempts.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type sentinel_status as enum (
  'healthy',
  'degraded',
  'quarantined',
  'healing',
  'recovered',
  'needs_review'
);

create type sentinel_incident_status as enum (
  'open',
  'healing',
  'resolved',
  'dismissed',
  'needs_review'
);

-- ---------------------------------------------------------------------------
-- sentinel_incidents
-- ---------------------------------------------------------------------------

create table sentinel_incidents (
  id                     uuid primary key default gen_random_uuid(),
  source_id              uuid not null references sources (id) on delete cascade,
  provider_id            uuid not null references providers (id) on delete cascade,
  run_id                 uuid references collection_runs (id) on delete set null,
  status                 sentinel_incident_status not null default 'open',
  severity               text not null default 'warning',
  reason_codes           text[] not null default '{}',
  summary                text,
  records_seen           integer not null default 0,
  records_valid          integer not null default 0,
  records_invalid        integer not null default 0,
  expected_count         integer,
  last_known_good_count  integer,
  last_known_good_run_id uuid references collection_runs (id) on delete set null,
  last_known_good_at     timestamptz,
  healing_attempt_count  integer not null default 0,
  resolution_note        text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  resolved_at            timestamptz,

  constraint sentinel_incidents_severity_valid check (severity in ('info', 'warning', 'critical')),
  constraint sentinel_incidents_counts_non_negative check (
    records_seen >= 0 and records_valid >= 0 and records_invalid >= 0 and healing_attempt_count >= 0
  )
);

comment on table sentinel_incidents is 'Health incidents and anomaly quarantine events recorded by Sentinel.';
comment on column sentinel_incidents.reason_codes is 'Array of machine-readable error reasons (e.g. RECORD_COUNT_COLLAPSE, SCHEMA_VALIDATION_FAILURE).';
comment on column sentinel_incidents.last_known_good_count is 'Record count of the most recent verified good collection run.';

create index sentinel_incidents_source_idx on sentinel_incidents (source_id, created_at desc);
create index sentinel_incidents_provider_idx on sentinel_incidents (provider_id, created_at desc);
create index sentinel_incidents_status_idx on sentinel_incidents (status, created_at desc);
create index sentinel_incidents_run_idx on sentinel_incidents (run_id) where run_id is not null;

create trigger sentinel_incidents_set_updated_at
  before update on sentinel_incidents
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- sentinel_quarantine_payloads
-- ---------------------------------------------------------------------------

create table sentinel_quarantine_payloads (
  id                uuid primary key default gen_random_uuid(),
  incident_id       uuid not null references sentinel_incidents (id) on delete cascade,
  source_id         uuid not null references sources (id) on delete cascade,
  run_id            uuid references collection_runs (id) on delete set null,
  raw_payload       jsonb not null default '[]'::jsonb,
  validation_errors jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now()
);

comment on table sentinel_quarantine_payloads is 'Isolated raw scraper payloads and parser diagnostics. Restricted to service role.';

create index sentinel_quarantine_incident_idx on sentinel_quarantine_payloads (incident_id);
create index sentinel_quarantine_source_idx on sentinel_quarantine_payloads (source_id);

-- ---------------------------------------------------------------------------
-- sentinel_healing_attempts
-- ---------------------------------------------------------------------------

create table sentinel_healing_attempts (
  id                           uuid primary key default gen_random_uuid(),
  incident_id                  uuid not null references sentinel_incidents (id) on delete cascade,
  source_id                    uuid not null references sources (id) on delete cascade,
  collector_id                 text,
  attempt_number               integer not null default 1,
  prompt                       text not null,
  status                       text not null,
  refactor_job_id              text,
  candidate_records_count      integer,
  candidate_passed_validation  boolean,
  validation_details           jsonb,
  error_message                text,
  started_at                   timestamptz not null default now(),
  completed_at                 timestamptz,
  created_at                   timestamptz not null default now(),

  constraint sentinel_healing_status_valid check (
    status in (
      'initiated',
      'in_progress',
      'awaiting_approval',
      'candidate_validated',
      'candidate_rejected',
      'approved',
      'rejected',
      'failed',
      'timed_out'
    )
  ),
  constraint sentinel_healing_attempt_number_positive check (attempt_number >= 1)
);

comment on table sentinel_healing_attempts is 'Audit trail of Bright Data Scraper Studio autonomous healing refactor cycles.';

create index sentinel_healing_incident_idx on sentinel_healing_attempts (incident_id, attempt_number);
create index sentinel_healing_source_idx on sentinel_healing_attempts (source_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

-- Sentinel health dashboard view: combines source metadata, last run health, LKG baselines, and active incidents.
create view sentinel_source_health
with (security_invoker = true) as
select distinct on (s.id)
  s.id as source_id,
  s.provider_id,
  p.name as provider_name,
  p.slug as provider_slug,
  s.kind,
  s.collector_id,
  s.source_url,
  s.label,
  s.is_active,
  r.id as last_run_id,
  r.status as last_run_status,
  r.started_at as last_run_started_at,
  r.completed_at as last_run_completed_at,
  r.records_seen as last_run_records_seen,
  r.records_accepted as last_run_records_accepted,
  r.records_rejected as last_run_records_rejected,
  r.error_message as last_run_error_message,
  i.id as active_incident_id,
  i.status as active_incident_status,
  i.severity as active_incident_severity,
  i.reason_codes as active_reason_codes,
  i.healing_attempt_count,
  i.last_known_good_count,
  i.last_known_good_at,
  case
    when i.status in ('open', 'healing') and i.healing_attempt_count > 0 then 'healing'::sentinel_status
    when i.status = 'open' then 'quarantined'::sentinel_status
    when i.status = 'needs_review' then 'needs_review'::sentinel_status
    when i.status = 'resolved' and r.status = 'succeeded' then 'recovered'::sentinel_status
    when r.status = 'succeeded' then 'healthy'::sentinel_status
    when r.status = 'partial' then 'degraded'::sentinel_status
    when r.status = 'failed' then 'quarantined'::sentinel_status
    else 'healthy'::sentinel_status
  end as sentinel_health_status
from sources s
join providers p on p.id = s.provider_id
left join collection_runs r on r.id = (
  select cr.id from collection_runs cr
  where cr.source_id = s.id
  order by cr.started_at desc nulls last
  limit 1
)
left join sentinel_incidents i on i.id = (
  select si.id from sentinel_incidents si
  where si.source_id = s.id
  order by si.created_at desc
  limit 1
)
order by s.id;

comment on view sentinel_source_health is 'Aggregated source health with Sentinel quarantine status and LKG telemetry.';

-- ---------------------------------------------------------------------------
-- Row Level Security & Column Grants
-- ---------------------------------------------------------------------------

alter table sentinel_incidents enable row level security;
alter table sentinel_quarantine_payloads enable row level security;
alter table sentinel_healing_attempts enable row level security;

-- Public can read incident high-level metadata (for dashboard observability)
create policy "public read" on sentinel_incidents
  for select to anon, authenticated using (true);

-- Public can read non-sensitive healing attempt metadata
create policy "public read" on sentinel_healing_attempts
  for select to anon, authenticated using (true);

-- Quarantine payloads contain verbatim malformed scraper outputs and DOM traces.
-- Deny public select entirely; access is restricted to service_role.
revoke select on sentinel_quarantine_payloads from anon, authenticated;

-- Hide validation_details from public select on healing attempts
revoke select on sentinel_healing_attempts from anon, authenticated;
grant select (
  id, incident_id, source_id, collector_id, attempt_number,
  prompt, status, refactor_job_id, candidate_records_count,
  candidate_passed_validation, error_message, started_at,
  completed_at, created_at
) on sentinel_healing_attempts to anon, authenticated;
