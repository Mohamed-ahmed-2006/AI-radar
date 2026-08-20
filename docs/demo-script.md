# Judge demo script (~2–3 minutes)

Production: [https://ai-radar-orpin.vercel.app](https://ai-radar-orpin.vercel.app)

Closing line: **“Websites change. Your data contract shouldn't.”**

This walkthrough is the live production story. Evidence is official provider pages collected by **Bright Data Scraper Studio**, admitted by **Sentinel**, and served from trusted history — not fixtures, not model memory.

Suggested questions (on screen):

- Temporal: *What changed in Claude this month?*
- Decision: *What is the cheapest active model with at least 128K context and tool calling?*

---

**0:00 — Problem (10s)**

AI infrastructure pages rewrite themselves. Prices, catalogs, and HTML all move. A broken scrape written as a price is worse than no scrape.

**0:10 — Dashboard (15s)**

Open `/`. Live official web evidence, ten fleet sources, scheduler-backed freshness. Footer: Bright Data Scraper Studio. This is StackPulse (decisions) plus SourcePulse (collection integrity).

**0:25 — Explorer (15s)**

`/models`. Filter provider, price, context, vision, tools, active-only. Unknown stays Unknown — never “unsupported.”

**0:40 — Compare (10s)**

`/models/compare` with real canonical ids in the URL. Side by side. This view does not rank.

**0:50 — Optimizer (15s)**

`/optimizer`. Realistic tokens + 128K + tools. Ranking is live adapter math over published prices. Missing evidence is ineligible, not $0.

**1:05 — Ask AI Radar (25s)**

`/ask`.

1. Temporal: *What changed in Claude this month?*
2. Decision: cheapest active ≥128K with tool calling.

Grounded from trusted observations. Point at interpreted constraints and provenance.

**1:30 — Provenance (10s)**

Follow a source URL / Source Detail. Collector, run, snapshot. Live official pages, not a dump.

**1:40 — Changes (10s)**

`/changes`. The temporal store Ask just used.

**1:50 — Source Health (15s)**

`/source-health`. Live Sentinel fleet — not the in-memory simulator. Gemini catalog is **DEGRADED** on purpose: partial acceptance, not fake zeros. Recovered demo history is here: quarantine, last-known-good, Bright Data repair, preview, approval, recovery.

**2:05 — Healing Demo (25s)**

`/demo/healing`. Isolated Scraper Studio collector. Real path: break → Sentinel → quarantine → LKG held → heal → preview → validate → approve → rerun → **RECOVERED**. Zero bad canonical writes. After proof the page is clean and ready (healthy LKG); do not re-run an expensive cycle on stage.

**2:30 — Close (10s)**

Bright Data collects and heals. Sentinel admits. History decides.

*Websites change. Your data contract shouldn't.*
