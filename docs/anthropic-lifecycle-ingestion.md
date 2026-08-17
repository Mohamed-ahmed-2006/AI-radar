# Anthropic lifecycle ingestion

The authoritative lifecycle source is Anthropic's current model lifecycle table:

- Collector: `c_msxj0fk3153bu9oz7l`
- Source: `https://platform.claude.com/docs/en/about-claude/model-deprecations`
- Endpoint: `POST /api/ingest/anthropic/lifecycle`

The endpoint uses the same `x-ai-radar-ingest-secret` protection and Bright
Data run metadata as pricing ingestion. Its source kind is `models`, keeping it
separate from the existing Anthropic `pricing` source.

## Invariants

- Pricing collection never writes lifecycle columns and never deactivates a
  model because a price row disappeared.
- Only validated `Active`, `Legacy`, `Deprecated`, or `Retired` rows from the
  lifecycle pipeline update the current projection on `models`.
- A row missing from a later lifecycle run is not evidence of retirement.
- `Not sooner than <date>` is stored in `retirement_not_before_date`; it is
  never stored in `retirement_date`.
- Every accepted run appends `lifecycle_snapshots`; retirement does not delete
  lifecycle or pricing history.

## Identity

`model_aliases` records Anthropic API model IDs. Resolution first uses an API
alias, then an exact normalized model name, then a unique family comparison
that removes only a terminal eight-digit Anthropic version date. A family
match must be unique on both sides.

Alias and exact matches resolve in a first pass and *consume* the model row
they matched, so a model already pinned to one API ID cannot also be the family
candidate for a different one. That is what lets a second dated sibling
(`claude-3-5-sonnet-20241022` arriving beside the already-known
`claude-3-5-sonnet-20240620`) be created as its own model instead of being
reported as ambiguous forever.

For the authoritative lifecycle source, a genuinely ambiguous match fails
rather than creating or merging a potentially incorrect model. Pricing uses the
same resolver but is not an identity authority: it reuses a canonical row when
the match is unambiguous and otherwise degrades to its own row, so one
ambiguous display name can never abort a whole provider's pricing run.

## Projection

`applyModelLifecycleProjections` is the only writer of `models.lifecycle_state`,
the lifecycle dates and `is_active`. Only `retired` sets `is_active` false.

A date the source did not publish this run is *omitted from the update*, not
written as null — a page-layout regression must not erase a deprecation date we
already trust. Any non-null value is still written through, so corrections work.
The two retirement columns move as a pair, because they are mutually exclusive
in the schema.

## Change events

Consecutive completed lifecycle snapshots are compared by API model ID.
Changed state, deprecation date, exact retirement date, or retirement lower
bound emits one `lifecycle_changed` event per field and run. First observations,
identical observations, and missing rows emit no lifecycle transition.
