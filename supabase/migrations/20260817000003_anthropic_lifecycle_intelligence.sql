-- Authoritative model lifecycle intelligence is deliberately separate from
-- pricing. Pricing collector absence can never write these columns/tables.

create type lifecycle_state as enum (
  'active',
  'legacy',
  'deprecated',
  'retired'
);

alter type change_type add value if not exists 'lifecycle_changed';

alter table collection_runs
  add column validation_errors jsonb not null default '[]'::jsonb,
  add constraint collection_runs_validation_errors_array
    check (jsonb_typeof(validation_errors) = 'array');

alter table models
  add column lifecycle_state lifecycle_state,
  add column deprecated_on date,
  add column retirement_date date,
  add column retirement_not_before_date date,
  add column lifecycle_source_id uuid references sources (id) on delete set null,
  add column lifecycle_observed_at timestamptz,
  add constraint models_retirement_semantics_exclusive check (
    retirement_date is null or retirement_not_before_date is null
  );

comment on column models.lifecycle_state is 'Current authoritative lifecycle projection. Pricing ingestion must never write it.';
comment on column models.retirement_date is 'Exact retirement date explicitly published by an authoritative lifecycle source.';
comment on column models.retirement_not_before_date is 'Lower-bound retirement guarantee from wording such as Not sooner than <date>; not an exact schedule.';

create index models_lifecycle_source_id_idx on models (lifecycle_source_id);
create index models_lifecycle_state_idx on models (provider_id, lifecycle_state);

create table model_aliases (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references providers (id) on delete cascade,
  model_id      uuid not null references models (id) on delete cascade,
  source_id     uuid references sources (id) on delete set null,
  alias         text not null,
  alias_type    text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint model_aliases_alias_not_blank check (length(btrim(alias)) > 0),
  constraint model_aliases_type_known check (alias_type in ('api_model_id', 'source_name'))
);

comment on table model_aliases is 'Provider-native identifiers that resolve collector-specific names to one canonical model row.';

create unique index model_aliases_provider_alias_key
  on model_aliases (provider_id, alias_type, alias);
create unique index model_aliases_one_api_id_per_model
  on model_aliases (model_id) where alias_type = 'api_model_id';
create index model_aliases_model_id_idx on model_aliases (model_id);
create index model_aliases_source_id_idx on model_aliases (source_id);

create trigger model_aliases_set_updated_at
  before update on model_aliases
  for each row execute function set_updated_at();

create table lifecycle_snapshots (
  id                         uuid primary key default gen_random_uuid(),
  run_id                     uuid not null references collection_runs (id) on delete cascade,
  source_id                  uuid not null references sources (id) on delete cascade,
  provider_id                uuid not null references providers (id) on delete cascade,
  model_id                   uuid not null references models (id) on delete cascade,
  api_model_id               text not null,
  lifecycle_state            lifecycle_state not null,
  deprecated_on              date,
  retirement_date            date,
  retirement_not_before_date date,
  source_url                 text not null,
  raw                        jsonb,
  observed_at                timestamptz not null,
  created_at                 timestamptz not null default now(),

  -- A generated column must be immutable. `enum::text` (enum_out) and
  -- `date::text` (date_out) are only STABLE — date_out depends on DateStyle —
  -- so both are spelled out immutably here: the enum via a literal CASE, and
  -- each date as its integer day offset from the epoch.
  content_hash text generated always as (
    md5(
      (case lifecycle_state
         when 'active'     then 'active'
         when 'legacy'     then 'legacy'
         when 'deprecated' then 'deprecated'
         when 'retired'    then 'retired'
       end) || '|' ||
      coalesce((deprecated_on - date '1970-01-01')::text, '') || '|' ||
      coalesce((retirement_date - date '1970-01-01')::text, '') || '|' ||
      coalesce((retirement_not_before_date - date '1970-01-01')::text, '')
    )
  ) stored,

  constraint lifecycle_snapshots_api_model_id_not_blank check (length(btrim(api_model_id)) > 0),
  constraint lifecycle_snapshots_retirement_semantics_exclusive check (
    retirement_date is null or retirement_not_before_date is null
  )
);

