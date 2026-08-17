# AI Radar — database layer

Supabase/Postgres schema and the repository functions that ingestion and the UI
use. Owned by Lane B; nothing here reaches into `app/`, `lib/contracts/`,
`lib/change-detection/`, or `lib/brightdata/`.

## Data model

```
providers ─┬─ sources ─── collection_runs ─┐
           │                               │
           └─ models ──────────────────────┴─ pricing_snapshots
                    └──────────────────────── change_events
```

| Table | Purpose |
| --- | --- |
| `providers` | An AI provider we track. Keyed by a stable `slug`. |
| `sources` | A collectable endpoint per provider, carrying the Bright Data `collector_id` and canonical `source_url`. |
| `models` | A provider-native model name, with `first_seen_at` / `last_seen_at` / `is_active`. |
| `collection_runs` | One collector execution: status, timings, seen/accepted/rejected counts, error details. |
| `pricing_snapshots` | Append-only price observations in typed numeric columns. |
| `change_events` | Diffs derived from consecutive snapshots. |

Two read views ship with the schema:

- `latest_pricing_snapshots` — current price per (model, pricing mode, context tier), joined to model and provider names.
- `source_health` — the most recent run for every source.

### Why snapshots are not a JSON blob

Every priced field OpenAI exposes today is a real column
(`input_price_per_1m_tokens`, `cached_input_price_per_1m_tokens`,
`cache_write_price_per_1m_tokens`, `output_price_per_1m_tokens`), with
`currency` and `pricing_unit` alongside. Provider variation is absorbed by two
dimension columns rather than by loosening the schema:

- `pricing_mode` — `standard`, `batch`, `priority`, …
- `context_tier` — `short`, `long`, `default`, …

`extra` holds priced fields a future provider exposes that we have not modelled
yet, and `raw` keeps the verbatim collector record for audit. Neither is needed
to read a price.

### Idempotency

| Concern | Mechanism |
| --- | --- |
| Same Bright Data snapshot delivered twice | partial unique index on `collection_runs (source_id, external_run_id)`; `startCollectionRun` returns the existing run |
| Same collection result ingested twice | unique index on `pricing_snapshots (run_id, model_id, pricing_mode, context_tier)` — the upsert target |
| Change detection re-run over a run | unique index on `change_events (run_id, model_id, change_type, field_name) nulls not distinct` |
| Provider/source/model re-registered | unique on `providers (slug)`, `sources (provider_id, kind, source_url)`, `models (provider_id, model_name)` |

History still accumulates: a *new* run always writes new snapshot rows. The
generated `content_hash` column fingerprints the priced values, so "did this
price actually move" is a hash comparison rather than a field-by-field diff.

### Security

RLS is on for all six tables with a single `select` policy for `anon` and
`authenticated`. There are no write policies — ingestion uses the service role
key, which bypasses RLS. That is the whole of the public-read / private-write
architecture; no auth tables, no per-user rules.

## Environment

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY   # server only, never NEXT_PUBLIC_
```

`requireServiceRoleKey()` throws if called where `window` is defined, so the
service role key cannot be pulled into a client bundle.

## Repository API

Import from `@/lib/supabase`. Every function takes the client explicitly —
writes need `createSupabaseAdminClient()`.

```ts
import {
  createSupabaseAdminClient,
  upsertProvider,
  upsertSource,
  upsertModels,
  startCollectionRun,
  savePricingSnapshots,
  completeCollectionRun,
} from "@/lib/supabase";

const db = createSupabaseAdminClient();

const provider = await upsertProvider(db, { slug: "openai", name: "OpenAI" });
const source = await upsertSource(db, {
  providerId: provider.id,
  collectorId: "c_msx3bqlyjtv2qustx",
  sourceUrl: "https://developers.openai.com/api/docs/pricing",
  label: "OpenAI API pricing",
});

const run = await startCollectionRun(db, {
  sourceId: source.id,
  externalRunId: snapshotId,
  triggeredBy: "cron",
});

try {
  const [model] = await upsertModels(db, [
    { providerId: provider.id, modelName: "gpt-5.6-sol" },
  ]);

  await savePricingSnapshots(db, [
    {
      runId: run.id,
      sourceId: source.id,
      providerId: provider.id,
      modelId: model.id,
      pricingMode: "standard",
      contextTier: "short",
      inputPricePer1mTokens: 5,
      cachedInputPricePer1mTokens: 0.5,
      cacheWritePricePer1mTokens: 6.25,
      outputPricePer1mTokens: 30,
      pricingUnit: "USD per 1M tokens",
      sourceUrl: "https://developers.openai.com/api/docs/pricing",
      raw: record,
    },
  ]);

  await completeCollectionRun(db, run.id, {
    recordsSeen: 1,
    recordsAccepted: 1,
    recordsRejected: 0,
  });
} catch (err) {
  await failCollectionRun(db, run.id, { message: String(err) });
  throw err;
}
```

Full surface:

- **Providers/sources** — `upsertProvider`, `upsertSource`, `getSourceByCollectorId`
- **Models** — `upsertModel`, `upsertModels`, `deactivateMissingModels`, `listModels`
- **Runs** — `startCollectionRun`, `completeCollectionRun`, `failCollectionRun`, `getLatestRunForSource`, `getSourceHealth`
- **Pricing** — `savePricingSnapshot`, `savePricingSnapshots`, `getLatestPricingSnapshots`, `getLatestPricingSnapshotForModel`, `getPricingHistory`
- **Changes** — `saveChangeEvent`, `saveChangeEvents`, `getRecentChangeEvents`

Errors surface as `RepositoryError`, carrying the underlying `PostgrestError`.

## Local development

```bash
npx supabase start
```

```bash
npx supabase db reset
```

`db reset` applies `migrations/` then `seed.sql`, which registers the OpenAI
provider and its pricing source (collector `c_msx3bqlyjtv2qustx`). No pricing is
seeded — that only ever comes from a real collection run.

To push to a linked project:

```bash
npx supabase db push
```

## Schema checks

`tests/schema_checks.sql` exercises the invariants the schema is supposed to
guarantee: snapshot idempotency, history preservation, the `latest_pricing_snapshots`
and `source_health` views, run status/count constraints, `content_hash` being
generated-always, change-event dedupe across NULL `field_name`, RLS read/write
behaviour for `anon`, and an assertion that every foreign key is index-backed.

It writes rows and grants privileges, so run it only against a freshly reset
database:

```bash
npx supabase db reset
```

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/schema_checks.sql
```
