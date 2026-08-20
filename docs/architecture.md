# Architecture

AI Radar / StackPulse, powered by SourcePulse. Bright Data Scraper Studio is the collection and repair plane.

```mermaid
flowchart TB
  subgraph Public["PUBLIC AI WEB"]
    OAI["OpenAI pricing / models"]
    ANT["Anthropic pricing / models / deprecations"]
    GEM["Gemini pricing / models / deprecations"]
    XAI["xAI pricing / models"]
  end

  subgraph BrightData["BRIGHT DATA SCRAPER STUDIO"]
    COL["Collectors<br/>pricing · lifecycle · catalog · isolated demo"]
    DCA["Trigger · poll dataset · refactor / heal"]
  end

  subgraph Contracts["RAW CONTRACTS"]
    P["Pricing records"]
    L["Lifecycle records"]
    C["Catalog / capability records"]
  end

  subgraph Sentinel["SENTINEL"]
    GATE["assertSentinelSafe<br/>contract + health vs last-known-good"]
    Q["Quarantine payload + incident"]
    LKG["Last-known-good snapshot"]
    HEAL["Bounded heal attempt"]
  end

  subgraph Canonical["TRUSTED HISTORY"]
    NORM["Normalize + identity"]
    SB[("Supabase<br/>snapshots · history · change events<br/>orchestration runs")]
  end

  subgraph Product["STACKPULSE"]
    DASH["Dashboard"]
    EXP["Model Explorer"]
    CMP["Compare"]
    CHG["Change Feed"]
    OPT["Stack Optimizer"]
    ASK["Ask AI Radar"]
    SRC["Sources / Source Detail / Source Health"]
  end

  OAI --> COL
  ANT --> COL
  GEM --> COL
  XAI --> COL
  COL --> DCA
  DCA --> P
  DCA --> L
  DCA --> C
  P --> GATE
  L --> GATE
  C --> GATE
  GATE -->|unsafe| Q
  GATE -->|unsafe| LKG
  Q --> HEAL
  HEAL --> DCA
  GATE -->|safe| NORM
  LKG -.->|serve trusted current| Product
  NORM --> SB
  SB --> DASH
  SB --> EXP
  SB --> CMP
  SB --> CHG
  SB --> OPT
  SB --> ASK
  SB --> SRC
```

## Why Bright Data is central

Without Scraper Studio there is no collection, no dataset to validate, and no refactor job for healing. Cron only decides *when* a source is due. Sentinel only decides *whether* a payload may become history. The product never scrapes provider pages from the Next.js runtime.

## Runtime path for one source

```
Vercel Cron  →  /api/cron/collect
             →  lease the source
             →  Bright Data collector
             →  raw contract
             →  Sentinel gate
                  unsafe → incident + quarantine, run failed, no canonical write
                  safe   → snapshots, change events, projections
             →  bounded heal if quarantined (candidate re-enters this path)
             →  report + release lease
```

Details: [`collection-orchestration.md`](collection-orchestration.md), [`brightdata-ingestion.md`](brightdata-ingestion.md), [`sentinel-healing-demo.md`](sentinel-healing-demo.md).
