-- AI Radar — intelligence schema
--
-- Model: providers -> sources -> collection_runs -> pricing_snapshots
--                 -> models  -> pricing_snapshots
--                            -> change_events
--
-- Design notes:
--   * Every ingested price lives in `pricing_snapshots` as an append-only
--     historical row. Nothing is mutated in place, so the price history of a
--     model is just `select ... order by observed_at`.
--   * Idempotency: re-ingesting the same collection result is a no-op thanks
--     to the natural key (run_id, model_id, pricing_mode, context_tier).
--     History is still preserved because a *new* run produces new rows.
--   * Pricing lives in typed numeric columns. `extra` holds provider-specific
--     fields we do not model yet and `raw` exists only for audit — neither is
--     required to read a price.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type source_kind as enum (
  'pricing',
  'models',
  'changelog',
  'docs',
  'other'
);

create type run_status as enum (
  'running',
  'succeeded',
  'partial',
  'failed'
);

create type change_type as enum (
  'model_added',
  'model_removed',
  'price_increased',
  'price_decreased',
  'metadata_changed'
);

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- providers
-- ---------------------------------------------------------------------------

create table providers (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null,
  homepage_url text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint providers_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]*$')
);

comment on table providers is 'An AI provider we track (OpenAI, Anthropic, ...).';
comment on column providers.slug is 'Stable lowercase identifier used by ingestion code.';

create trigger providers_set_updated_at
  before update on providers
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- sources
-- ---------------------------------------------------------------------------

