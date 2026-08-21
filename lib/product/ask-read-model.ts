/**
 * Ask adapter backed by the grounded natural-language executor.
 *
 * A question in, `answerQuestion` out. Interpretation, temporal execution,
 * optimizer/filter runs and groundedness all stay in `lib/ask`. This module
 * projects that result into the Ask screen's read model, including constraints,
 * structured evidence, calculations, provenance, freshness, missing evidence
 * and groundedness. There is no pretrained-fact fallback and no fixture default.
 */

import { answerQuestion, type AskOptions, type GroundedAskResult } from "../ask";
import type { ModelExplorerReadPort } from "../explorer";
import { isSupabaseReadConfigured } from "../supabase/env";
import { explorerCanonicalId, modelDetailHref } from "./explorer";
import { freshnessFromObservation } from "./explorer-read-model";
import {
  ASK_GROUNDING_STATEMENT,
  askIntentLabel,
  changesHref,
  emptyAskReadModel,
  optimizerFromAskHref,
  registerDefaultAskAdapter,
  type AskAdapter,
  type AskConstraint,
  type AskEvidenceItem,
  type AskIntent,
  type AskModelFactView,
  type AskReadModel,
} from "./ask";

export const CANONICAL_ASK_ADAPTER_ID = "canonical-ask-v1";

export interface CanonicalAskDeps {
  port?: ModelExplorerReadPort;
  now?: () => Date;
  loadTemporalEvidence?: AskOptions["loadTemporalEvidence"];
  referenceDate?: string;
  configured?: boolean;
}

const CONSTRAINT_LABELS: Record<string, string> = {
  providers: "Providers",
  provider: "Provider",
  family: "Family",
  model: "Model",
  range: "Range",
  categories: "Categories",
  minContextWindow: "Minimum context",
  minMaxOutputTokens: "Minimum max output",
  visionRequired: "Vision",
  toolCallingRequired: "Tool calling",
  activeOnly: "Lifecycle",
  monthlyInputTokens: "Monthly input tokens",
  monthlyOutputTokens: "Monthly output tokens",
  priority: "Priority",
  superlative: "Superlative",
  compareProviders: "Compare providers",
};

function formatConstraintValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Required" : "Not required";
  return String(value);
}

function intentOf(result: GroundedAskResult): AskIntent {
  switch (result.interpretedIntent) {
    case "temporal_change_query":
      return "temporal";
    case "model_fact_query":
      return "fact";
    case "model_filter_query":
    case "workload_optimizer_query":
    case "comparison_query":
      return "decision";
    case "unsupported":
      return "unsupported";
  }
}

function groundingStatement(result: GroundedAskResult): string {
  if (result.groundedness.isGrounded) {
    return (
      `${ASK_GROUNDING_STATEMENT} Groundedness check passed` +
      (result.groundedness.groundedFactsCount > 0
        ? ` (${result.groundedness.groundedFactsCount} evidence facts).`
        : ".")
    );
  }
  return (
    `${ASK_GROUNDING_STATEMENT} The published summary was replaced because a claim ` +
    "was not present in the returned evidence."
  );
}

function constraintsOf(result: GroundedAskResult): AskConstraint[] {
  const rows: AskConstraint[] = [
    {
      id: "intent",
      label: "Intent",
      value: askIntentLabel(intentOf(result)),
    },
  ];
  for (const used of result.constraints) {
    rows.push({
      id: used.field,
      label: CONSTRAINT_LABELS[used.field] ?? used.field,
      value: formatConstraintValue(used.value),
    });
  }
  rows.push({
    id: "groundedness",
    label: "Groundedness",
    value: result.groundedness.isGrounded
      ? result.groundedness.sanitized
        ? "Sanitized to evidence"
        : "Grounded"
      : "Not grounded",
  });
  return rows;
}

function identityHref(providerSlug: string, modelName: string, modelId: string): string {
  return modelDetailHref(
    explorerCanonicalId({
      providerSlug,
      apiModelId: modelName,
      modelId,
    }),
  );
}

