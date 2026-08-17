-- A failed run may contain valid snapshots but no change events when the
-- later event upsert fails. Keep those observations as history, but never use
-- them as a baseline that could suppress deterministic event recovery.

create view latest_comparable_pricing_snapshots
with (security_invoker = true) as
select distinct on (ps.model_id, ps.pricing_mode, ps.context_tier)
  ps.*,
  m.model_name,
  p.slug as provider_slug,
  p.name as provider_name
from pricing_snapshots ps
join collection_runs r on r.id = ps.run_id
join models m on m.id = ps.model_id
join providers p on p.id = ps.provider_id
where r.status in ('succeeded', 'partial')
order by ps.model_id, ps.pricing_mode, ps.context_tier, ps.observed_at desc, ps.created_at desc;

comment on view latest_comparable_pricing_snapshots is 'Latest pricing state from successful or partial collection runs, used as a change-detection baseline.';
