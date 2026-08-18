# Gemini lifecycle ingestion

Google's Gemini deprecations table is ingested through the shared authoritative
lifecycle subsystem.

- Endpoint: `POST /api/ingest/gemini/lifecycle`
- Collector: `c_msxqpelk2cpxz8r386`
- Source: `https://ai.google.dev/gemini-api/docs/deprecations`
- Optional overrides: `BRIGHTDATA_GEMINI_LIFECYCLE_COLLECTOR_ID` and
  `GEMINI_LIFECYCLE_SOURCE_URL`

The endpoint uses the same `x-ai-radar-ingest-secret` protection as the other
manual ingestion routes.

## Authoritative semantics

- `is_shutdown: true` asserts `retired` and is the only Gemini signal that can
  deactivate a model.
- A non-shutdown row with a published date asserts `deprecated` and stores the
  date only as `retirement_not_before_date`. It never becomes an exact
  `retirement_date` and is never evaluated against the current date.
- `No shutdown date announced` asserts no lifecycle state. It can explicitly
  withdraw a previously announced lower bound while preserving the canonical
  state already projected on the model.
- A missing field is silence and does not clear a date. A model missing from a
  later collection produces no lifecycle or activity inference.

Complete English dates are normalized deterministically. Month/year values are
retained in snapshot source metadata but are not assigned an invented day.

## Identity and evidence

Gemini uses the shared alias/exact/unambiguous-family planner. Stable pricing
display names such as `Gemini 2.5 Pro` can safely resolve to
`gemini-2.5-pro`; preview and experimental suffixes remain part of identity.
Ambiguity fails the lifecycle run closed.

Every accepted record appends to `lifecycle_snapshots`, including raw collector
evidence, model group/stage, release-date text, explicit shutdown signal,
collection provenance, and recommended replacement. Replacement identifiers
do not have to exist as canonical models. Their appearance or change, schedule
changes/withdrawals, and explicit state transitions produce deterministic
events only after a prior comparable observation exists.

Pricing ingestion remains independent and cannot write lifecycle state, dates,
source identity, or `is_active`.
