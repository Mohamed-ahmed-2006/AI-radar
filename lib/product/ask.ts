/**
 * The typed seam between Ask AI Radar and the grounded natural-language backend.
 *
 * The query string is presentation state. Interpreting the question, gathering
 * evidence, running calculations and deciding that a query is unsupported are
 * the adapter's job. Components render the returned read model; they do not
 * parse English or rank models.
 *
 * Claude's grounded NL backend can be dropped in by implementing `AskAdapter`
 * and calling `setAskAdapter`. No component redesign.
 *
 * The experience always discloses that the answer came from observed evidence,
 * not model memory. Missing data stays missing. Unknown is never unsupported.
 */

import type { FreshnessView } from "./explorer";
import type { ProvenanceView } from "./provenance";

export const ASK_INTENTS = ["temporal", "decision", "unsupported", "empty"] as const;

export type AskIntent = (typeof ASK_INTENTS)[number];

export interface AskConstraint {
  id: string;
  label: string;
  value: string;
}

export interface AskCalculation {
  label: string;
  /** Backend-supplied expression. Null when the adapter did not disclose one. */
  expression: string | null;
  result: string;
  note: string | null;
}

export const ASK_EVIDENCE_KINDS = ["model", "change", "source", "note"] as const;

export type AskEvidenceKind = (typeof ASK_EVIDENCE_KINDS)[number];

export interface AskEvidenceItem {
  id: string;
  kind: AskEvidenceKind;
  title: string;
  summary: string;
  observedAt: string | null;
  modelCanonicalId: string | null;
  sourceId: string | null;
  href: string | null;
  provenance: ProvenanceView | null;
}

export const ASK_GROUNDING_STATEMENT =
  "AI Radar answered this from live trusted evidence, not model memory.";

export interface AskReadModel {
  question: string;
  intent: AskIntent;
  intentLabel: string;
  interpretedConstraints: AskConstraint[];
  answer: string;
  groundingStatement: string;
  calculations: AskCalculation[];
  evidence: AskEvidenceItem[];
  unsupportedReason: string | null;
  missingData: string | null;
  observedAt: string | null;
  freshness: FreshnessView;
  provenance: ProvenanceView | null;
  generatedAt: string;
  isDemo: boolean;
}

export interface AskAdapter {
  readonly id: string;
  readonly label: string;
  ask(query: string): Promise<AskReadModel>;
}

export const ASK_EXAMPLE_QUERIES = [
  {
    id: "temporal-claude",
    intent: "temporal" as const,
    label: "What changed in Claude this month?",
    query: "What changed in Claude this month?",
  },
  {
    id: "temporal-gemini",
    intent: "temporal" as const,
    label: "Which Gemini models changed recently?",
    query: "Which Gemini models changed recently?",
  },
  {
    id: "decision-500k",
    intent: "decision" as const,
    label: "Cheapest active model with 500K context, vision and tools",
    query: "What is the cheapest active model with 500K context, vision and tools?",
  },
  {
    id: "decision-128k",
    intent: "decision" as const,
    label: "Cheapest active model with ≥128K context",
    query: "Which active model with >=128K context is cheapest for my workload?",
  },
  {
    id: "decision-compare",
    intent: "decision" as const,
    label: "Compare eligible Anthropic and OpenAI options",
    query: "Compare eligible Anthropic and OpenAI options.",
  },
  {
    id: "temporal-week",
    intent: "temporal" as const,
    label: "What changed this week?",
    query: "What changed this week?",
  },
  {
    id: "decision-128k-tools",
    intent: "decision" as const,
    label: "What's the cheapest active model with 128K context and tools?",
    query: "What's the cheapest active model with 128K context and tools?",
  },
  {
    id: "decision-sonnet-gemini",
    intent: "decision" as const,
    label: "Compare Claude Sonnet 5 and Gemini 2.5 Pro.",
    query: "Compare Claude Sonnet 5 and Gemini 2.5 Pro.",
  },
] as const;

let installedAdapter: AskAdapter | null = null;
let defaultAdapterFactory: (() => AskAdapter) | null = null;

export function registerDefaultAskAdapter(factory: () => AskAdapter): void {
  defaultAdapterFactory = factory;
}

export function setAskAdapter(adapter: AskAdapter | null): void {
  installedAdapter = adapter;
}

export function getAskAdapter(): AskAdapter {
  if (installedAdapter) return installedAdapter;
  if (!defaultAdapterFactory) {
    throw new Error(
      "No Ask AI Radar adapter is installed. Import the canonical adapter or call setAskAdapter().",
    );
  }
  installedAdapter = defaultAdapterFactory();
  return installedAdapter;
}

export function askIntentLabel(intent: AskIntent): string {
  switch (intent) {
    case "temporal":
      return "Temporal";
    case "decision":
      return "Decision";
    case "unsupported":
      return "Unsupported";
    case "empty":
      return "Empty";
  }
}

export function askQueryFromParams(
  params: URLSearchParams | Record<string, string | undefined>,
): string {
  if (params instanceof URLSearchParams) return (params.get("q") ?? "").trim();
  return (params.q ?? "").trim();
}

export function askHref(query = ""): string {
  const trimmed = query.trim();
  if (!trimmed) return "/ask";
  return `/ask?q=${encodeURIComponent(trimmed)}`;
}

export function changesHref(provider?: string | null, range?: string | null): string {
  const params = new URLSearchParams();
  if (provider) params.set("provider", provider);
  if (range) params.set("range", range);
  const query = params.toString();
  return query ? `/changes?${query}` : "/changes";
}

export function sourceHref(sourceId: string): string {
  return `/sources/${encodeURIComponent(sourceId)}`;
}

export function optimizerFromAskHref(): string {
  return "/optimizer";
}

export function emptyAskReadModel(generatedAt = new Date(0).toISOString()): AskReadModel {
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
    generatedAt,
    isDemo: false,
  };
}
