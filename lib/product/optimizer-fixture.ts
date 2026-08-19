/**
 * Demonstration optimizer adapter.
 *
 * Returns a precomputed ranking that covers every eligibility state the UI
 * must render. It does not filter, score, or estimate cost from the submitted
 * controls — those rules belong to Claude's deterministic optimizer. The
 * fixture echoes the input as applied constraints so the screen can show what
 * was asked, then serves a canned result until that backend is installed.
 *
 * Replace by implementing `OptimizerAdapter` and calling `setOptimizerAdapter`.
 */

import {
  appliedConstraintsFromInput,
  OPTIMIZER_PROVIDER_OPTIONS,
  optimizerEligibilityLabel,
  registerDefaultOptimizerAdapter,
  type OptimizerAdapter,
  type OptimizerInput,
  type OptimizerModelResult,
  type OptimizerReadModel,
  type RequirementCheck,
} from "./optimizer";
import { observedBoolean, type ModelIdentityView } from "./explorer";
import { provenanceFromSource } from "./provenance";

export const FIXTURE_OPTIMIZER_ADAPTER_ID = "fixture-optimizer-v1";

const GENERATED_AT = "2026-08-19T12:00:00.000Z";

function identity(
  partial: Pick<
    ModelIdentityView,
    "canonicalId" | "modelId" | "providerSlug" | "providerName" | "modelName" | "displayName"
  > &
    Partial<ModelIdentityView>,
): ModelIdentityView {
  return {
    apiModelId: partial.modelName,
    modelFamily: null,
    modelStage: "ga",
    ...partial,
  };
}

function freshness(observedAt: string) {
  return {
    quality: "current" as const,
    label: "Current",
    observedAt,
    description: "Observed within the last 48 hours.",
  };
}

function lifecycle(state: "active" | "legacy" | "deprecated") {
  return {
    state,
    label: state === "active" ? "Active" : state === "legacy" ? "Legacy" : "Deprecated",
    isActive: state === "active",
    deprecatedOn: state === "deprecated" ? "2026-03-01" : null,
    retirementDate: null,
    retirementNotBefore: null,
  };
}

function checks(rows: RequirementCheck[]): RequirementCheck[] {
  return rows;
}

function model(result: OptimizerModelResult): OptimizerModelResult {
  return {
    ...result,
    eligibilityLabel: result.eligibilityLabel || optimizerEligibilityLabel(result.eligibility),
  };
}

/**
 * Canned catalog covering eligible, excluded, unknown-evidence and
 * unavailable-pricing. Rank order is part of the fixture, not computed here.
 */
