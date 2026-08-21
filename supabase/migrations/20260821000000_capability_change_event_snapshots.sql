-- Capability change events get their own snapshot references.
--
-- `change_events.previous_snapshot_id` / `current_snapshot_id` reference
-- `pricing_snapshots`, and their comment has always said so: "the snapshots
-- being compared, when the event came from a price diff". The lifecycle domain
-- got its own pair in 20260817000003. The capability domain never did — but the
-- read model already reads `previous_capability_snapshot_id`, and the catalog
-- pipeline was writing a `capability_snapshots` id into the *pricing* column.
--
-- That combination could not fail until a capability actually changed. It never
-- had: Anthropic's context window and max output normalized to null on every
-- run, so consecutive runs were identical and no diff was produced. The moment
-- the normalizer started reading "1M tokens", the first real capability diff hit
-- `change_events_current_snapshot_id_fkey` and took the whole run down with it.
--
-- Additive and nullable: no existing row changes, and no reader that ignores
-- these columns is affected.

alter table change_events
  add column if not exists previous_capability_snapshot_id uuid
    references capability_snapshots (id) on delete set null,
  add column if not exists current_capability_snapshot_id uuid
    references capability_snapshots (id) on delete set null;

comment on column change_events.previous_capability_snapshot_id is
  'The capability observation a capability_changed event diffed away from.';
comment on column change_events.current_capability_snapshot_id is
  'The capability observation a capability_changed event diffed to.';

create index if not exists change_events_previous_capability_snapshot_id_idx
  on change_events (previous_capability_snapshot_id);
create index if not exists change_events_current_capability_snapshot_id_idx
  on change_events (current_capability_snapshot_id);
