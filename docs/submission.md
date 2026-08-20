# Submission copy — judging axes

AI Radar / StackPulse, powered by SourcePulse. Bright Data Scraper Studio is the collection and self-healing plane. Answers come from trusted observations, not model memory.

## Potential Impact

Teams choose models from pages that rewrite themselves. AI Radar turns those pages into an auditable history: prices, capabilities, and lifecycle events with provenance. A product team can ask what changed, compare options, and size a workload against **observed** numbers. When a provider layout breaks, last-known-good stays up and the bad payload never becomes a “price drop.”

## Creativity & Innovation

The product is not a dashboard over a dump. It is a **contracted observation system**: Scraper Studio extracts, Sentinel admits or quarantines, then deterministic engines (explorer, optimizer, temporal query, Ask planner) speak only from what was admitted. Natural language is compiled into a plan; it cannot invent a dollar figure. Unknown is a first-class state, not a synonym for false.

## Technical Excellence

- Ten Bright Data collectors across four providers and three domains, orchestrated on a cadence with leases, isolation, and bounded retries.
- Zod contracts and normalization with identity, provenance, and three-state capabilities.
- Sentinel gate inside every pipeline before the first canonical write.
- Supabase history + RLS reads; server-only writes; operator session for dangerous demo actions; rate limits; production env contract that prints names, never values.
- Fail-closed UX: fixtures and simulators are opt-in; missing data is empty or unavailable.

## Use of Scraper Studio

Bright Data is not a logo. Collection **is** Scraper Studio: trigger, poll, parse, metadata. Healing **is** Scraper Studio: a real refactor of an isolated collector, previewed and re-validated by the same contract. No collector key, no product. Cron does not scrape. The Next.js app does not scrape. Studio is the only path from the public AI web into the system.

## Reliability & Self-Healing

Unsafe payloads are quarantined; last-known-good remains the trusted current; fleet failure is isolated per source. Healing is request → preview → validate → approve (only if valid) → rerun → recover (only if the gate passes). The UI cannot mark a source healthy. The in-memory Sentinel simulator is a local recording switch and is forbidden in production. An unconfigured healing demo says unavailable rather than simulating success. **Live healing success is claimed only when a production run has earned recovered with live Bright Data evidence.**

## Presentation

One judge path: Dashboard → Explorer → Compare → Optimizer → Ask → Changes → Source Health → Healing Demo. Every surface discloses demo vs live, unknown vs unsupported, and provenance. The story is one sentence: websites change; the data contract should not.
