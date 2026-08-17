-- Tier-scoped changes (for example a short and long input-price change for
-- one model) need distinct event identities. Whole-model lifecycle events
-- deliberately leave these columns NULL and are emitted once per model.

alter table change_events
  add column pricing_mode text,
  add column context_tier text;

comment on column change_events.pricing_mode is 'Pricing mode for a tier-scoped event; NULL for whole-model lifecycle events.';
comment on column change_events.context_tier is 'Context tier for a tier-scoped event; NULL for whole-model lifecycle events.';

drop index change_events_run_dedupe_key;

create unique index change_events_run_dedupe_key
  on change_events (
    run_id,
    model_id,
    change_type,
    field_name,
    pricing_mode,
    context_tier
  ) nulls not distinct;
