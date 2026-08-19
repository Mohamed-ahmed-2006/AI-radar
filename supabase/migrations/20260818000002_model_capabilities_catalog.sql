-- AI Radar — authoritative model catalog & capabilities intelligence
--
-- Append-only snapshot history for model capabilities across OpenAI, Anthropic,
-- Google Gemini, and xAI.
--
-- Invariants:
--   * Catalog presence is capability evidence, NOT lifecycle authority.
--     Disappearance never deletes, deactivates, deprecates, or retires a model.
--   * Unknown is NOT false: boolean capability columns are nullable.
--     NULL = unknown / unobserved, TRUE = supported, FALSE = unsupported.
--   * Append-only history: every successful collection run produces new snapshots.
--     Idempotency on replay is ensured via unique (run_id, model_id, api_model_id).

alter type change_type add value if not exists 'capability_changed';
alter type source_kind add value if not exists 'catalog';

-- `array_to_string` is STABLE (it calls the element type's output function), so
-- it cannot appear in a generated column: PostgreSQL rejects the table with
-- "generation expression is not immutable" on every supported version. Joining
-- a `text[]` with a fixed delimiter genuinely is immutable — text output depends
-- on no session setting — so the guarantee is asserted here once, on the one
-- concrete type the catalog uses, rather than being assumed of the polymorphic
-- built-in.
create or replace function radar_join_text_array(value text[])
returns text
language sql
immutable
parallel safe
as $$ select coalesce(array_to_string(value, ','), '') $$;

comment on function radar_join_text_array(text[]) is
  'Immutable text[] join used by capability_snapshots.content_hash. Fixed delimiter, text elements: no session-dependent output.';

create table if not exists capability_snapshots (
  id                    uuid primary key default gen_random_uuid(),
  run_id                uuid not null references collection_runs (id) on delete cascade,
  source_id             uuid not null references sources (id) on delete cascade,
  provider_id           uuid not null references providers (id) on delete cascade,
  model_id              uuid not null references models (id) on delete cascade,
  api_model_id          text not null,

  display_name          text,
  model_family          text,
  model_stage           text,

  -- Precise numeric limits; NULL when unobserved or imprecise
  context_window        bigint,
  max_output_tokens     bigint,

  -- Three-state booleans: NULL (unknown), TRUE (supported), FALSE (unsupported)
  supports_vision       boolean,
  supports_tool_calling boolean,

  input_modalities      text[] not null default '{}',
  output_modalities     text[] not null default '{}',
  supported_features    text[] not null default '{}',

  source_url            text not null,
  extra                 jsonb not null default '{}'::jsonb,
  raw                   jsonb,

  observed_at           timestamptz not null default now(),
  created_at            timestamptz not null default now(),

  content_hash text generated always as (
    md5(
      coalesce(display_name, '') || '|' ||
      coalesce(model_family, '') || '|' ||
      coalesce(model_stage, '') || '|' ||
      coalesce(context_window::text, '') || '|' ||
      coalesce(max_output_tokens::text, '') || '|' ||
      coalesce(supports_vision::text, 'unknown') || '|' ||
      coalesce(supports_tool_calling::text, 'unknown') || '|' ||
      radar_join_text_array(input_modalities) || '|' ||
      radar_join_text_array(output_modalities) || '|' ||
      radar_join_text_array(supported_features)
    )
  ) stored,

  constraint capability_snapshots_api_model_id_not_blank check (length(btrim(api_model_id)) > 0),
  constraint capability_snapshots_context_window_positive check (context_window is null or context_window > 0),
  constraint capability_snapshots_max_output_tokens_positive check (max_output_tokens is null or max_output_tokens > 0)
);

comment on table capability_snapshots is 'Append-only historical capability observations extracted from authoritative provider documentation.';
comment on column capability_snapshots.supports_vision is 'NULL = unobserved/unknown, TRUE = explicitly supported, FALSE = explicitly unsupported.';
comment on column capability_snapshots.supports_tool_calling is 'NULL = unobserved/unknown, TRUE = explicitly supported, FALSE = explicitly unsupported.';

-- Natural idempotency key per collection run
create unique index if not exists capability_snapshots_run_model_api_id_key
  on capability_snapshots (run_id, model_id, api_model_id);

create index if not exists capability_snapshots_model_id_idx on capability_snapshots (model_id);
create index if not exists capability_snapshots_provider_id_idx on capability_snapshots (provider_id);
create index if not exists capability_snapshots_source_id_idx on capability_snapshots (source_id);
create index if not exists capability_snapshots_observed_at_idx on capability_snapshots (observed_at desc);

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

create or replace view latest_capability_snapshots
with (security_invoker = true) as
select distinct on (cs.model_id, cs.api_model_id)
  cs.*,
  m.model_name,
  p.slug as provider_slug,
  p.name as provider_name
from capability_snapshots cs
join models m on m.id = cs.model_id
join providers p on p.id = cs.provider_id
order by cs.model_id, cs.api_model_id, cs.observed_at desc, cs.created_at desc;

create or replace view latest_comparable_capability_snapshots
with (security_invoker = true) as
select distinct on (cs.model_id, cs.api_model_id)
  cs.*,
  m.model_name,
  p.slug as provider_slug,
  p.name as provider_name
from capability_snapshots cs
join collection_runs r on r.id = cs.run_id
join models m on m.id = cs.model_id
join providers p on p.id = cs.provider_id
where r.status in ('succeeded', 'partial')
order by cs.model_id, cs.api_model_id, cs.observed_at desc, cs.created_at desc;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table capability_snapshots enable row level security;

create policy "public read" on capability_snapshots
  for select to anon, authenticated using (true);

-- Allow orchestration of catalog sources
alter table orchestration_runs drop constraint if exists orchestration_runs_source_type_valid;
alter table orchestration_runs add constraint orchestration_runs_source_type_valid check (
  source_type in ('pricing', 'lifecycle', 'catalog')
);

