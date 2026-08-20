# Sanitized Scraper Studio examples

These records match the **implemented Zod contracts**. They are not live datasets, contain no API keys, and use placeholder collector ids. Production collector ids live in environment configuration, not in this folder.

Real schemas: `lib/contracts/pricing.ts`, `lib/contracts/lifecycle.ts`, `lib/contracts/catalog.ts`.

| File | Collector domain |
| --- | --- |
| [`pricing-collector.json`](pricing-collector.json) | Bright Data pricing transport shape |
| [`lifecycle-collector.json`](lifecycle-collector.json) | Anthropic + Gemini lifecycle transport shapes |
| [`catalog-collector.json`](catalog-collector.json) | OpenAI / Anthropic / Gemini / xAI catalog transport shapes |

After Sentinel admits a payload, adapters normalize these into canonical snapshots with provenance (`sourceUrl`, `collectorId`, `collectedAt`).
