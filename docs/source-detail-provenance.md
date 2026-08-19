# Source Detail & Provenance

SourcePulse's backend: one monitored source, fully explained, plus a generic
provenance lookup for any trusted value the product shows.

The UI is built separately; this document describes the read boundary it
consumes.

## What it answers

For one source: what it is, where it comes from, which Bright Data collector
powers it, what contract it must satisfy, how healthy and how fresh it is, when
it last ran and last succeeded, what its recent runs did, what broke, what
healing did about it, what it currently asserts, what it has asserted
historically, and how one raw observation became a canonical value.

For one value or event: which provider published it, from which source and URL,
via which collector, observed when, in which collection run, from which
snapshot, and how far that evidence should be trusted.

## Endpoints

| Route | Purpose |
| --- | --- |
| `GET /api/sources` | Catalog: identity, contract and health for every monitored source. |
| `GET /api/sources/:id` | Full source detail. `404` when the source does not exist. |
| `GET /api/provenance?kind=&id=` | Provenance for one piece of evidence. |

`/api/sources/:id` is one endpoint rather than the four the brief sketched
(`/:id`, `/:id/history`, `/:id/healing`, …) because the page renders those
sections together: four routes would mean four round trips and four independent
reads of the same source row. Each section is bounded individually instead:

```
GET /api/sources/<id>?runs=50&incidents=10&healing=10&observations=100
```

Limits are clamped server-side (runs/incidents/healing ≤ 100, observations ≤
200), so a caller cannot turn one request into a table dump.

`kind` for provenance is `pricing_snapshot`, `lifecycle_snapshot` or
`change_event`. The union is the extension point: a future evidence table
(capabilities, benchmarks) is a new `kind` plus a row → provenance mapping, not
a new API shape.

## Architecture

```
app/api/sources/route.ts          ─┐
app/api/sources/[id]/route.ts      ├─→ lib/sources/handler.ts   (HTTP shape, no Next dependency)
app/api/provenance/route.ts       ─┘        │
                                            ├─→ lib/sources/read-model.ts   (catalog + detail assembly)
                                            └─→ lib/sources/provenance.ts   (evidence → provenance)
                                                        │
                                                        └─→ lib/sources/port.ts  (every query, one place)
```

* `port.ts` — the only place that talks to Supabase. Constructed with the **anon**
  client, so RLS and the column grants are in force for every read.
* `read-model.ts` / `provenance.ts` — pure assembly over port rows.
* `contract-view.ts` — public projection of the Sentinel health contract.
* `transformation.ts` — raw observation → canonical value evidence.
* `sanitize.ts` — redaction, truncation and URL safety for published strings.
* `in-memory-port.ts` — the same port over in-memory rows, used by the tests.

Nothing new was added to the schema. The read models compose what already
exists: `providers`, `sources`, `collection_runs`, `pricing_snapshots`,
`lifecycle_snapshots`, `change_events`, `sentinel_incidents`,
`sentinel_healing_attempts` and the `sentinel_source_health` view. No migration
was required.

## Freshness and health

Health status comes from `sentinel_source_health`. Freshness is computed against
the source's contracted staleness budget (`maxStalenessMinutes`, 1440 for every
current source), measured from the last **successful** run — a failed attempt
does not refresh a source:

| Age vs budget | Status |
| --- | --- |
| ≤ 50% | `fresh` |
| ≤ 100% | `aging` |
| > 100% | `stale` |
| no successful run, or no contract | `unknown` |

## Trust states

`trust.validationState` on a provenance record:

| State | Meaning |
| --- | --- |
| `validated` | Produced by a run that succeeded, with no open incident against it. |
| `provisional` | Run was partial or failed; the row is history, not current truth. |
| `quarantined` | Sentinel is holding an open incident against that run. |
| `unknown` | No run could be resolved (e.g. an orphaned change event). |

An open incident outranks the run status: a run can leave snapshot rows behind
that Sentinel has since disowned.

## Change Feed

The feed reads Antigravity's temporal engine (`lib/intelligence`), which was not
rebuilt. Two provenance fields were added so a feed item is traceable end to
end: `source.sourceId` and `provenance.externalRunId`. A feed item's `id` is its
`change_events` row id, so `GET /api/provenance?kind=change_event&id=<id>`
resolves the rest — provider, source, URL, collector, observed time, run,
snapshot pair and trust state.

## Security decisions

* **Anon client, always.** The public read path never constructs the
  service-role client. Quarantine payloads (`sentinel_quarantine_payloads`,
  `revoke select ... from anon`) and per-record diagnostics
  (`collection_runs.validation_errors`, `error_details`,
  `sentinel_healing_attempts.validation_details`) are unreadable by
  construction, not merely unselected.
* **Explicit column lists.** Reads of `collection_runs` and
  `sentinel_healing_attempts` name their columns, matching the anon grants in
  the migrations.
* **Healing prompts are withheld.** The SQL grant makes
  `sentinel_healing_attempts.prompt` anon-readable, but it is operator text
  about collector internals, so the public shape omits it. Status, attempt
  number, refactor job id, candidate count and validation outcome remain.
* **Operator text is sanitized.** `error_message` and incident summaries are
  redacted (credential-shaped values, JWTs, long hex digests, bearer tokens),
  stripped of markup and truncated to 240 characters.
* **URLs are normalized.** Published URLs are `http(s)` only, with userinfo,
  query string and fragment removed — a query string can carry a token.
* **Raw payloads are never republished.** The transformation view shows matched
  raw *keys* with sanitized values capped at 120 characters, paired with the
  canonical field each produced.
* **Collector ids are public.** They identify a collector, not a credential, and
  are already public through `sources` RLS and `/api/sentinel/health`. Bright
  Data API keys are never read by this module — no file in `lib/sources` touches
  `process.env`.
* **Errors are opaque.** Handlers answer a fixed message; upstream error strings
  can echo collector or database detail.
* **No write path.** The three routes export `GET` only, and the module has no
  mutating function. Source configuration, incidents and healing state are
  written by ingestion and Sentinel with the service-role client.

## Tests

`tests/sources/` covers healthy, degraded/quarantined and recovered detail; run
history ordering, identity and duration; pricing and lifecycle provenance;
temporal change provenance; the healing timeline; a missing source resolving to
404; sanitized public output; quarantine diagnostics staying inaccessible; and
the absence of any mutating handler.
