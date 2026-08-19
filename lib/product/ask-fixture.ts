/**
 * Demonstration Ask AI Radar adapter.
 *
 * Maps a small set of example questions onto canned temporal, decision and
 * unsupported read models. It does not parse language, rank models, or walk
 * change events — those rules belong to Claude's grounded NL backend.
 *
 * Replace by implementing `AskAdapter` and calling `setAskAdapter`.
 */

import { modelDetailHref } from "./explorer";
import {
  ASK_EXAMPLE_QUERIES,
  ASK_GROUNDING_STATEMENT,
  askIntentLabel,
  changesHref,
  registerDefaultAskAdapter,
  sourceHref,
  type AskAdapter,
  type AskReadModel,
} from "./ask";
import { optimizerHref } from "./optimizer";
import { provenanceFromSource } from "./provenance";

export const FIXTURE_ASK_ADAPTER_ID = "fixture-ask-v1";

const GENERATED_AT = "2026-08-19T12:00:00.000Z";
const OBSERVED_AT = "2026-08-19T09:00:00.000Z";

const currentFreshness = {
  quality: "current" as const,
  label: "Current",
  observedAt: OBSERVED_AT,
  description: "Answer assembled from observations collected within the last 48 hours.",
};

const anthropicProvenance = provenanceFromSource({
  sourceLabel: "Anthropic model catalog",
  sourceUrl: "https://docs.anthropic.com/en/docs/models-overview",
  sourceKind: "models",
  collectorId: "anthropic-catalog",
  observedAt: OBSERVED_AT,
  authority: "authoritative",
  isDemo: true,
});

const geminiProvenance = provenanceFromSource({
  sourceLabel: "Gemini API models",
  sourceUrl: "https://ai.google.dev/gemini-api/docs/models",
  sourceKind: "models",
  collectorId: "gemini-catalog",
  observedAt: "2026-08-12T14:20:00.000Z",
  authority: "verified_scrape",
  isDemo: true,
});

const openaiProvenance = provenanceFromSource({
  sourceLabel: "OpenAI API pricing",
  sourceUrl: "https://openai.com/api/pricing",
  sourceKind: "pricing",
  collectorId: "openai-pricing",
  observedAt: "2026-08-18T16:00:00.000Z",
  authority: "authoritative",
  isDemo: true,
});

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

const TEMPORAL_CLAUDE: Omit<AskReadModel, "question"> = {
  intent: "temporal",
  intentLabel: askIntentLabel("temporal"),
  interpretedConstraints: [
    { id: "intent", label: "Intent", value: "Temporal change" },
    { id: "provider", label: "Provider", value: "Anthropic / Claude" },
    { id: "range", label: "Range", value: "This month (30d)" },
  ],
  answer:
    "Two observed Claude changes this month: Claude Sonnet 4.5 remains active with unchanged standard pricing, and Claude Haiku 3.5 showed a cached-input price decrease on 11 August. No deprecation or retirement has been recorded for the Claude family in this window.",
  groundingStatement: ASK_GROUNDING_STATEMENT,
  calculations: [],
  evidence: [
    {
      id: "claude-sonnet-change",
      kind: "change",
      title: "Claude Sonnet 4.5 — no price movement",
      summary: "Standard input $3 / output $15 per 1M tokens, last observed 19 August.",
      observedAt: OBSERVED_AT,
      modelCanonicalId: "anthropic:claude-sonnet-4-5",
      sourceId: "anthropic-catalog",
      href: modelDetailHref("anthropic:claude-sonnet-4-5"),
      provenance: anthropicProvenance,
    },
    {
      id: "claude-haiku-change",
      kind: "change",
      title: "Claude Haiku 3.5 — cached input price decrease",
      summary: "Cached input pricing fell. Open the change feed for the before/after record.",
      observedAt: "2026-08-11T09:15:00.000Z",
      modelCanonicalId: "anthropic:claude-haiku-3-5",
      sourceId: "anthropic-pricing",
      href: changesHref("anthropic", "30d"),
      provenance: anthropicProvenance,
    },
  ],
  unsupportedReason: null,
  missingData: "Capability history for Claude Opus was not observed in this window.",
  observedAt: OBSERVED_AT,
  freshness: currentFreshness,
  provenance: anthropicProvenance,
  generatedAt: GENERATED_AT,
  isDemo: true,
};

