import type {
  SentinelSourceView,
  SentinelView,
} from "../../../components/radar/sentinel/types";
import type { ChangeFeedItem } from "../../../lib/product/change-feed";
import { provenanceFromSource } from "../../../lib/product/provenance";
import type { SentinelLatestRun } from "../../../lib/product/sentinel-source-detail";

export function changeFeedItem(overrides: Partial<ChangeFeedItem> = {}): ChangeFeedItem {
  return {
    id: "evt-1",
    providerSlug: "anthropic",
    providerName: "Anthropic",
    modelKey: "anthropic:claude-3-5-sonnet-20241022",
    modelId: "claude-3-5-sonnet-20241022",
    modelLabel: "Claude 3.5 Sonnet",
    category: "pricing",
    categoryLabel: "Pricing",
    changeType: "price_decreased",
    changeTypeLabel: "Price decrease",
    tone: "positive",
    field: "cachedInputPricePer1MTokens",
    before: "$3.00",
    after: "$0.30",
    delta: "−90.0%",
    direction: "decrease",
    observedAt: "2026-08-11T09:15:00.000Z",
    significanceScore: 88,
    significanceTier: "high",
    summary: "Cached input pricing fell from $3.00 to $0.30 per 1M tokens.",
    provenance: provenanceFromSource({
      sourceLabel: "Anthropic official API pricing",
      sourceUrl: "https://www.anthropic.com/pricing",
      collectorId: "c_msx3bqlyjtv2qustx",
      observedAt: "2026-08-11T09:15:00.000Z",
      runId: "run-ant-01",
      authority: "authoritative",
      confidence: 1,
    }),
    isDemo: false,
    sourceId: "src-anthropic-pricing",
    ...overrides,
  };
}

export function sentinelSource(
  overrides: Partial<SentinelSourceView> = {},
): SentinelSourceView {
  return {
    sourceId: "src-openai-pricing",
    name: "OpenAI API pricing",
    providerName: "OpenAI",
    kind: "pricing",
    collectorId: "c_msx3bqlyjtv2qustx",
    sourceUrl: "https://openai.com/api/pricing",
    status: "healthy",
    health: "healthy",
    lastRunAt: "2026-08-17T09:00:00.000Z",
    stalenessMinutes: 42,
    currentRecordCount: 12,
    lastKnownGood: {
      label: "Last-known-good",
      runId: null,
      observedAt: "2026-08-17T09:00:00.000Z",
      recordCount: 12,
      invalidCount: null,
    },
    rejectedCandidate: null,
    incident: null,
    healing: { attempts: 0, latestStatus: null, succeeded: false },
    timeline: [
      {
        id: "src-openai-pricing-run",
        label: "Collection run",
        detail: "Succeeded · 12 records accepted",
        at: "2026-08-17T09:00:00.000Z",
        status: "done",
      },
    ],
    ...overrides,
  };
}

export function sentinelView(
  sources: SentinelSourceView[] = [sentinelSource()],
  overrides: Partial<SentinelView> = {},
): SentinelView {
  return {
    isDemo: false,
    demoScenario: null,
    generatedAt: "2026-08-17T09:30:00.000Z",
    sources,
    spotlightSourceId: null,
    summary: {
      totalSources: sources.length,
      healthySources: sources.length,
      degradedSources: 0,
      quarantinedSources: 0,
      healingSources: 0,
      needsReviewSources: 0,
      openIncidents: 0,
      statusCounts: {
        healthy: sources.length,
        degraded: 0,
        quarantined: 0,
        healing: 0,
        recovered: 0,
        needs_review: 0,
      },
      providers: 1,
      recordsProtected: 12,
      healingAttempts: 0,
      lastRunAt: "2026-08-17T09:00:00.000Z",
    },
    ...overrides,
  };
}

export function latestRun(overrides: Partial<SentinelLatestRun> = {}): SentinelLatestRun {
  return {
    sourceId: "src-openai-pricing",
    runId: "run-9f3",
    status: "succeeded",
    startedAt: "2026-08-17T08:59:00.000Z",
    completedAt: "2026-08-17T09:00:00.000Z",
    recordsSeen: 13,
    recordsAccepted: 12,
    recordsRejected: 1,
    errorMessage: null,
    isActive: true,
    ...overrides,
  };
}
