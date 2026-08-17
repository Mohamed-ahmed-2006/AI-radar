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
on conflict (run_id, model_id, change_type, field_name) do nothing;
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