function evidenceFrom(result: GroundedAskResult): AskEvidenceItem[] {
  const items: AskEvidenceItem[] = [];
  const structured = result.structured;

  if (structured.kind === "temporal_change_query") {
    const range =
      typeof structured.bundle.query.range === "string" ? structured.bundle.query.range : "30d";
    for (const event of structured.bundle.events) {
      const canonicalId = explorerCanonicalId({
        providerSlug: event.provider,
        apiModelId: event.model,
        modelId: event.id,
      });
      items.push({
        id: event.id,
        kind: "change",
        title: `${event.displayName ?? event.model} — ${event.changeType.replaceAll("_", " ")}`,
        summary: event.summary,
        observedAt: event.observedAt,
        modelCanonicalId: canonicalId,
        sourceId: event.source.sourceId ?? null,
        href: changesHref(event.provider, range),
        provenance: result.provenance.find((view) => view.sourceUrl === event.source.url) ?? null,
      });
    }
  }

  if (structured.kind === "model_fact_query") {
    const entry = structured.model;
    const canonicalId = explorerCanonicalId({
      providerSlug: entry.provider.slug,
      apiModelId: entry.apiModelId ?? entry.modelName,
      modelId: entry.canonicalModelId,
    });
    items.push({
      id: entry.canonicalModelId,
      kind: "model",
      title: entry.displayName ?? entry.modelName,
      // Naming the matched identity is what lets a reader confirm the answer is
      // about the model they meant, rather than one whose name merely overlaps.
      summary:
        `${entry.provider.name} · resolved from "${structured.matchedOn}" ` +
        `(${structured.matchKind} match) · ${structured.lookup.fieldLabel}`,
      observedAt: structured.lookup.observedAt,
      modelCanonicalId: canonicalId,
      sourceId: null,
      href: modelDetailHref(canonicalId),
      provenance: structured.lookup.provenance,
    });
  }

  if (structured.kind === "workload_optimizer_query" || structured.kind === "model_filter_query") {
    const optimizer = structured.optimizer;
    for (const candidate of optimizer?.ranked.slice(0, 8) ?? []) {
      const canonicalId = explorerCanonicalId({
        providerSlug: candidate.provider.slug,
        apiModelId: candidate.modelName,
        modelId: candidate.canonicalModelId,
      });
      const total = candidate.cost.totalMonthlyCost;
      items.push({
        id: candidate.canonicalModelId,
        kind: "model",
        title: candidate.displayName ?? candidate.modelName,
        summary:
          total === null
            ? `${candidate.provider.name} · eligible, cost unknown`
            : `${candidate.provider.name} · estimated ${total.toFixed(2)} ${candidate.cost.currency ?? "USD"}`,
        observedAt: candidate.freshness.lastVerifiedAt,
        modelCanonicalId: canonicalId,
        sourceId: null,
        href: identityHref(candidate.provider.slug, candidate.modelName, candidate.canonicalModelId),
        provenance: candidate.provenance.pricing ?? candidate.provenance.capability,
      });
    }
    items.push({
      id: "open-optimizer",
      kind: "note",
      title: "Open Stack Optimizer",
      summary: "Inspect the same constraints as a ranked eligible and excluded list.",
      observedAt: null,
      modelCanonicalId: null,
      sourceId: null,
      href: optimizerFromAskHref(),
      provenance: null,
    });
  }

  if (structured.kind === "comparison_query") {
    for (const choice of structured.choices) {
      if (!choice.choice) continue;
      const candidate = choice.choice;
      items.push({
        id: `choice-${choice.provider}`,
        kind: "model",
        title: `${choice.provider}: ${candidate.displayName ?? candidate.modelName}`,
        summary: choice.reason ?? "Cheapest eligible choice for this provider.",
        observedAt: candidate.freshness.lastVerifiedAt,
        modelCanonicalId: explorerCanonicalId({
          providerSlug: candidate.provider.slug,
          apiModelId: candidate.modelName,
          modelId: candidate.canonicalModelId,
        }),
        sourceId: null,
        href: identityHref(candidate.provider.slug, candidate.modelName, candidate.canonicalModelId),
        provenance: candidate.provenance.pricing,
      });
    }
    items.push({
      id: "open-optimizer",
      kind: "note",
      title: "Open Stack Optimizer",
      summary: "Inspect the same constraints as a ranked eligible and excluded list.",
      observedAt: null,
      modelCanonicalId: null,
      sourceId: null,
      href: optimizerFromAskHref(),
      provenance: null,
    });
  }

  return items;
}

