# Judge demo script (~2–3 minutes)

Closing line: **“Websites change. Your data contract shouldn't.”**

Distinguish **live evidence** (this deployment's Supabase + Bright Data) from **rehearsal evidence** (tests, doubles, local recordings, or an unavailable healing page). If a panel is empty or says unavailable, say that out loud. Do not narrate fixture success.

Suggested questions (product copy):

- Temporal: *What changed in Claude this month?*
- Decision: *What is the cheapest active model with 500K context, vision and tools?*

---

**0:00 — Problem (10s)**  
AI infrastructure pages move every week. Prices, deprecations, and HTML all change. A broken scrape written as a price is worse than no scrape.

**0:10 — Dashboard (20s)**  
Open `/`. This is StackPulse + SourcePulse: live catalog, changes, stack decisions, collection integrity. Point at Bright Data in the footer. If the page says live data unavailable, stop claiming a live ecosystem — navigate anyway and show empty-truth.

**0:30 — Explorer (15s)**  
`/models`. Observed pricing, context, vision, tools, lifecycle, freshness. Unknown is Unknown. Open one model if time.

**0:45 — Compare (10s)**  
`/models/compare`. Side by side. This view does not rank.

**0:55 — Optimizer (20s)**  
`/optimizer`. Submit a workload. Ranking is adapter arithmetic over published prices. Missing price → ineligible, not $0.

**1:15 — Ask AI Radar (25s)**  
`/ask`.  
1. Temporal question.  
2. Model-selection / workload question.  
Point at grounding + provenance. If no events, that is the answer.

**1:40 — Provenance (10s)**  
From a change, model, or Ask result, follow source URL / Source Detail. Collector, run, snapshot.

**1:50 — Changes (10s)**  
`/changes`. The temporal store Ask just used.

**2:00 — Source Health (15s)**  
`/source-health`. Sentinel fleet. Counts are live or unavailable — never fake zeros. Mention this is **not** the in-memory simulator.

**2:15 — Healing demo (25s)**  
`/demo/healing`.  
- **Unavailable** → say: the path is implemented; this deployment has not proven a live repair yet. Do not click through a success story.  
- **Real Bright Data demo** → walk LKG → break → quarantine → Scraper Studio heal → preview → validate → approve → rerun. Recovery only after the gate passes. If `isLive` is not proven, call it a configured demo, not a completed production incident.

**2:40 — Close (10s)**  
Bright Data collects and heals. Sentinel admits. History decides.  
*Websites change. Your data contract shouldn't.*
