-- Schema behaviour checks. Run against a freshly reset database — this script
-- writes rows and grants privileges, so it is not safe against real data.
--
--   npx supabase db reset
--   psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2-)" \
--     -f supabase/tests/schema_checks.sql
--
-- Every check either prints a PASS notice or aborts. TEST 10 must return zero
-- rows: it asserts that every foreign key is backed by an index.

\set ON_ERROR_STOP on

-- Register a model and a run against the seeded OpenAI pricing source.
insert into models (provider_id, model_name)
select id, 'gpt-5.6-sol' from providers where slug = 'openai';

insert into collection_runs (source_id, external_run_id, triggered_by)
select id, 'snap_001', 'cron' from sources where collector_id = 'c_msx3bqlyjtv2qustx';

-- Ingest the representative record.
insert into pricing_snapshots (
  run_id, source_id, provider_id, model_id, pricing_mode, context_tier,
  input_price_per_1m_tokens, cached_input_price_per_1m_tokens,
  cache_write_price_per_1m_tokens, output_price_per_1m_tokens,
  pricing_unit, source_url, raw
)
select r.id, s.id, p.id, m.id, 'standard', 'short',
       5, 0.5, 6.25, 30,
       'USD per 1M tokens', 'https://developers.openai.com/api/docs/pricing',
       '{"provider":"OpenAI","model_name":"gpt-5.6-sol"}'::jsonb
from collection_runs r
join sources s on s.id = r.source_id
join providers p on p.id = s.provider_id
join models m on m.provider_id = p.id and m.model_name = 'gpt-5.6-sol';

\echo '--- TEST 1: re-ingesting the same run is idempotent (expect 1 row) ---'
insert into pricing_snapshots (
  run_id, source_id, provider_id, model_id, pricing_mode, context_tier,
  input_price_per_1m_tokens, output_price_per_1m_tokens
)
select ps.run_id, ps.source_id, ps.provider_id, ps.model_id,
       ps.pricing_mode, ps.context_tier, 5, 30
from pricing_snapshots ps
on conflict (run_id, model_id, pricing_mode, context_tier) do nothing;
select count(*) as snapshot_count from pricing_snapshots;

\echo '--- TEST 2: a second run preserves history (expect 2 rows, 1 latest) ---'
insert into collection_runs (source_id, external_run_id, status, completed_at,
                             records_seen, records_accepted)
select id, 'snap_002', 'succeeded', now(), 1, 1
from sources where collector_id = 'c_msx3bqlyjtv2qustx';

insert into pricing_snapshots (
  run_id, source_id, provider_id, model_id, pricing_mode, context_tier,
  input_price_per_1m_tokens, cached_input_price_per_1m_tokens,
  cache_write_price_per_1m_tokens, output_price_per_1m_tokens, observed_at
)
select r.id, s.id, s.provider_id, m.id, 'standard', 'short',
       7, 0.5, 6.25, 30, now() + interval '1 hour'
from collection_runs r
join sources s on s.id = r.source_id
join models m on m.model_name = 'gpt-5.6-sol'
where r.external_run_id = 'snap_002';

select count(*) as history_rows from pricing_snapshots;
select model_name, input_price_per_1m_tokens as latest_input_price,
       context_tier, provider_slug
from latest_pricing_snapshots;

\echo '--- TEST 3: content_hash changes only when a price moves ---'
select input_price_per_1m_tokens, content_hash
from pricing_snapshots order by observed_at;

\echo '--- TEST 4: duplicate external_run_id per source is rejected ---'
do $$
begin
  insert into collection_runs (source_id, external_run_id)
  select id, 'snap_001' from sources where collector_id = 'c_msx3bqlyjtv2qustx';
  raise exception 'FAIL: duplicate external_run_id was accepted';
exception when unique_violation then
  raise notice 'PASS: duplicate external_run_id rejected';
end $$;

\echo '--- TEST 5: change_events dedupe with NULL field_name ---'
insert into change_events (provider_id, run_id, model_id, change_type, field_name,
                           old_value, new_value, summary)
select s.provider_id, r.id, m.id, 'price_increased', 'input_price_per_1m_tokens',
       '5'::jsonb, '7'::jsonb, 'input price up 40%'
from collection_runs r
join sources s on s.id = r.source_id
join models m on m.model_name = 'gpt-5.6-sol'
where r.external_run_id = 'snap_002';

insert into change_events (provider_id, run_id, model_id, change_type, field_name)
select s.provider_id, r.id, m.id, 'model_added', null
from collection_runs r
join sources s on s.id = r.source_id
join models m on m.model_name = 'gpt-5.6-sol'
where r.external_run_id = 'snap_001';