create table sources (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references providers (id) on delete cascade,
  kind         source_kind not null default 'pricing',
  -- Provenance: which Bright Data collector produced this, and from where.
  collector_id text,
  source_url   text not null,
  label        text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table sources is 'A collectable endpoint belonging to a provider. A provider may have many.';
comment on column sources.collector_id is 'Bright Data collector id, e.g. c_msx3bqlyjtv2qustx.';
comment on column sources.source_url is 'Canonical URL the data was collected from.';

-- One logical source per (provider, kind, url). Collector id is provenance,
-- not identity: a collector can be swapped without forking the history.
create unique index sources_provider_kind_url_key
  on sources (provider_id, kind, source_url);

create index sources_provider_id_idx on sources (provider_id);
create index sources_collector_id_idx on sources (collector_id)
  where collector_id is not null;

create trigger sources_set_updated_at
  before update on sources
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- models
-- ---------------------------------------------------------------------------

create table models (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references providers (id) on delete cascade,
  model_name    text not null,
  display_name  text,
  -- Non-pricing model attributes (modality, family, deprecation notes, ...).
  metadata      jsonb not null default '{}'::jsonb,
  is_active     boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint models_model_name_not_blank check (length(btrim(model_name)) > 0)
);

comment on table models is 'A model offered by a provider, identified by the provider-native name.';
comment on column models.is_active is 'False only when an authoritative model-inventory/deprecation source confirms removal. Pricing collectors must not deactivate models for absence.';

create unique index models_provider_name_key on models (provider_id, model_name);
create index models_provider_id_idx on models (provider_id);
create index models_active_idx on models (provider_id) where is_active;

create trigger models_set_updated_at
  before update on models
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- collection_runs
-- ---------------------------------------------------------------------------

create table collection_runs (
  id                uuid primary key default gen_random_uuid(),
  source_id         uuid not null references sources (id) on delete cascade,
  status            run_status not null default 'running',
  -- Bright Data snapshot / job id, when the collector reports one.
  external_run_id   text,
  triggered_by      text not null default 'manual',
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  records_seen      integer not null default 0,
  records_accepted  integer not null default 0,
  records_rejected  integer not null default 0,
  error_message     text,
  error_details     jsonb,
  created_at        timestamptz not null default now(),

  constraint collection_runs_counts_non_negative check (
    records_seen >= 0 and records_accepted >= 0 and records_rejected >= 0
  ),
  constraint collection_runs_counts_balance check (
    records_accepted + records_rejected <= records_seen
  ),
  -- A run is finished exactly when it has a completion timestamp.
  constraint collection_runs_completion_consistent check (
    (status = 'running' and completed_at is null)
    or (status <> 'running' and completed_at is not null)
  ),
  constraint collection_runs_failure_has_reason check (
    status <> 'failed' or error_message is not null
  ),
  constraint collection_runs_completed_after_start check (
    completed_at is null or completed_at >= started_at
  )
);

comment on table collection_runs is 'One execution of a collector against a source; the unit of scraper health.';
comment on column collection_runs.external_run_id is 'Bright Data snapshot id, for tracing back to the vendor.';

-- Re-delivering the same Bright Data snapshot must not create a second run.
create unique index collection_runs_source_external_key
  on collection_runs (source_id, external_run_id)
  where external_run_id is not null;

create index collection_runs_source_started_idx
  on collection_runs (source_id, started_at desc);
create index collection_runs_status_started_idx
  on collection_runs (status, started_at desc);

-- ---------------------------------------------------------------------------
-- pricing_snapshots
-- ---------------------------------------------------------------------------

create table pricing_snapshots (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references collection_runs (id) on delete cascade,
  source_id   uuid not null references sources (id) on delete cascade,
  provider_id uuid not null references providers (id) on delete cascade,
  model_id    uuid not null references models (id) on delete cascade,

  -- Pricing dimensions. Not null with defaults so they are usable in a unique
  -- key; providers without the concept fall back to 'standard' / 'default'.
  pricing_mode  text not null default 'standard',
  context_tier  text not null default 'default',

  -- Typed price columns. Null means "the provider does not offer this".
  input_price_per_1m_tokens        numeric(20, 8),
  cached_input_price_per_1m_tokens numeric(20, 8),
  cache_write_price_per_1m_tokens  numeric(20, 8),
  output_price_per_1m_tokens       numeric(20, 8),

  currency     text not null default 'USD',
  pricing_unit text not null default 'USD per 1M tokens',

  -- Provenance + auditability.
  source_url  text,
  extra       jsonb not null default '{}'::jsonb,
  raw         jsonb,

  observed_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),

  -- Fingerprint of the priced values, used to detect "nothing changed".
  content_hash text generated always as (
    md5(
      coalesce(input_price_per_1m_tokens::text, '') || '|' ||
      coalesce(cached_input_price_per_1m_tokens::text, '') || '|' ||
      coalesce(cache_write_price_per_1m_tokens::text, '') || '|' ||
      coalesce(output_price_per_1m_tokens::text, '') || '|' ||
      currency || '|' || pricing_unit
    )
  ) stored,

  constraint pricing_snapshots_prices_non_negative check (
    coalesce(input_price_per_1m_tokens, 0) >= 0
    and coalesce(cached_input_price_per_1m_tokens, 0) >= 0
    and coalesce(cache_write_price_per_1m_tokens, 0) >= 0
    and coalesce(output_price_per_1m_tokens, 0) >= 0
  ),
  constraint pricing_snapshots_has_a_price check (
    input_price_per_1m_tokens is not null
    or cached_input_price_per_1m_tokens is not null
    or cache_write_price_per_1m_tokens is not null
    or output_price_per_1m_tokens is not null
  ),
  constraint pricing_snapshots_currency_format check (currency ~ '^[A-Z]{3}$')
);

comment on table pricing_snapshots is 'Append-only price observations. One row per (run, model, pricing mode, context tier).';
comment on column pricing_snapshots.extra is 'Provider-specific priced fields not yet modelled as columns.';
comment on column pricing_snapshots.raw is 'Verbatim collector record, kept for audit only.';
comment on column pricing_snapshots.content_hash is 'Fingerprint of priced values; equal hashes mean the price did not move.';

-- Idempotency: re-ingesting the same collection result upserts instead of
-- duplicating. A different run still writes its own row, preserving history.
create unique index pricing_snapshots_run_model_variant_key
  on pricing_snapshots (run_id, model_id, pricing_mode, context_tier);

-- "Latest price for this model" and history reads.
create index pricing_snapshots_model_observed_idx
  on pricing_snapshots (model_id, observed_at desc);