const TEMPORAL_GEMINI: Omit<AskReadModel, "question"> = {
  intent: "temporal",
  intentLabel: askIntentLabel("temporal"),
  interpretedConstraints: [
    { id: "intent", label: "Intent", value: "Temporal change" },
    { id: "provider", label: "Provider", value: "Google / Gemini" },
    { id: "range", label: "Range", value: "Recently (30d)" },
  ],
  answer:
    "Gemini 2.5 Pro was observed with a 1M context window and current pricing. No Gemini retirement was recorded in the last 30 days. Open Changes for the full Gemini feed.",
  groundingStatement: ASK_GROUNDING_STATEMENT,
  calculations: [],
  evidence: [
    {
      id: "gemini-pro-change",
      kind: "change",
      title: "Gemini 2.5 Pro — catalog refresh",
      summary: "1M context and vision/tool calling remain observed as supported.",
      observedAt: "2026-08-12T14:20:00.000Z",
      modelCanonicalId: "google:gemini-2-5-pro",
      sourceId: "gemini-catalog",
      href: modelDetailHref("google:gemini-2-5-pro"),
      provenance: geminiProvenance,
    },
    {
      id: "gemini-feed",
      kind: "source",
      title: "Gemini change feed",
      summary: "All observed Gemini movement in the last 30 days.",
      observedAt: "2026-08-12T14:20:00.000Z",
      modelCanonicalId: null,
      sourceId: "gemini-catalog",
      href: sourceHref("gemini-catalog"),
      provenance: geminiProvenance,
    },
  ],
  unsupportedReason: null,
  missingData: null,
  observedAt: "2026-08-12T14:20:00.000Z",
  freshness: {
    ...currentFreshness,
    observedAt: "2026-08-12T14:20:00.000Z",
  },
  provenance: geminiProvenance,
  generatedAt: GENERATED_AT,
  isDemo: true,
};

const DECISION_500K: Omit<AskReadModel, "question"> = {
  intent: "decision",
  intentLabel: askIntentLabel("decision"),
  interpretedConstraints: [
    { id: "intent", label: "Intent", value: "Model selection" },
    { id: "lifecycle", label: "Lifecycle", value: "Active only" },
    { id: "min_context", label: "Minimum context", value: "500K" },
    { id: "vision", label: "Vision", value: "Required" },
    { id: "tools", label: "Tool calling", value: "Required" },
    { id: "priority", label: "Priority", value: "Lowest monthly cost" },
  ],
  answer:
    "Among active models with observed 500K+ context, vision and tool calling, Gemini 2.5 Pro is the cheapest fit in this demonstration ranking. Claude Sonnet 4.5 is eligible on vision and tools but does not meet a 500K context floor. Models whose vision was not observed are listed as unknown evidence, not as unsupported.",
  groundingStatement: ASK_GROUNDING_STATEMENT,
  calculations: [
    {
      label: "Estimated monthly cost · Gemini 2.5 Pro",
      expression: "10M input × $1.25/1M + 1M output × $10.00/1M",
      result: "$22.50",
      note: "Supplied by the optimizer adapter. The UI does not calculate this.",
    },
  ],
  evidence: [
    {
      id: "gemini-best",
      kind: "model",
      title: "Gemini 2.5 Pro — best fit",
      summary: "Active, 1M context, vision and tools observed, pricing available.",
      observedAt: "2026-08-17T11:00:00.000Z",
      modelCanonicalId: "google:gemini-2-5-pro",
      sourceId: "gemini-catalog",
      href: modelDetailHref("google:gemini-2-5-pro"),
      provenance: geminiProvenance,
    },
    {
      id: "open-optimizer",
      kind: "note",
      title: "Open Stack Optimizer",
      summary: "The same constraints can be inspected as a ranked eligible/excluded list.",
      observedAt: null,
      modelCanonicalId: null,
      sourceId: null,
      href: optimizerHref({
        monthlyInputTokens: 10_000_000,
        monthlyOutputTokens: 1_000_000,
        minContext: 500_000,
        minMaxOutput: null,
        visionRequired: true,
        toolCallingRequired: true,
        providers: [],
        activeOnly: true,
        priority: "lowest_monthly_cost",
      }),
      provenance: null,
    },
  ],
  unsupportedReason: null,
  missingData: "o3 vision has not been observed, so it cannot confirm the vision requirement.",
  observedAt: "2026-08-17T11:00:00.000Z",
  freshness: currentFreshness,
  provenance: geminiProvenance,
  generatedAt: GENERATED_AT,
  isDemo: true,
};