-- Re-running detection over the same run must not duplicate (expect 2 total).
insert into change_events (provider_id, run_id, model_id, change_type, field_name)
select provider_id, run_id, model_id, change_type, field_name from change_events
on conflict (run_id, model_id, change_type, field_name, pricing_mode, context_tier) do nothing;
select count(*) as change_event_count from change_events;

\echo '--- TEST 6: run status/completion consistency is enforced ---'
do $$
begin
  update collection_runs set status = 'succeeded'
  where external_run_id = 'snap_001';
  raise exception 'FAIL: succeeded run without completed_at was accepted';
exception when check_violation then
  raise notice 'PASS: completion consistency enforced';
end $$;

do $$
begin
  update collection_runs set status = 'failed', completed_at = now()
  where external_run_id = 'snap_001';
  raise exception 'FAIL: failed run without error_message was accepted';
exception when check_violation then
  raise notice 'PASS: failed run requires an error_message';
end $$;

do $$
begin
  update collection_runs set records_seen = 1, records_accepted = 5
  where external_run_id = 'snap_002';
  raise exception 'FAIL: accepted+rejected > seen was accepted';
exception when check_violation then
  raise notice 'PASS: run counts must balance';
end $$;

\echo '--- TEST 7: a snapshot with no prices at all is rejected ---'
do $$
begin
  insert into pricing_snapshots (run_id, source_id, provider_id, model_id,
                                 pricing_mode, context_tier)
  select run_id, source_id, provider_id, model_id, 'batch', 'long'
  from pricing_snapshots limit 1;
  raise exception 'FAIL: priceless snapshot was accepted';
exception when check_violation then
  raise notice 'PASS: snapshot must carry at least one price';
end $$;

\echo '--- TEST 8: content_hash is not writable ---'
do $$
begin
  update pricing_snapshots set content_hash = 'nope';
  raise exception 'FAIL: content_hash was writable';
exception when generated_always then
  raise notice 'PASS: content_hash is generated-always';
end $$;

\echo '--- TEST 9: source_health view ---'
select collector_id, last_run_status, records_seen, records_accepted
from source_health;

\echo '--- TEST 10: every FK is index-backed ---'
select c.conrelid::regclass as tbl, c.conname
from pg_constraint c
where c.contype = 'f'
  and c.connamespace = 'public'::regnamespace
  and not exists (
    select 1 from pg_index i
    where i.indrelid = c.conrelid
      and (i.indkey::smallint[])[0:array_length(c.conkey, 1) - 1] @> c.conkey
      and i.indpred is null
  );

\echo '--- TEST 11: RLS blocks writes but allows reads for anon ---'
grant usage on schema public to anon;
grant select on all tables in schema public to anon;

-- On Supabase the `anon` SELECT above arrives through ALTER DEFAULT PRIVILEGES,
-- so it lands at CREATE TABLE time and each migration's later REVOKE wins. Here
-- the grant is replayed *after* the migrations, so it would silently re-open
-- every column those migrations withheld and TESTs 14 and 16 would report a
-- leak that production does not have. Restore each withheld surface so this
-- environment matches production exactly.
--
-- Keep this list in step with the REVOKEs in:
--   20260817000003 (collection_runs), 20260817000004 (Sentinel),
--   20260818000001 (orchestration_runs), 20260819000000 (demo events).
revoke select on collection_runs from anon;
grant select (
  id, source_id, status, external_run_id, triggered_by, started_at,
  completed_at, records_seen, records_accepted, records_rejected,
  error_message, created_at
) on collection_runs to anon;

-- Verbatim malformed scraper output and DOM traces: service-role only.
revoke select on sentinel_quarantine_payloads from anon;

revoke select on sentinel_healing_attempts from anon;
grant select (
  id, incident_id, source_id, collector_id, attempt_number,
  prompt, status, refactor_job_id, candidate_records_count,
  candidate_passed_validation, error_message, started_at,
  completed_at, created_at
) on sentinel_healing_attempts to anon;

revoke select on orchestration_runs from anon;
grant select (
  id, source_key, provider_slug, source_type, status, trigger,
  attempt_count, started_at, completed_at, duration_ms, lease_expires_at,
  collection_run_id, sentinel_incident_id, records_accepted, records_rejected,
  changes_detected, outcome, reason_codes, created_at
) on orchestration_runs to anon;

revoke select on sentinel_demo_events from anon;
grant select (
  id, source_key, phase, action, status, summary, run_id, incident_id, created_at
) on sentinel_demo_events to anon;

grant insert on providers to anon;
set role anon;
select count(*) as anon_can_read_providers from providers;
select count(*) as anon_can_read_latest from latest_pricing_snapshots;
do $$
begin
  insert into providers (slug, name) values ('anthropic', 'Anthropic');
  raise exception 'FAIL: anon was able to write';
