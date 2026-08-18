-- Gemini can publish lifecycle evidence without asserting an active state.
-- Extend the shared lifecycle history rather than introducing provider tables.

drop view latest_comparable_lifecycle_snapshots;
drop view latest_lifecycle_snapshots;

alter table lifecycle_snapshots
  alter column lifecycle_state drop not null,
  add column retirement_not_before_observation text not null default 'unobserved',
  add column recommended_replacement text,
  add column recommended_replacement_model_id uuid references models (id) on delete set null,
  add column recommended_replacement_observed boolean not null default false,
  add column source_metadata jsonb not null default '{}'::jsonb,
  add constraint lifecycle_snapshots_retirement_observation_known check (
    retirement_not_before_observation in (
      'unobserved', 'date', 'imprecise_date', 'explicitly_unannounced'
    )
  ),
  add constraint lifecycle_snapshots_replacement_observation_consistent check (
    recommended_replacement_observed or recommended_replacement is null
  ),
  add constraint lifecycle_snapshots_source_metadata_object check (
    jsonb_typeof(source_metadata) = 'object'
  );

-- Existing Anthropic lower bounds predate the observation discriminator.
update lifecycle_snapshots
set retirement_not_before_observation = 'date'
where retirement_not_before_date is not null;

alter table lifecycle_snapshots
  add constraint lifecycle_snapshots_retirement_date_observation_consistent check (
    (retirement_not_before_observation = 'date') =
    (retirement_not_before_date is not null)
  );

create index lifecycle_snapshots_recommended_replacement_model_id_idx
  on lifecycle_snapshots (recommended_replacement_model_id);

comment on column lifecycle_snapshots.lifecycle_state is
  'Nullable authoritative state assertion. NULL means the source row was observed but did not assert a canonical state.';
comment on column lifecycle_snapshots.retirement_not_before_observation is
  'Distinguishes a missing field, an exact lower-bound date, incomplete precision, and an explicit withdrawal.';
comment on column lifecycle_snapshots.recommended_replacement is
  'Provider-native recommended replacement identifier; it need not resolve to a canonical model.';
comment on column lifecycle_snapshots.recommended_replacement_model_id is
  'Optional canonical replacement resolution, populated only when identity is safe.';
comment on column lifecycle_snapshots.source_metadata is
  'Provider-specific source evidence such as group, stage, release text, and shutdown signal.';

alter table lifecycle_snapshots drop column content_hash;
alter table lifecycle_snapshots add column content_hash text generated always as (
  md5(
    coalesce(case lifecycle_state
      when 'active'     then 'active'
      when 'legacy'     then 'legacy'
      when 'deprecated' then 'deprecated'
      when 'retired'    then 'retired'
    end, '') || '|' ||
    coalesce((deprecated_on - date '1970-01-01')::text, '') || '|' ||
    coalesce((retirement_date - date '1970-01-01')::text, '') || '|' ||
    coalesce((retirement_not_before_date - date '1970-01-01')::text, '') || '|' ||
    retirement_not_before_observation || '|' ||
    case when recommended_replacement_observed then 'observed' else 'unobserved' end || '|' ||
    coalesce(recommended_replacement, '')
  )
) stored;

create view latest_lifecycle_snapshots
with (security_invoker = true) as
select distinct on (ls.model_id, ls.api_model_id)
  ls.*,
  m.model_name,
  m.lifecycle_state as projected_lifecycle_state,
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
  m.lifecycle_state as projected_lifecycle_state,
  p.slug as provider_slug,
  p.name as provider_name
from lifecycle_snapshots ls
join collection_runs r on r.id = ls.run_id
join models m on m.id = ls.model_id
join providers p on p.id = ls.provider_id
where r.status in ('succeeded', 'partial')
order by ls.model_id, ls.api_model_id, ls.observed_at desc, ls.created_at desc;