const DECISION_128K: Omit<AskReadModel, "question"> = {
  intent: "decision",
  intentLabel: askIntentLabel("decision"),
  interpretedConstraints: [
    { id: "intent", label: "Intent", value: "Model selection" },
    { id: "lifecycle", label: "Lifecycle", value: "Active only" },
    { id: "min_context", label: "Minimum context", value: "128K" },
    { id: "priority", label: "Priority", value: "Lowest monthly cost for submitted workload" },
  ],
  answer:
    "For an active model with at least 128K context, Claude Sonnet 4.5 is the cheapest demonstration fit for a 10M input / 1M output monthly workload. GPT-4o and Gemini 2.5 Pro remain eligible.",
  groundingStatement: ASK_GROUNDING_STATEMENT,
  calculations: [
    {
      label: "Estimated monthly cost · Claude Sonnet 4.5",
      expression: "10M input × $3.00/1M + 1M output × $15.00/1M",
      result: "$45.00",
      note: "Supplied by the optimizer adapter. The UI does not calculate this.",
    },
    {
      label: "Estimated monthly cost · GPT-4o",
      expression: "10M input × $2.50/1M + 1M output × $10.00/1M",
      result: "$35.00",
      note: "Demonstration figure from the Ask adapter, not calculated in the UI.",
    },
  ],
  evidence: [
    {
      id: "sonnet-best",
      kind: "model",
      title: "Claude Sonnet 4.5 — ranked eligible",
      summary: "Active, 200K context, vision and tools observed.",
      observedAt: OBSERVED_AT,
      modelCanonicalId: "anthropic:claude-sonnet-4-5",
      sourceId: "anthropic-catalog",
      href: modelDetailHref("anthropic:claude-sonnet-4-5"),
      provenance: anthropicProvenance,
    },
    {
      id: "gpt-4o",
      kind: "model",
      title: "GPT-4o — ranked eligible",
      summary: "Active, 128K context, vision and tools observed.",
      observedAt: "2026-08-18T16:00:00.000Z",
      modelCanonicalId: "openai:gpt-4o",
      sourceId: "openai-pricing",
      href: modelDetailHref("openai:gpt-4o"),
      provenance: openaiProvenance,
    },
  ],
  unsupportedReason: null,
  missingData: null,
  observedAt: OBSERVED_AT,
  freshness: currentFreshness,
  provenance: anthropicProvenance,
  generatedAt: GENERATED_AT,
  isDemo: true,
};

const DECISION_COMPARE: Omit<AskReadModel, "question"> = {
  intent: "decision",
  intentLabel: askIntentLabel("decision"),
  interpretedConstraints: [
    { id: "intent", label: "Intent", value: "Provider comparison" },
    { id: "providers", label: "Providers", value: "Anthropic, OpenAI" },
    { id: "eligibility", label: "Eligibility", value: "Eligible only" },
  ],
  answer:
    "Eligible Anthropic and OpenAI options in this demonstration set are Claude Sonnet 4.5 and GPT-4o. Compare them side by side, or open Stack Optimizer for the ranked view. Grok 4 is not in this pair because pricing is unavailable; o3 is unknown evidence for vision.",
  groundingStatement: ASK_GROUNDING_STATEMENT,
  calculations: [],
  evidence: [
    {
      id: "sonnet",
      kind: "model",
      title: "Claude Sonnet 4.5",
      summary: "Anthropic · $3 / $15 per 1M · 200K context · vision and tools observed.",
      observedAt: OBSERVED_AT,
      modelCanonicalId: "anthropic:claude-sonnet-4-5",
      sourceId: "anthropic-catalog",
      href: modelDetailHref("anthropic:claude-sonnet-4-5"),
      provenance: anthropicProvenance,
    },
    {
      id: "gpt4o",
      kind: "model",
      title: "GPT-4o",
      summary: "OpenAI · $2.50 / $10 per 1M · 128K context · vision and tools observed.",
      observedAt: "2026-08-18T16:00:00.000Z",
      modelCanonicalId: "openai:gpt-4o",
      sourceId: "openai-pricing",
      href: "/models/compare?ids=anthropic%3Aclaude-sonnet-4-5%2Copenai%3Agpt-4o",
      provenance: openaiProvenance,
    },
  ],
  unsupportedReason: null,
  missingData: "xAI Grok 4 pricing has not been observed, so it is omitted from this eligible pair.",
  observedAt: OBSERVED_AT,
  freshness: currentFreshness,
  provenance: anthropicProvenance,
  generatedAt: GENERATED_AT,
  isDemo: true,
};