export function fixtureOptimizerModels(): OptimizerModelResult[] {
  const anthropicProvenance = provenanceFromSource({
    sourceLabel: "Anthropic model catalog",
    sourceUrl: "https://docs.anthropic.com/en/docs/models-overview",
    sourceKind: "models",
    observedAt: "2026-08-19T09:00:00.000Z",
    authority: "authoritative",
    isDemo: true,
  });
  const openaiProvenance = provenanceFromSource({
    sourceLabel: "OpenAI API pricing",
    sourceUrl: "https://openai.com/api/pricing",
    sourceKind: "pricing",
    observedAt: "2026-08-18T16:00:00.000Z",
    authority: "authoritative",
    isDemo: true,
  });
  const googleProvenance = provenanceFromSource({
    sourceLabel: "Gemini API models",
    sourceUrl: "https://ai.google.dev/gemini-api/docs/models",
    sourceKind: "models",
    observedAt: "2026-08-17T11:00:00.000Z",
    authority: "verified_scrape",
    isDemo: true,
  });
  const xaiProvenance = provenanceFromSource({
    sourceLabel: "xAI models",
    sourceUrl: "https://docs.x.ai/developers/models",
    sourceKind: "models",
    observedAt: "2026-08-16T08:00:00.000Z",
    authority: "verified_scrape",
    isDemo: true,
  });

  return [
    model({
      identity: identity({
        canonicalId: "anthropic:claude-sonnet-4-5",
        modelId: "m-sonnet",
        providerSlug: "anthropic",
        providerName: "Anthropic",
        modelName: "claude-sonnet-4-5",
        displayName: "Claude Sonnet 4.5",
        modelFamily: "Claude",
      }),
      rank: 1,
      eligibility: "eligible",
      eligibilityLabel: "Eligible",
      exclusionReason: null,
      estimatedMonthlyCost: 45,
      estimatedMonthlyCostLabel: "$45.00",
      currency: "USD",
      inputPrice: 3,
      outputPrice: 15,
      contextWindow: 200_000,
      maxOutputTokens: 8192,
      vision: observedBoolean(true),
      toolCalling: observedBoolean(true),
      lifecycle: lifecycle("active"),
      freshness: freshness("2026-08-19T09:00:00.000Z"),
      provenance: anthropicProvenance,
      requirementChecks: checks([
        {
          id: "context",
          label: "Minimum context",
          status: "pass",
          detail: "200K context meets the submitted floor.",
        },
        {
          id: "max_output",
          label: "Minimum max output",
          status: "pass",
          detail: "8,192 max output was observed.",
        },
        {
          id: "vision",
          label: "Vision",
          status: "pass",
          detail: "Vision is observed as supported.",
        },
        {
          id: "tools",
          label: "Tool calling",
          status: "pass",
          detail: "Tool calling is observed as supported.",
        },
        {
          id: "lifecycle",
          label: "Lifecycle",
          status: "pass",
          detail: "Observed as active.",
        },
        {
          id: "pricing",
          label: "Pricing",
          status: "pass",
          detail: "Input and output prices were observed.",
        },
      ]),
    }),
    model({
      identity: identity({
        canonicalId: "openai:gpt-4o",
        modelId: "m-gpt-4o",
        providerSlug: "openai",
        providerName: "OpenAI",
        modelName: "gpt-4o",
        displayName: "GPT-4o",
        modelFamily: "GPT",
      }),
      rank: 2,
      eligibility: "eligible",
      eligibilityLabel: "Eligible",
      exclusionReason: null,
      estimatedMonthlyCost: 52.5,
      estimatedMonthlyCostLabel: "$52.50",
      currency: "USD",
      inputPrice: 2.5,
      outputPrice: 10,
      contextWindow: 128_000,
      maxOutputTokens: 16384,
      vision: observedBoolean(true),
      toolCalling: observedBoolean(true),
      lifecycle: lifecycle("active"),
      freshness: freshness("2026-08-18T16:00:00.000Z"),
      provenance: openaiProvenance,
      requirementChecks: checks([
        {
          id: "context",
          label: "Minimum context",
          status: "pass",
          detail: "128K context meets the submitted floor.",
        },
        {
          id: "vision",
          label: "Vision",
          status: "pass",
          detail: "Vision is observed as supported.",
        },
        {
          id: "tools",
          label: "Tool calling",
          status: "pass",
          detail: "Tool calling is observed as supported.",
        },
        {
          id: "lifecycle",
          label: "Lifecycle",
          status: "pass",
          detail: "Observed as active.",
        },
        {
          id: "pricing",
          label: "Pricing",
          status: "pass",
          detail: "Input and output prices were observed.",
        },
      ]),
    }),
    model({
      identity: identity({
        canonicalId: "google:gemini-2-5-pro",
        modelId: "m-gemini-pro",
        providerSlug: "google",
        providerName: "Google",
        modelName: "gemini-2.5-pro",
        displayName: "Gemini 2.5 Pro",
        modelFamily: "Gemini",
      }),
      rank: 3,
      eligibility: "eligible",
      eligibilityLabel: "Eligible",
      exclusionReason: null,
      estimatedMonthlyCost: 61,
      estimatedMonthlyCostLabel: "$61.00",
      currency: "USD",
      inputPrice: 1.25,
      outputPrice: 10,
      contextWindow: 1_000_000,
      maxOutputTokens: 65536,
      vision: observedBoolean(true),
      toolCalling: observedBoolean(true),
      lifecycle: lifecycle("active"),
      freshness: freshness("2026-08-17T11:00:00.000Z"),
      provenance: googleProvenance,
      requirementChecks: checks([
        {
          id: "context",
          label: "Minimum context",
          status: "pass",
          detail: "1M context meets the submitted floor.",
        },
        {
          id: "vision",
          label: "Vision",
          status: "pass",
          detail: "Vision is observed as supported.",
        },
        {
          id: "tools",
          label: "Tool calling",
          status: "pass",
          detail: "Tool calling is observed as supported.",
        },
        {
          id: "lifecycle",
          label: "Lifecycle",
          status: "pass",
          detail: "Observed as active.",
        },
        {
          id: "pricing",
          label: "Pricing",
          status: "pass",
          detail: "Input and output prices were observed.",
        },
      ]),
    }),
    model({
      identity: identity({
        canonicalId: "anthropic:claude-haiku-3-5",
        modelId: "m-haiku",
        providerSlug: "anthropic",
        providerName: "Anthropic",
        modelName: "claude-3-5-haiku",
        displayName: "Claude Haiku 3.5",
        modelFamily: "Claude",
      }),
      rank: null,
      eligibility: "excluded",
      eligibilityLabel: "Excluded",
      exclusionReason: "Excluded because the submitted minimum context was not met.",
      estimatedMonthlyCost: 8,
      estimatedMonthlyCostLabel: "$8.00",
      currency: "USD",
      inputPrice: 0.8,
      outputPrice: 4,
      contextWindow: 200_000,
      maxOutputTokens: 8192,
      vision: observedBoolean(true),
      toolCalling: observedBoolean(true),
      lifecycle: lifecycle("active"),
      freshness: freshness("2026-08-19T09:00:00.000Z"),
      provenance: anthropicProvenance,
      requirementChecks: checks([
        {
          id: "context",
          label: "Minimum context",
          status: "fail",
          detail: "Excluded because the submitted context floor was not met.",
        },
        {
          id: "vision",
          label: "Vision",
          status: "pass",
          detail: "Vision is observed as supported.",
        },
        {
          id: "tools",
          label: "Tool calling",
          status: "pass",
          detail: "Tool calling is observed as supported.",
        },
      ]),
    }),
    model({
      identity: identity({
        canonicalId: "openai:o3",
        modelId: "m-o3",
        providerSlug: "openai",
        providerName: "OpenAI",
        modelName: "o3",
        displayName: "o3",
        modelFamily: "o-series",
      }),
      rank: null,
      eligibility: "unknown_evidence",
      eligibilityLabel: "Unknown evidence",
      exclusionReason:
        "Vision has not been observed for this model. Unknown is not the same as unsupported, so the adapter cannot treat it as a requirement failure.",
      estimatedMonthlyCost: null,
      estimatedMonthlyCostLabel: "Unknown",
      currency: "USD",
      inputPrice: 10,
      outputPrice: 40,
      contextWindow: 200_000,
      maxOutputTokens: 100_000,
      vision: observedBoolean(null),
      toolCalling: observedBoolean(true),
      lifecycle: lifecycle("active"),
      freshness: freshness("2026-08-18T16:00:00.000Z"),
      provenance: openaiProvenance,
      requirementChecks: checks([
        {
          id: "context",
          label: "Minimum context",
          status: "pass",
          detail: "200K context was observed.",
        },
        {
          id: "vision",
          label: "Vision",
          status: "unknown",
          detail:
            "Vision was not observed for this model. Unknown is not the same as unsupported, so this requirement cannot be confirmed.",
        },
        {
          id: "tools",
          label: "Tool calling",
          status: "pass",
          detail: "Tool calling is observed as supported.",
        },
      ]),
    }),
    model({
      identity: identity({
        canonicalId: "xai:grok-4",
        modelId: "m-grok-4",
        providerSlug: "xai",
        providerName: "xAI",
        modelName: "grok-4",
        displayName: "Grok 4",
        modelFamily: "Grok",
      }),
      rank: null,
      eligibility: "unavailable_pricing",
      eligibilityLabel: "Pricing unavailable",
      exclusionReason: "Context, vision and tools were observed, but no input/output price has been collected, so monthly cost cannot be estimated.",
      estimatedMonthlyCost: null,
      estimatedMonthlyCostLabel: "Unavailable",
      currency: null,
      inputPrice: null,
      outputPrice: null,
      contextWindow: 256_000,
      maxOutputTokens: 8192,
      vision: observedBoolean(true),
      toolCalling: observedBoolean(true),
      lifecycle: lifecycle("active"),
      freshness: freshness("2026-08-16T08:00:00.000Z"),
      provenance: xaiProvenance,
      requirementChecks: checks([
        {
          id: "context",
          label: "Minimum context",
          status: "pass",
          detail: "256K context was observed.",
        },
        {
          id: "vision",
          label: "Vision",
          status: "pass",
          detail: "Vision is observed as supported.",
        },
        {
          id: "tools",
          label: "Tool calling",
          status: "pass",
          detail: "Tool calling is observed as supported.",
        },
        {
          id: "pricing",
          label: "Pricing",
          status: "unavailable",
          detail: "No input or output price has been observed for this model.",
        },
      ]),
    }),
  ];
}

export function createFixtureOptimizerAdapter(): OptimizerAdapter {
  return {
    id: FIXTURE_OPTIMIZER_ADAPTER_ID,
    label: "Fixture optimizer (replaceable)",
    async optimize(input: OptimizerInput): Promise<OptimizerReadModel> {
      const models = fixtureOptimizerModels();
      const ranked = models.filter((item) => item.eligibility === "eligible");
      const other = models.filter((item) => item.eligibility !== "eligible");
      return {
        input,
        appliedConstraints: appliedConstraintsFromInput(input),
        bestFit: ranked[0] ?? null,
        ranked,
        other,
        providerOptions: OPTIMIZER_PROVIDER_OPTIONS,
        generatedAt: GENERATED_AT,
        isDemo: true,
        evidenceQuality: "current",
        evidenceNote:
          "Demonstration ranking supplied by the fixture adapter. Estimated costs and eligibility are not calculated in the UI.",
        emptyReason: null,
      };
    },
  };
}

export function installFixtureOptimizerAdapter(): void {
  registerDefaultOptimizerAdapter(createFixtureOptimizerAdapter);
}
