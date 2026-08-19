# Model catalog & capability ingestion

The catalog domain answers "what can this model actually do", separately from
what it costs (pricing) and whether it is still offered (lifecycle). It covers
four providers, each with one authoritative provider-owned source:

| Provider | Collector | Source |
| :--- | :--- | :--- |
| OpenAI | `c_msz67jyrmiom6mbvn` | `https://developers.openai.com/api/docs/models` |
| Anthropic | `c_msz68u3ovithdetgu` | `https://platform.claude.com/docs/en/about-claude/models/overview` |
| Google Gemini | `c_msz708an1gawux0njo` | `https://ai.google.dev/gemini-api/docs/models` |
| xAI | `c_msz6ahaofpm2d9j73` | `https://docs.x.ai/developers/models` |

Every collector ID and source URL is overridable per provider, via
`BRIGHTDATA_<PROVIDER>_CATALOG_COLLECTOR_ID` and `<PROVIDER>_CATALOG_SOURCE_URL`.

The OpenAI, Gemini and xAI collectors are crawls: they start on the provider's
model index and open each linked model detail page, because that is where those
providers publish exact token limits. Anthropic publishes one transposed
comparison table instead, so its collector reads model columns from that page.

## Invariants

### Unknown is not false

Capability booleans are three-state: `true` (explicitly documented as
supported), `false` (explicitly documented as unsupported), `null` (the source
did not say). Collectors are instructed never to emit `false` for a capability
the page omits, the raw contracts type these fields as nullable, the adapters
only promote a value that was actually observed, and `capability_snapshots`
stores all three states in nullable boolean columns.

A page that simply has no Capabilities section — several xAI image and video
model pages are like this — yields `null`, not a row of `false`.

### Catalog is not lifecycle authority

Catalog collection writes capability evidence and nothing else. A model that
disappears from a catalog page is never deactivated, deprecated, retired or
deleted, and `models.lifecycle_state`, the lifecycle dates and `is_active` are
untouched by this pipeline. `applyModelLifecycleProjections` remains the only
writer of lifecycle state. Absence is not evidence.

### Exact context normalization only

`normalizeExactTokenCount` accepts only an exact positive integer, optionally
with comma digit grouping. Everything else normalizes to `null` while the
original string is preserved verbatim in `raw`.

This is load-bearing rather than theoretical. OpenAI, Gemini and xAI publish
exact figures on their model detail pages (`1,050,000`, `1,048,576`,
`500,000`), so those normalize to real numbers. Anthropic publishes only
`1M tokens` and `200k tokens`, so every Anthropic context window normalizes to
`null` with `"1M tokens"` kept as raw evidence. Guessing that `1M` means
`1,000,000` rather than `1,048,576` would invent precision the provider never
published.

### Append-only history

Every accepted run appends to `capability_snapshots`. Nothing is updated in
place and nothing is deleted. Idempotency on replay comes from the unique
`(run_id, model_id, api_model_id)` index, and a generated `content_hash`
summarizes the observable capability state so change detection can compare
consecutive snapshots without re-reading every column.

### Sentinel gates before canonical writes

`ingestCatalogProvider` calls `assertSentinelSafe` on the raw payload before any
canonical write. Zero records, a record-count collapse, duplicate identities or
contract-invalid records quarantine the run, and a quarantined run persists
nothing. Each provider has its own contract from
`createCatalogSourceHealthContract`, keyed on that provider's identity field
(`model_id`, `api_model_id`, `model_id`, `name`).

### Identity resolution fails closed

Catalog identity reuses the model resolver, which prefers an API alias, then an
exact normalized name, then a unique family match. Dated, versioned and preview
model IDs stay distinct: `gemini-3.1-pro-preview` is not merged into
`gemini-3.1-pro`, and a second dated Anthropic sibling becomes its own model
rather than overwriting the first. An ambiguous match fails rather than
guessing.

## Verifying live acquisition

`scripts/ingestion/verify-catalog-collectors.ts` runs the real collectors and
checks each stage without writing to Supabase:

```bash
npx tsx scripts/ingestion/verify-catalog-collectors.ts
```

For every provider it reports the live record count, raw-contract validity, the
Sentinel status the ingestion gate would compute for that payload, how many
context windows were exact versus unknown, how many capabilities stayed
unknown, and any invariant violation — in particular a capability the source
never stated that turned into `false`.

Use `--provider <slug>` for one provider and `--json` for machine-readable
output.

## Orchestration

The four catalog sources are registered in the collection fleet as
`openai-catalog`, `anthropic-catalog`, `gemini-catalog` and `xai-catalog`, with
a 12 hour default cadence — catalog pages move slowly. They run through the same
fleet runner, retry policy and failure isolation as pricing and lifecycle, so
one broken catalog source never blocks another provider.