function unsupportedModel(question: string): AskReadModel {
  return {
    question,
    intent: "unsupported",
    intentLabel: askIntentLabel("unsupported"),
    interpretedConstraints: [
      { id: "intent", label: "Intent", value: "Unsupported" },
    ],
    answer:
      "AI Radar can answer temporal questions about observed changes and decision questions about eligible models. It cannot forecast unreleased models, invent prices, or answer from model memory.",
    groundingStatement: ASK_GROUNDING_STATEMENT,
    calculations: [],
    evidence: [],
    unsupportedReason:
      "This question is outside the grounded temporal and decision questions AI Radar can answer from collected evidence.",
    missingData: null,
    observedAt: null,
    freshness: {
      quality: "unknown",
      label: "Unknown",
      observedAt: null,
      description: "No observation was selected because the query is unsupported.",
    },
    provenance: null,
    generatedAt: GENERATED_AT,
    isDemo: true,
  };
}

function emptyModel(): AskReadModel {
  return {
    question: "",
    intent: "empty",
    intentLabel: askIntentLabel("empty"),
    interpretedConstraints: [],
    answer: "",
    groundingStatement: ASK_GROUNDING_STATEMENT,
    calculations: [],
    evidence: [],
    unsupportedReason: null,
    missingData: null,
    observedAt: null,
    freshness: {
      quality: "unknown",
      label: "Unknown",
      observedAt: null,
      description: "No query has been submitted yet.",
    },
    provenance: null,
    generatedAt: GENERATED_AT,
    isDemo: true,
  };
}

/**
 * Fixture routing only: exact example questions, then a few obvious phrases.
 * This is not the production interpreter.
 */
export function selectAskFixtureScenario(
  query: string,
): "empty" | "temporal-claude" | "temporal-gemini" | "decision-500k" | "decision-128k" | "decision-compare" | "unsupported" {
  const normalized = normalizeQuery(query);
  if (!normalized) return "empty";

  const exact = ASK_EXAMPLE_QUERIES.find((example) => normalizeQuery(example.query) === normalized);
  if (exact?.id === "temporal-claude") return "temporal-claude";
  if (exact?.id === "temporal-gemini") return "temporal-gemini";
  if (exact?.id === "decision-500k") return "decision-500k";
  if (exact?.id === "decision-128k") return "decision-128k";
  if (exact?.id === "decision-compare") return "decision-compare";

  if (normalized.includes("claude") && normalized.includes("changed")) return "temporal-claude";
  if (normalized.includes("gemini") && normalized.includes("changed")) return "temporal-gemini";
  if (normalized.includes("500k") || normalized.includes("500 k")) return "decision-500k";
  if (normalized.includes("128k") || normalized.includes("128 k")) return "decision-128k";
  if (normalized.includes("compare") && (normalized.includes("anthropic") || normalized.includes("openai"))) {
    return "decision-compare";
  }

  return "unsupported";
}

export function createFixtureAskAdapter(): AskAdapter {
  return {
    id: FIXTURE_ASK_ADAPTER_ID,
    label: "Fixture Ask AI Radar (replaceable)",
    async ask(query: string): Promise<AskReadModel> {
      const scenario = selectAskFixtureScenario(query);
      if (scenario === "empty") return emptyModel();
      if (scenario === "temporal-claude") return { question: query.trim(), ...TEMPORAL_CLAUDE };
      if (scenario === "temporal-gemini") return { question: query.trim(), ...TEMPORAL_GEMINI };
      if (scenario === "decision-500k") return { question: query.trim(), ...DECISION_500K };
      if (scenario === "decision-128k") return { question: query.trim(), ...DECISION_128K };
      if (scenario === "decision-compare") return { question: query.trim(), ...DECISION_COMPARE };
      return unsupportedModel(query.trim());
    },
  };
}

export function installFixtureAskAdapter(): void {
  registerDefaultAskAdapter(createFixtureAskAdapter);
}