comment on table lifecycle_snapshots is 'Append-only authoritative lifecycle observations. Absence from a later run is not itself a state transition.';
comment on column lifecycle_snapshots.retirement_not_before_date is 'A lower bound, never an exact retirement date.';

create unique index lifecycle_snapshots_run_api_model_key
  on lifecycle_snapshots (run_id, api_model_id);
create index lifecycle_snapshots_model_observed_idx
  on lifecycle_snapshots (model_id, observed_at desc);
create index lifecycle_snapshots_provider_observed_idx
  on lifecycle_snapshots (provider_id, observed_at desc);
create index lifecycle_snapshots_run_id_idx on lifecycle_snapshots (run_id);
create index lifecycle_snapshots_source_id_idx on lifecycle_snapshots (source_id);

alter table change_events
  add column previous_lifecycle_snapshot_id uuid references lifecycle_snapshots (id) on delete set null,
  add column current_lifecycle_snapshot_id uuid references lifecycle_snapshots (id) on delete set null;

create index change_events_previous_lifecycle_snapshot_id_idx
  on change_events (previous_lifecycle_snapshot_id);
create index change_events_current_lifecycle_snapshot_id_idx
  on change_events (current_lifecycle_snapshot_id);

create view latest_lifecycle_snapshots
with (security_invoker = true) as
select distinct on (ls.model_id, ls.api_model_id)
  ls.*,
  m.model_name,
  p.slug as provider_slug,
  p.name as provider_name
from lifecycle_snapshots ls
join models m on m.id = ls.model_id
join providers p on p.id = ls.provider_id
order by ls.model_id, ls.api_model_id, ls.observed_at desc, ls.created_at desc;

create view latest_comparable_lifecycle_snapshots
with (security_invoker = true) as
select distinct on (ls.model_id, ls.api_model_id)
  ls.*,
  m.model_name,
  p.slug as provider_slug,
  p.name as provider_name
from lifecycle_snapshots ls
join collection_runs r on r.id = ls.run_id
join models m on m.id = ls.model_id
join providers p on p.id = ls.provider_id
where r.status in ('succeeded', 'partial')
order by ls.model_id, ls.api_model_id, ls.observed_at desc, ls.created_at desc;

alter table model_aliases enable row level security;
alter table lifecycle_snapshots enable row level security;

create policy "public read" on model_aliases
  for select to anon, authenticated using (true);
create policy "public read" on lifecycle_snapshots
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Operational detail is not public intelligence
--
-- `collection_runs` carries a "public read" policy so the dashboard can show
-- scraper health. RLS is row-level only, so adding `validation_errors` to that
-- table would have published per-record collector diagnostics — parse paths,
-- rejected field names, and (via `error_details`, which the lifecycle failure
-- path also fills with those diagnostics) internal failure payloads.
--
-- Column privileges are checked independently of RLS, so a column grant list
-- keeps the rows readable while hiding these two columns. A column-level
-- REVOKE alone would be a no-op here, because anon/authenticated hold a
-- table-level SELECT grant, so the table grant is dropped and re-issued per
-- column. Nothing anon-facing needs the excluded columns: `source_health` and
-- both comparable-snapshot views reference only id, status, counts, timestamps
-- and `error_message`.
-- ---------------------------------------------------------------------------

revoke select on collection_runs from anon, authenticated;

grant select (
  id, source_id, status, external_run_id, triggered_by, started_at,
  completed_at, records_seen, records_accepted, records_rejected,
  error_message, created_at
) on collection_runs to anon, authenticated;

comment on column collection_runs.validation_errors is 'Per-record collector rejection detail. Service-role only; not exposed to anon/authenticated.';
