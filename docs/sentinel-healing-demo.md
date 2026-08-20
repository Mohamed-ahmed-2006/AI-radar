# Sentinel self-healing demonstration

A dedicated, isolated demo source that exercises the real
failure → quarantine → Bright Data repair → preview → validate → approve →
re-run → recovery path end to end.

Nothing in it is staged. The failure is produced by a real collector genuinely
failing to extract; the refusal is produced by the same `assertSentinelSafe`
gate the pricing, lifecycle and catalog pipelines call; the repair is a real
Scraper Studio refactor; and the recovery is a real re-run through that same
gate. There is no code path that marks a source healthy without a run having
earned it, and no "demo mode" that makes a payload pass.

Production ([https://ai-radar-orpin.vercel.app](https://ai-radar-orpin.vercel.app))
has completed this path through **RECOVERED**: Sentinel refused a zero-record
payload, last-known-good stayed up, Bright Data repaired the isolated collector,
the candidate passed preview/validation/approval, and a re-run was admitted.
Source Health retains that recovered timeline. `/demo/healing` is left in a
clean ready state (healthy LKG) so the expensive cycle is not restaged.

## What it is isolated from

| Concern | How it is isolated |
| --- | --- |
| Collector | Its own `BRIGHTDATA_DEMO_COLLECTOR_ID`. Unset, the harness refuses to run rather than falling back to a production collector. `scripts/demo/run-healing-proof.ts` additionally refuses to start if that id matches any production collector id in the environment. |
| Source | Its own provider (`sentinel-demo`) and `sources` row, keyed by its own URL. |
| Canonical data | Its own table, `demo_quote_snapshots`. It writes nowhere else. |
| Page | Public-domain quotations only. No private, personal or licensed content. |

Runs, incidents, quarantined payloads and healing attempts deliberately live in
the *shared* `collection_runs` and `sentinel_*` tables — that is the point. The
last-known-good lookup protecting the demo is the same lookup protecting
production, not a demo-only shortcut.

## The controlled incompatibility

Two renderings of one identical record set:

* `/demo-source/healthy` — the structure the collector's template was built for
* `/demo-source/broken` — the same records as a `<table>`

Pointing the collector at the second invalidates its selectors, so extraction
fails for a real structural reason. Both URLs come from a two-entry allowlist
built from `AI_RADAR_DEMO_SOURCE_BASE_URL`; a caller names a *layout*, never a
URL.

Set `AI_RADAR_DEMO_SOURCE_BASE_URL` to a public deployment of this app to use
those pages. Without it the harness falls back to the public
`quotes.toscrape.com` scraping sandbox, which publishes the same records under
`/` and `/tableful/`.

`break_template` is a third mechanism, kept for the case where no controllable
page is reachable: it installs a genuinely defective template through a real
refactor. It is slower, spends an AI-Flow job, and `reset` has to repair the
collector afterwards — prefer the layout switch.

## Steps

Each is one `POST /api/demo/healing` with `{"action": "..."}`.

| Action | What actually happens |
| --- | --- |
| `reset` | Re-points at the healthy layout, clears the phase marker. Keeps runs, incidents and canonical rows — resetting the demo must not erase its evidence. |
| `run_baseline` | Real collector run against the healthy layout. Establishes last-known-good. |
| `arm_failure` | Selects the second allowlisted layout. Touches no health status and no data. |
| `break_template` | Contingency: installs a defective template via a real refactor. |
| `run_broken` | Real collector run whose output the gate refuses. Produces the incident and the quarantined payload. |
| `request_heal` | Real Scraper Studio refactor, driven from what Sentinel observed. Stops at the approval gate and returns the candidate. |
| `validate_preview` | Judges the candidate with the same contract, via `evaluateSourceHealth`. |
| `approve` | Commits the repaired template — only on a candidate that passed. A failed candidate is discarded instead. |
| `rerun` | Real re-run through the same gate. Recovery is earned here, not declared. |

The state machine refuses out-of-order steps rather than faking them: the
failure cannot be armed before a baseline exists, healing cannot be requested
without an open incident, and a re-run is refused until an approved template
exists. A refusal returns HTTP 200 with `result.status: "refused"` — it is the
system working, not a transport error.

## Backend interface

* `POST /api/demo/healing` — runs one step. Requires the operator credential
  (`CRON_SECRET` or `AI_RADAR_INGEST_SECRET`, same as the collection scheduler).
  The body carries a single enum and nothing else: no collector id, source id,
  URL or prompt from a client is read, so no request can aim the demo at
  another collector or scrape an arbitrary page.
* `GET /api/demo/healing/status` — the read model. Public, so a dashboard can
  poll it. Collector id, healing prompts, Bright Data job ids and sampled
  records are added only for a caller holding the operator credential.

`evidence.isLive` is `false` whenever any Bright Data or Supabase dependency
was a double, so a rehearsal cannot be mistaken for a live proof.

## Configuration

```
BRIGHTDATA_API_KEY=              # an account whose zone can make requests
BRIGHTDATA_DEMO_COLLECTOR_ID=    # the DEDICATED demo collector
AI_RADAR_DEMO_SOURCE_BASE_URL=   # optional; serves both layouts ourselves
AI_RADAR_INGEST_SECRET=          # or CRON_SECRET, for mutating actions
```

Plus `NEXT_PUBLIC_SUPABASE_URL` and a Supabase service credential, and the
`20260819000000_sentinel_demo_harness` migration applied.

## Running the live proof

```bash
npx tsx scripts/demo/run-healing-proof.ts --preflight
```

Checks configuration and Bright Data reachability without running the collector
or writing anything. Drop `--preflight` to execute the full sequence and print
the evidence record (collector id, baseline run id, invalid run id, Sentinel
reason codes, incident id, canonical writes from the refused run, refactor job
id, preview validation result, approval state, recovered run id, final phase).

The script has no simulation path. If a step cannot run it reports which step
and why, and stops.

## Tests

`tests/demo-healing/` doubles only Bright Data and Supabase. The contract, the
evaluator, the gate, the ingestion function and the orchestrator are the real
ones, so a canonical row recorded in a test is a row a live run would genuinely
have written — and an absent row is a write that genuinely did not happen.

* `contract.test.ts` — the contract accepts working extraction and refuses each
  way a broken template actually fails, including ones where every record
  parses.
* `persistence.test.ts` — a refused payload writes exactly zero canonical rows,
  the run is closed as failed, and last-known-good is untouched.
* `orchestrator.test.ts` — the whole sequence, plus every refusal that stops it
  being short-circuited: no approval without validation, no re-run without
  approval, no recovery unless the repaired template genuinely works.
* `security.test.ts` — authorization, the action allowlist, and what the public
  read model does and does not disclose.
* `dca.test.ts` — the Bright Data wire contract: paths, approval and rejection
  bodies, status vocabulary, and polling behaviour.
