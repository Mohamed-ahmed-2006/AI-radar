# Production readiness

Deployment contract, migration runbook and the security posture the deployment
depends on. Everything here is verifiable from the repository; nothing assumes
access to a production project.

---

## 1. Environment contract

`lib/config/production-env.ts` is the single declaration. Verify a deployment
against it before shipping:

```bash
npm run check:env
```

It exits non-zero when a required value is missing or a demo switch is set. It
prints variable **names and reasons, never values**, so it is safe in a build
log.

### Required — the product does not function without these

| Variable | Area | Without it |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase | No page renders live data. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | Supabase | Public read path is dead. RLS is what makes this key safe in the bundle. |
| `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) | Supabase | No ingestion writes. Server-only; `requireServiceRoleKey` throws in the browser. |
| `AI_RADAR_INGEST_SECRET` | Ingest | Every `/api/ingest/*` route answers 401. **Closed, not open.** |
| `CRON_SECRET` | Scheduler | Scheduled collection never runs and `/api/cron/collect` is unreachable. |
| `BRIGHTDATA_API_KEY` | Bright Data | No collection and no healing. |

### Recommended — a named capability is closed without them

| Variable | Area | Without it |
| --- | --- | --- |
| `AI_RADAR_OPERATOR_KEY` | Operator controls | Falls back to `CRON_SECRET` / `AI_RADAR_INGEST_SECRET`. Set it separately so demo access rotates independently of the scheduler. |
| `BRIGHTDATA_DEMO_COLLECTOR_ID` | Healing demo | The demo reports "unavailable" and **refuses to run** rather than borrowing a production collector. |

### Must be unset in production

These are the explicit demo modes. Each one is a deliberate, server-side opt-in;
none is required for a public deployment, and `npm run check:env` fails if any is
set.

| Variable | What setting it does |
| --- | --- |
| `SENTINEL_DEMO_MODE` | `/source-health` renders the in-memory simulation instead of live Sentinel telemetry, and `POST /api/sentinel/demo` becomes reachable. |
| `AI_RADAR_DEMO_EVIDENCE` | `?demo=true` is honoured on the intelligence and Ask surfaces, serving the fabricated temporal-evidence corpus. |
| `AI_RADAR_HEALING_DEMO_OPEN_CONTROLS` | Mutating healing-demo actions become reachable anonymously. |

---

## 2. Operator controls in production

The healing demo drives a real Bright Data collector and submits real Scraper
Studio refactor jobs. Those actions must not be anonymous, and the credential
that authorizes them must never reach the browser bundle.

**Mechanism.** An operator exchanges the credential once for a short-lived
signed cookie:

```bash
curl -sS -X POST https://<deployment>/api/operator/session \
  -H 'content-type: application/json' \
  -d '{"key":"<AI_RADAR_OPERATOR_KEY>"}' -c cookies.txt
```

In a browser, `/demo/healing` shows an **Unlock controls** prompt the first time
an action is refused; entering the key does the same exchange.

Properties:

* The cookie holds `expiry.HMAC(expiry)` signed with the credential — **not the
  credential**. Unforgeable without the secret.
* `HttpOnly`: page JavaScript can never read it.
* `SameSite=Strict`: another origin cannot use a live session to drive the demo,
  so no separate CSRF token is needed.
* One hour, then it expires on its own.
* Rotating `AI_RADAR_OPERATOR_KEY` revokes every outstanding session immediately.
* `DELETE /api/operator/session` ends the session.

A session grants **exactly** the scheduler's authority, time-boxed. It widens
nothing: the demo's allowlists — one action enum, one collector id, two URLs —
are unchanged, and no request body carries a URL, collector or prompt.

`AI_RADAR_HEALING_DEMO_OPEN_CONTROLS=1` survives only for a throwaway
deployment where anyone may press the buttons. **A public deployment must not
set it.** Even where it is set, the rate limits below still apply.

---

## 3. Rate limits

`lib/rate-limit.ts`. A fixed-window counter in module memory — no Redis, no
database round trip.

| Endpoint | Policy | Why |
| --- | --- | --- |
| `POST /api/operator/session` | 5 / min | Credential guessing. |
| `POST /api/demo/healing` (expensive actions) | 8 / 10 min | `reset`, `establish_baseline`, `run_broken_collector`, `start_healing`, `rerun_recover` each spend Bright Data quota. |
| `POST /api/demo/healing` (other actions) | 60 / min | Local state transitions. |
| `POST /api/orchestration/run`, `POST /api/ingest/all` | 6 / 10 min | A fleet run is ten real collector jobs; `force` skips cadence. |
| `POST /api/ingest/{provider}` | 12 / 10 min | One real collector job each. |
| `POST /api/sentinel/demo` | 20 / min | No quota, but unbounded CPU. |

`GET /api/cron/collect` is deliberately **not** limited: cadence and the
per-source lease already bound it, and a throttled cron tick is a self-inflicted
outage.

**Honest limitation.** On a serverless platform each instance keeps its own
counters, so the effective ceiling is `limit × live instances` and a cold start
resets the window. This is defence in depth, not a distributed quota. The
primary control on every expensive endpoint is authorization — a public visitor
cannot reach a repair job at all.

---

## 4. Migration runbook

### Verified

The full chain was applied end to end against a disposable PostgreSQL 18.4
cluster, in both plain and single-transaction-per-file modes, followed by
`seed.sql` and all 17 assertions in `supabase/tests/schema_checks.sql`. Every
step exited 0.

Order is by filename timestamp and each migration depends only on earlier ones:

1. `20260817000000_init_intelligence_schema` — extensions, enums, `providers`,
   `sources`, `models`, `collection_runs`, `pricing_snapshots`, `change_events`, RLS.
2. `20260817000001_change_event_pricing_identity` — needs `change_events`.
3. `20260817000002_comparable_pricing_snapshots` — needs `pricing_snapshots`, `collection_runs`.
4. `20260817000003_anthropic_lifecycle_intelligence` — `lifecycle_state`, `model_aliases`, `lifecycle_snapshots`; extends `models`, `change_events`, `collection_runs`.
5. `20260817000004_sentinel_health_and_quarantine` — Sentinel incidents, quarantine payloads, healing attempts; needs `sources`, `providers`, `collection_runs`.
6. `20260818000000_gemini_lifecycle_evidence` — extends `lifecycle_snapshots`, rebuilds its `content_hash`.
7. `20260818000001_collection_orchestration` — `orchestration_runs`; needs `collection_runs`, `sentinel_incidents`.
8. `20260818000002_model_capabilities_catalog` — `capability_snapshots`; needs `collection_runs`, `sources`, `providers`, `models`, and alters `orchestration_runs`.
9. `20260819000000_sentinel_demo_harness` — demo persistence; needs `sources`, `collection_runs`, `sentinel_incidents`.

### Blocker found and fixed

Migration 8 could not apply to **any** clean database:

```
ERROR: generation expression is not immutable
```

`capability_snapshots.content_hash` is a `generated always as … stored` column
that called `array_to_string`, which PostgreSQL marks **STABLE** (it invokes the
element type's output function). A stored generated column requires an immutable
expression, so the whole migration aborted on every supported version, Supabase
included. Fixed by asserting the guarantee once, on the one concrete type in
use, via an immutable `radar_join_text_array(text[])` wrapper. The hash value is
unchanged.

The neighbouring migrations already avoided this class of problem deliberately
— note the `(date - date '1970-01-01')::text` idiom used to dodge
`DateStyle`-dependent date output.

### Test-harness fidelity fix

`supabase/tests/schema_checks.sql` emulates Supabase's `anon` privileges with a
blanket `GRANT SELECT ON ALL TABLES`. On Supabase that grant arrives through
`ALTER DEFAULT PRIVILEGES` at `CREATE TABLE` time, so each migration's later
`REVOKE` wins. In the harness it was replayed *after* the migrations, silently
re-opening `sentinel_quarantine_payloads` and every other withheld column. The
harness now restores each withheld surface, and two new assertions (TEST 17)
cover `orchestration_runs.error_message` and `sentinel_demo_events.detail`,
which nothing had asserted.

### Applying to production

Never run these against a live project without a backup.

```bash
supabase link --project-ref <ref>
supabase db push --dry-run      # confirm only unapplied migrations are listed
supabase db push
```

Then, against a **disposable copy** — `schema_checks.sql` writes rows and grants
privileges, so it is not safe against real data:

```bash
psql "$DISPOSABLE_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
psql "$DISPOSABLE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/schema_checks.sql
```

### Unverified portion

The disposable cluster is stock PostgreSQL 18.4, so three things were emulated
rather than exercised:

* **`anon` / `authenticated` / `service_role` default privileges.** Roles were
  created manually. The migrations' `REVOKE`-then-column-`GRANT` pattern
  depends on Supabase granting `SELECT` at table creation. Confirm on the real
  project with `\dp sentinel_quarantine_payloads`.
* **PostgREST view exposure.** Views are declared `security_invoker = true`;
  whether PostgREST exposes each one is a project setting.
* **Migration bookkeeping.** Files were applied with `psql`, not
  `supabase db push`, so `supabase_migrations.schema_migrations` was not
  populated. If migration 8 was ever recorded as applied on a project — it
  cannot have succeeded, but it could in principle be recorded — reconcile the
  ledger before pushing.

---

## 5. Fixture and mock isolation

Every simulator, fixture and fabricated corpus, and what makes it unreachable by
default:

| Fixture | Reached only by | Default behaviour |
| --- | --- | --- |
| Sentinel simulator (`lib/sentinel/demo-simulator.ts`) | `SENTINEL_DEMO_MODE=1`, or the operator credential on `POST /api/sentinel/demo` | `/source-health` reads live telemetry; the route answers **404**. |
| Ask fixture (`lib/product/ask-fixture.ts`) | `installFixtureAskAdapter()` / `setAskAdapter()` — called only from tests | Canonical adapter installed at import. |
| Optimizer fixture (`lib/product/optimizer-fixture.ts`) | same | Canonical adapter installed at import. |
| Healing fixture (`lib/product/healing-demo-fixture.ts`) | `setHealingDemoAdapter()` — called only from tests | Canonical fail-closed adapter; unconfigured means **"unavailable"**, never a fixture and never the Sentinel simulation. |
| Temporal evidence corpus (`lib/intelligence/demo-evidence.ts`) | `?demo=true` **and** `AI_RADAR_DEMO_EVIDENCE=1` | Live evidence, or an empty bundle. |

Enforced by `tests/security/fixture-isolation.test.ts`.

`GET /api/intelligence/query` previously defaulted to `demo=true` — a public
deployment answered ecosystem questions with fabricated evidence unless the
caller passed `demo=false`. The default is now live evidence, and the corpus is
additionally gated on the server-side opt-in.