function modelFactFrom(result: GroundedAskResult): AskModelFactView | null {
  if (result.structured.kind !== "model_fact_query") return null;
  const { model, lookup } = result.structured;
  const canonicalId = explorerCanonicalId({
    providerSlug: model.provider.slug,
    apiModelId: model.apiModelId ?? model.modelName,
    modelId: model.canonicalModelId,
  });
  const value = lookup.value;
  return {
    modelName: model.displayName ?? model.modelName,
    modelHref: modelDetailHref(canonicalId),
    providerName: model.provider.name,
    fieldLabel: lookup.fieldLabel,
    subject: lookup.subject,
    status: value.status,
    display: value.status === "unknown" ? "Unknown" : value.display,
    statement: value.status === "unsupported" ? value.statement : null,
    reason: value.status === "unknown" ? value.reason : null,
    observedAt: lookup.observedAt,
    provenance: lookup.provenance,
    sourceLabel: lookup.provenance?.sourceLabel ?? null,
  };
}

export function projectAskReadModel(result: GroundedAskResult, now = new Date()): AskReadModel {
  const intent = intentOf(result);
  const isDemo =
    result.structured.kind === "temporal_change_query" && result.structured.bundle.isDemoData;
  const isFact = intent === "fact";
  return {
    question: result.question,
    intent,
    intentLabel: askIntentLabel(intent),
    interpretedConstraints: constraintsOf(result),
    answer: result.answerSummary,
    groundingStatement: groundingStatement(result),
    calculations: result.calculations,
    evidence: evidenceFrom(result),
    unsupportedReason:
      result.structured.kind === "unsupported"
        ? result.structured.detail
        : !isFact && result.unsupportedEvidence.length > 0
          ? result.unsupportedEvidence.join(" ")
          : null,
    missingData:
      !isFact && result.missingEvidence.length > 0 ? result.missingEvidence.join(" ") : null,
    observedAt: result.evidenceFreshness.newestObservedAt,
    freshness: freshnessFromObservation(result.evidenceFreshness.newestObservedAt, now, false),
    provenance: result.provenance[0] ?? null,
    modelFact: modelFactFrom(result),
    generatedAt: result.generatedAt,
    isDemo,
  };
}

export function createCanonicalAskAdapter(deps: CanonicalAskDeps = {}): AskAdapter {
  const clock = () => deps.now?.() ?? new Date();
  const configured = deps.configured ?? (deps.port ? true : isSupabaseReadConfigured());

  return {
    id: CANONICAL_ASK_ADAPTER_ID,
    label: "Canonical Ask AI Radar",
    async ask(query: string): Promise<AskReadModel> {
      const trimmed = query.trim();
      if (!trimmed) return emptyAskReadModel(clock().toISOString());

      if (!configured) {
        return {
          ...emptyAskReadModel(clock().toISOString()),
          question: trimmed,
          intent: "unsupported",
          intentLabel: askIntentLabel("unsupported"),
          answer:
            "Live evidence is not configured in this environment, so AI Radar will not answer from model memory.",
          unsupportedReason: "Live catalog is not configured in this environment.",
          groundingStatement: ASK_GROUNDING_STATEMENT,
        };
      }

      const now = clock();
      const result = await answerQuestion(trimmed, {
        port: deps.port,
        now: () => now,
        loadTemporalEvidence: deps.loadTemporalEvidence,
        referenceDate: deps.referenceDate,
        demo: false,
      });
      return projectAskReadModel(result, now);
    },
  };
}

export function installCanonicalAskAdapter(): void {
  registerDefaultAskAdapter(() => createCanonicalAskAdapter());
}