exception when insufficient_privilege then
  raise notice 'PASS: anon cannot write';
end $$;
reset role;

\echo '--- TEST 15: Gemini nullable-state evidence and replacement history ---'
insert into providers (slug, name, homepage_url)
values ('gemini', 'Google', 'https://ai.google.dev')
on conflict (slug) do update set name = excluded.name;

insert into sources (provider_id, kind, collector_id, source_url, label)
select id, 'models', 'c_msxqpelk2cpxz8r386',
       'https://ai.google.dev/gemini-api/docs/deprecations',
       'Gemini lifecycle'
from providers where slug = 'gemini';

insert into models (provider_id, model_name, lifecycle_state,
                    retirement_not_before_date)
select id, 'Gemini 2.5 Pro', 'deprecated', date '2027-05-07'
from providers where slug = 'gemini';

insert into collection_runs (
  source_id, external_run_id, status, completed_at, records_seen, records_accepted
)
select id, run_id, 'succeeded', now(), 1, 1
from sources
cross join (values ('gemini_lifecycle_1'), ('gemini_lifecycle_2')) runs(run_id)
where collector_id = 'c_msxqpelk2cpxz8r386';

insert into lifecycle_snapshots (
  run_id, source_id, provider_id, model_id, api_model_id, lifecycle_state,
  retirement_not_before_date, retirement_not_before_observation,
  recommended_replacement, recommended_replacement_observed,
  source_metadata, source_url, observed_at
)
select r.id, s.id, p.id, m.id, 'gemini-2.5-pro',
       case r.external_run_id
         when 'gemini_lifecycle_1' then 'deprecated'::lifecycle_state
         else null
       end,
       case r.external_run_id
         when 'gemini_lifecycle_1' then date '2027-05-07'
         else null
       end,
       case r.external_run_id
         when 'gemini_lifecycle_1' then 'date'
         else 'explicitly_unannounced'
       end,
       'gemini-3-pro-preview', true,
       '{"modelStage":"stable","isShutdown":false}'::jsonb,
       s.source_url,
       case r.external_run_id
         when 'gemini_lifecycle_1' then now() + interval '2 hours'
         else now() + interval '3 hours'
       end
from collection_runs r
join sources s on s.id = r.source_id
join providers p on p.id = s.provider_id
join models m on m.provider_id = p.id
where r.external_run_id in ('gemini_lifecycle_1', 'gemini_lifecycle_2');

select count(*) as gemini_lifecycle_history_rows
from lifecycle_snapshots ls
join providers p on p.id = ls.provider_id
where p.slug = 'gemini';

select api_model_id, lifecycle_state, projected_lifecycle_state,
       retirement_not_before_observation, recommended_replacement
from latest_lifecycle_snapshots
where provider_slug = 'gemini';

\echo '--- TEST 12: lifecycle history and retirement semantics ---'
insert into providers (slug, name, homepage_url)
values ('anthropic', 'Anthropic', 'https://www.anthropic.com')
on conflict (slug) do update set name = excluded.name;

insert into sources (provider_id, kind, collector_id, source_url, label)
select id, 'models', 'c_msxj0fk3153bu9oz7l',
       'https://platform.claude.com/docs/en/about-claude/model-deprecations',
       'Anthropic lifecycle'
from providers where slug = 'anthropic';

insert into models (provider_id, model_name)
select id, 'Claude Opus 4.1' from providers where slug = 'anthropic';

insert into model_aliases (provider_id, model_id, source_id, alias, alias_type)
select p.id, m.id, s.id, 'claude-opus-4-1-20250805', 'api_model_id'
from providers p
join models m on m.provider_id = p.id
join sources s on s.provider_id = p.id and s.kind = 'models'
where p.slug = 'anthropic';

insert into collection_runs (
  source_id, external_run_id, status, completed_at, records_seen, records_accepted
)
select id, run_id, 'succeeded', now(), 1, 1
from sources
cross join (values ('anthropic_lifecycle_1'), ('anthropic_lifecycle_2')) runs(run_id)
where collector_id = 'c_msxj0fk3153bu9oz7l';

