# Autonomous Collection Orchestration

AI Radar no longer depends on someone calling each ingestion endpoint by hand.
A single scheduled tick decides which configured sources are due, runs them in
isolation, and reports what happened.

## Runtime sequence

Every source, on every run, goes through exactly this path:

```
Vercel Cron  →  /api/cron/collect  (authorized)
             →  lease the source           (no overlapping runs)
             →  Bright Data collector      (per-attempt timeout, bounded retries)
             →  ingestion pipeline
                  ├─ raw contract validation
                  ├─ Sentinel health evaluation      ← lib/sentinel/gate.ts
                  ├─ UNSAFE → incident + quarantine, run failed, THROW
                  └─ SAFE   → models, snapshots, change events, projections
             →  bounded self-healing if quarantined  (candidate re-enters the pipeline)
             →  orchestration-run + collection-run reporting
             →  release the lease
```

The gate is **inside** the pipelines (`lib/pipeline/sentinel-gate.ts`), not
around them. `assertSentinelSafe` is called after the collector returns and
before the first canonical write, and it throws `SentinelQuarantineError` when
the payload is refused. Both callers — the scheduler and the manual
`/api/ingest/*` routes — therefore get the same protection; there is no code
path that persists a quarantined collection.

Healing never bypasses the gate: a repaired candidate is fed back through the
same pipeline and has to pass evaluation on its own merits before it lands.

## Files

| Path | Role |
| :--- | :--- |
| `lib/orchestration/registry.ts` | The six configured sources and all their policy |
| `lib/orchestration/schedule.ts` | Cadence arithmetic, tick definition, backoff |
| `lib/orchestration/runner.ts` | One source: lease → collect → ingest → heal → report |
| `lib/orchestration/fleet.ts` | All due sources, sequential, isolated |
| `lib/orchestration/repository.ts` | Durable leases and run history |
| `lib/orchestration/auth.ts` | Scheduler authorization (fails closed) |
| `lib/orchestration/handler.ts` | HTTP contract for the routes |
| `lib/orchestration/read-model.ts` | Status read model |
| `lib/sentinel/gate.ts` | Shared evaluation + quarantine bookkeeping |
| `lib/sentinel/heal-flow.ts` | Shared bounded healing attempt |
| `lib/pipeline/sentinel-gate.ts` | The inline gate the pipelines call |
| `supabase/migrations/20260818000001_collection_orchestration.sql` | `orchestration_runs` |

## Scheduling

`vercel.json` registers one cron entry:

```json
{ "crons": [{ "path": "/api/cron/collect", "schedule": "0 * * * *" }] }
```

The hourly tick is a *heartbeat*, not a per-source schedule. Each source has its
own cadence (pricing 6h, lifecycle 12h by default) and runs only when that
cadence has elapsed since its last attempt. Adding a source or changing a
cadence therefore never means editing `vercel.json`.

Nothing runs permanently: the tick is a normal serverless invocation with
`maxDuration = 300`.

> On Vercel's Hobby plan cron entries are limited to one run per day. Change the
> schedule to `0 0 * * *` there, or run the tick from an external scheduler that
> calls the same authorized route.

## Configuration

| Variable | Meaning |
| :--- | :--- |
| `CRON_SECRET` | Bearer secret Vercel Cron presents |
| `AI_RADAR_INGEST_SECRET` | Existing operator secret; also authorizes the scheduler |
| `AI_RADAR_COLLECTION_CADENCE_MINUTES` | Fleet cadence default |
| `AI_RADAR_COLLECTION_TIMEOUT_MS` | Fleet per-attempt collector budget |
| `AI_RADAR_COLLECTION_MAX_ATTEMPTS` | Fleet retry budget (hard-capped at 5) |
| `AI_RADAR_SOURCE_<KEY>_ENABLED` | Disable one source |
| `AI_RADAR_SOURCE_<KEY>_CADENCE_MINUTES` | Per-source cadence |
| `AI_RADAR_SOURCE_<KEY>_TIMEOUT_MS` | Per-source timeout |
| `AI_RADAR_SOURCE_<KEY>_MAX_ATTEMPTS` | Per-source retry budget |

`<KEY>` is the source key upper-cased with dashes as underscores, e.g.
`AI_RADAR_SOURCE_ANTHROPIC_LIFECYCLE_CADENCE_MINUTES`.

## Endpoints

| Route | Method | Auth | Purpose |
| :--- | :--- | :--- | :--- |
| `/api/cron/collect` | GET | required | The scheduled tick |
| `/api/orchestration/run` | POST | required | Operator trigger; `{ "sources": [...], "force": true }` |
| `/api/orchestration/status` | GET | public (diagnostics gated) | Status read model |

Unauthorized scheduler calls get a bare `401 {"success":false,"error":"unauthorized"}`
and never reach a collector. With neither secret configured the endpoints are
unreachable rather than open.

## Failure isolation

* One source failing, quarantining or timing out never affects another — the
  fleet iterates with per-source error containment and reports each result
  separately.
* A quarantine writes nothing canonical; the last-known-good state stands.
* Retries are bounded by policy and only apply to collector errors and
  timeouts. A Sentinel quarantine is never retried by re-scraping — that is what
  healing is for. Nothing polls indefinitely.
* Overlap is prevented by a database lease (`orchestration_runs`, partial unique
  index on `status = 'running'`), so two concurrent serverless invocations
  cannot run the same collector. An expired lease is reclaimable, so a killed
  invocation cannot wedge a source.
* Duplicate scheduler delivery is a no-op: cron invocation ids are derived from
  the tick window and are unique per `(source, invocation)`.

## Status read model

`GET /api/orchestration/status` reports, per source: last attempted run, last
successful run, next expected run, whether it is running now, the latest result
with its duration and record counts, consecutive failures, and the matching
Sentinel health entry. A failing source is reported as failing without hiding
the sources that succeeded.

Collector ids never appear in the payload — only `collectorConfigured: true`.
Raw error text is included only for callers presenting a scheduler credential.

## Local check

```bash
npm test && npm run typecheck && npm run lint && npm run build
```