create index pricing_snapshots_provider_observed_idx
  on pricing_snapshots (provider_id, observed_at desc);
create index pricing_snapshots_run_id_idx on pricing_snapshots (run_id);
create index pricing_snapshots_source_id_idx on pricing_snapshots (source_id);

-- ---------------------------------------------------------------------------
-- change_events
-- ---------------------------------------------------------------------------

create table change_events (
  id          uuid primary key default gen_random_uuid(),
  provider_id uuid not null references providers (id) on delete cascade,
  source_id   uuid references sources (id) on delete set null,
  run_id      uuid references collection_runs (id) on delete set null,
  -- Null only for events that are not about a specific model.
  model_id    uuid references models (id) on delete cascade,

  change_type change_type not null,
  -- Which field moved, for price_* and metadata_changed events.
  field_name  text,
  old_value   jsonb,
  new_value   jsonb,
  -- The snapshots being compared, when the event came from a price diff.
  previous_snapshot_id uuid references pricing_snapshots (id) on delete set null,
  current_snapshot_id  uuid references pricing_snapshots (id) on delete set null,

  summary     text,
  detected_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),

  constraint change_events_price_change_has_field check (
    change_type not in ('price_increased', 'price_decreased')
    or field_name is not null
  )
);

comment on table change_events is 'Human-meaningful diffs derived from consecutive snapshots.';

-- Recomputing change detection for a run must not duplicate events.
create unique index change_events_run_dedupe_key
  on change_events (run_id, model_id, change_type, field_name)
  nulls not distinct;

create index change_events_detected_idx on change_events (detected_at desc);
create index change_events_provider_detected_idx
  on change_events (provider_id, detected_at desc);
-- Deliberately not partial: a partial index cannot back the foreign key's
-- cascade lookup, which would leave model deletes doing a sequential scan.
create index change_events_model_detected_idx
  on change_events (model_id, detected_at desc);
create index change_events_source_id_idx on change_events (source_id);
create index change_events_run_id_idx on change_events (run_id);
create index change_events_previous_snapshot_id_idx
  on change_events (previous_snapshot_id);
create index change_events_current_snapshot_id_idx
  on change_events (current_snapshot_id);

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

-- Current price for every (model, pricing mode, context tier).
create view latest_pricing_snapshots
with (security_invoker = true) as
select distinct on (ps.model_id, ps.pricing_mode, ps.context_tier)
  ps.*,
  m.model_name,
  p.slug as provider_slug,
  p.name as provider_name
from pricing_snapshots ps
join models m on m.id = ps.model_id
join providers p on p.id = ps.provider_id
order by ps.model_id, ps.pricing_mode, ps.context_tier, ps.observed_at desc, ps.created_at desc;

-- Scraper health at a glance: the most recent run per source.
create view source_health
with (security_invoker = true) as
select distinct on (s.id)
  s.id as source_id,
  s.provider_id,
  s.kind,
  s.collector_id,
  s.source_url,
  s.is_active,
  r.id as last_run_id,
  r.status as last_run_status,
  r.started_at as last_run_started_at,
  r.completed_at as last_run_completed_at,
  r.records_seen,
  r.records_accepted,
  r.records_rejected,
  r.error_message
from sources s
left join collection_runs r on r.source_id = s.id
order by s.id, r.started_at desc nulls last;

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Public read / private write: anon and authenticated may select, nobody may
-- write. Ingestion runs with the service role key, which bypasses RLS.
-- ---------------------------------------------------------------------------

alter table providers          enable row level security;
alter table sources            enable row level security;
alter table models             enable row level security;
alter table collection_runs    enable row level security;
alter table pricing_snapshots  enable row level security;
alter table change_events      enable row level security;

create policy "public read" on providers
  for select to anon, authenticated using (true);
create policy "public read" on sources
  for select to anon, authenticated using (true);
create policy "public read" on models
  for select to anon, authenticated using (true);
create policy "public read" on collection_runs
  for select to anon, authenticated using (true);
create policy "public read" on pricing_snapshots
  for select to anon, authenticated using (true);
create policy "public read" on change_events
  for select to anon, authenticated using (true);