insert into lifecycle_snapshots (
  run_id, source_id, provider_id, model_id, api_model_id, lifecycle_state,
  retirement_date, retirement_not_before_date,
  retirement_not_before_observation, source_url, observed_at
)
select r.id, s.id, p.id, m.id, 'claude-opus-4-1-20250805',
       case r.external_run_id
         when 'anthropic_lifecycle_1' then 'deprecated'::lifecycle_state
         else 'retired'::lifecycle_state
       end,
       case r.external_run_id
         when 'anthropic_lifecycle_2' then date '2026-12-17'
         else null
       end,
       case r.external_run_id
         when 'anthropic_lifecycle_1' then date '2026-08-05'
         else null
       end,
       case r.external_run_id
         when 'anthropic_lifecycle_1' then 'date'
         else 'unobserved'
       end,
       s.source_url,
       case r.external_run_id
         when 'anthropic_lifecycle_1' then now()
         else now() + interval '1 hour'
       end
from collection_runs r
join sources s on s.id = r.source_id
join providers p on p.id = s.provider_id
join models m on m.provider_id = p.id
where r.external_run_id in ('anthropic_lifecycle_1', 'anthropic_lifecycle_2');

select count(*) as lifecycle_history_rows from lifecycle_snapshots;
select api_model_id, lifecycle_state, retirement_date,
       retirement_not_before_date
from latest_lifecycle_snapshots
where provider_slug = 'anthropic';

do $$
begin
  insert into lifecycle_snapshots (
    run_id, source_id, provider_id, model_id, api_model_id, lifecycle_state,
    retirement_date, retirement_not_before_date, source_url, observed_at
  )
  select run_id, source_id, provider_id, model_id,
         'claude-invalid-retirement', 'active', current_date, current_date,
         source_url, now()
  from lifecycle_snapshots limit 1;
  raise exception 'FAIL: exact and not-before retirement dates were both accepted';
exception when check_violation then
  raise notice 'PASS: retirement semantics are mutually exclusive';
end $$;

\echo '--- TEST 13: re-ingesting one lifecycle run is idempotent ---'
insert into lifecycle_snapshots (
  run_id, source_id, provider_id, model_id, api_model_id, lifecycle_state,
  source_url, observed_at
)
select run_id, source_id, provider_id, model_id, api_model_id, lifecycle_state,
       source_url, observed_at
from lifecycle_snapshots
on conflict (run_id, api_model_id) do nothing;
select count(*) as lifecycle_rows_after_replay from lifecycle_snapshots;

\echo '--- TEST 14: collector diagnostics are not public ---'
set role anon;
do $$
begin
  perform validation_errors from collection_runs;
  raise exception 'FAIL: anon can read collection_runs.validation_errors';
exception when insufficient_privilege then
  raise notice 'PASS: anon cannot read validation_errors';
end $$;
do $$
begin
  perform error_details from collection_runs;
  raise exception 'FAIL: anon can read collection_runs.error_details';
exception when insufficient_privilege then
  raise notice 'PASS: anon cannot read error_details';
end $$;
-- The health panel still works: it never selects the diagnostic columns.
select count(*) as anon_can_read_source_health from source_health;
select count(*) as anon_can_read_lifecycle from latest_lifecycle_snapshots;
reset role;

\echo '--- TEST 16: Sentinel quarantine and incident RLS ---'
set role anon;
do $$
begin
  perform raw_payload from sentinel_quarantine_payloads;
  raise exception 'FAIL: anon can read sentinel_quarantine_payloads';
exception when insufficient_privilege then
  raise notice 'PASS: anon cannot read sentinel_quarantine_payloads';
end $$;
do $$
begin
  perform validation_details from sentinel_healing_attempts;
  raise exception 'FAIL: anon can read sentinel_healing_attempts.validation_details';
exception when insufficient_privilege then
  raise notice 'PASS: anon cannot read sentinel_healing_attempts.validation_details';
end $$;
select count(*) as anon_can_read_sentinel_source_health from sentinel_source_health;
select count(*) as anon_can_read_sentinel_incidents from sentinel_incidents;
reset role;

\echo '--- TEST 17: orchestration and demo diagnostics are not public ---'
-- Both columns echo verbatim collector output and Bright Data diagnostics. The
-- migrations withhold them; nothing had asserted it, so a future blanket grant
-- could have re-opened them unnoticed.
set role anon;
do $$
begin
  perform error_message from orchestration_runs;
  raise exception 'FAIL: anon can read orchestration_runs.error_message';
exception when insufficient_privilege then
  raise notice 'PASS: anon cannot read orchestration_runs.error_message';
end $$;
do $$
begin
  perform detail from sentinel_demo_events;
  raise exception 'FAIL: anon can read sentinel_demo_events.detail';
exception when insufficient_privilege then
  raise notice 'PASS: anon cannot read sentinel_demo_events.detail';
end $$;
-- The safe columns must still be readable, or the public read model is broken.
select count(*) as anon_can_read_orchestration_status from orchestration_runs;
select count(*) as anon_can_read_demo_events
from (select id, source_key, phase, action, status from sentinel_demo_events) as safe_columns;
reset role;
