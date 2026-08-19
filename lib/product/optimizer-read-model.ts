/**
 * Optimizer adapter backed by the deterministic stack optimizer.
 *
 * Presentation controls in, `optimizeStack` out. Eligibility, fail-closed
 * unknown evidence, cost arithmetic and ranking all stay in `lib/optimizer`.
 * This module only projects that result into the Optimizer screen's read model.
 * The UI never ranks, and this adapter never invents a price.
 */

import { getModelExplorer, type ModelExplorerEntry, type ModelExplorerReadPort } from "../explorer";
import {
  calculateMonthlyCost,
  formatMoney,
  optimizeStack,
  type ExcludedCandidate,
  type OptimizationPriority as DomainPriority,
  type OptimizerCandidate,
  type RequirementCheck as DomainRequirementCheck,
  type StackOptimizerRequest,
  type StackOptimizerResult,
} from "../optimizer";
import { isSupabaseReadConfigured } from "../supabase/env";
import {
  freshnessFromObservation,
  newestProvenance,
  projectIdentity,
  projectLifecycle,
} from "./explorer-read-model";
import { observedBoolean, type EvidenceQuality } from "./explorer";
import {
  appliedConstraintsFromInput,
  OPTIMIZER_PROVIDER_OPTIONS,
  optimizerEligibilityLabel,
  registerDefaultOptimizerAdapter,
  type OptimizerAdapter,
  type OptimizerEligibility,
  type OptimizerInput,
  type OptimizerModelResult,
  type OptimizerReadModel,
  type RequirementCheck,
  type RequirementCheckStatus,
} from "./optimizer";
import type { ProvenanceView } from "./provenance";

export const CANONICAL_OPTIMIZER_ADAPTER_ID = "canonical-optimizer-v1";

export interface CanonicalOptimizerDeps {
  port?: ModelExplorerReadPort;
  now?: () => Date;
  configured?: boolean;
}

function emptyProvenance(): ProvenanceView {
  return {
    sourceLabel: null,
    sourceUrl: null,
    sourceKind: null,
    collectorId: null,
    observedAt: null,
    authority: null,
    confidence: null,
    trust: "unverified",
    validation: null,
    runId: null,
    externalRunId: null,
    snapshotId: null,
    previousSnapshotId: null,
    isDemo: false,
  };
}

function domainPriority(priority: OptimizerInput["priority"]): DomainPriority | "highest_context" {
  switch (priority) {
    case "lowest_input_price":
      return "lowest_input_cost";
    case "lowest_output_price":
      return "lowest_output_cost";
    case "highest_context":
      return "highest_context";
    case "lowest_monthly_cost":
    default:
      return "lowest_total_cost";
  }
}

function toRequest(input: OptimizerInput, priority: DomainPriority): StackOptimizerRequest {
  return {
    workload: {
      monthlyInputTokens: input.monthlyInputTokens ?? 0,
      monthlyOutputTokens: input.monthlyOutputTokens ?? 0,
    },
    minContextWindow: input.minContext ?? undefined,
    minMaxOutputTokens: input.minMaxOutput ?? undefined,
    visionRequired: input.visionRequired,
    toolCallingRequired: input.toolCallingRequired,
    providers: input.providers,
    activeOnly: input.activeOnly,
    priority,
  };
}

function mapCheckStatus(status: DomainRequirementCheck["status"]): RequirementCheckStatus | null {
  switch (status) {
    case "satisfied":
      return "pass";
    case "unsatisfied":
      return "fail";
    case "unknown":
      return "unknown";
    case "not_applicable":
      return null;
  }
}

function projectChecks(
  checks: readonly DomainRequirementCheck[],
  costExclusion: OptimizerCandidate["costExclusion"],
): RequirementCheck[] {
  const projected: RequirementCheck[] = [];
  for (const check of checks) {
    const status = mapCheckStatus(check.status);
    if (!status) continue;
    projected.push({
      id: check.requirement,
      label: check.label,
      status,
      detail: check.detail,
    });
  }
  if (costExclusion) {
    projected.push({
      id: "pricing",
      label: "Pricing",
      status: "unavailable",
      detail: costExclusion.detail,
    });
  }
  return projected;
}

function costLabel(
  amount: number | null,
  eligibility: OptimizerEligibility,
): string {
  if (amount !== null) return formatMoney(amount);
  if (eligibility === "unavailable_pricing") return "Unavailable";
  return "Unknown";
}

function eligibilityFor(
  ranked: boolean,
  unpriced: boolean,
  reasons: readonly DomainRequirementCheck[],
): OptimizerEligibility {
  if (ranked) return "eligible";
  if (unpriced) return "unavailable_pricing";
  const failing = reasons.filter((reason) => reason.status === "unsatisfied" || reason.status === "unknown");
  if (failing.length > 0 && failing.every((reason) => reason.status === "unknown")) {
    return "unknown_evidence";
  }
  return "excluded";
}

function projectModel(
  entry: ModelExplorerEntry,
  candidate: OptimizerCandidate | null,
  excluded: ExcludedCandidate | null,
  eligibility: OptimizerEligibility,
  rank: number | null,
  now: Date,
  workload: { monthlyInputTokens: number; monthlyOutputTokens: number },
  currency: string,
): OptimizerModelResult {
  const checks = candidate
    ? candidate.requirementChecks
    : excluded?.reasons ?? [];
  const cost =
    candidate?.cost ??
    calculateMonthlyCost(entry.pricing.primary, workload, currency);
  const exclusionReason =
    eligibility === "eligible"
      ? null
      : candidate?.costExclusion?.detail ??
        excluded?.reasons.map((reason) => reason.detail).join(" ") ??
        null;

  return {
    identity: projectIdentity(entry),
    rank,
    eligibility,
    eligibilityLabel: optimizerEligibilityLabel(eligibility),
    exclusionReason,
    estimatedMonthlyCost: cost.totalMonthlyCost,
    estimatedMonthlyCostLabel: costLabel(cost.totalMonthlyCost, eligibility),
    currency: cost.currency,
    inputPrice: cost.input.pricePer1MTokens,
    outputPrice: cost.output.pricePer1MTokens,
    contextWindow: entry.capabilities.contextWindow,
    maxOutputTokens: entry.capabilities.maxOutputTokens,
    vision: observedBoolean(entry.capabilities.supportsVision),
    toolCalling: observedBoolean(entry.capabilities.supportsToolCalling),
    lifecycle: projectLifecycle(entry),
    freshness: freshnessFromObservation(entry.freshness.lastVerifiedAt, now, false),
    provenance: newestProvenance(entry) ?? emptyProvenance(),
    requirementChecks: projectChecks(checks, candidate?.costExclusion ?? null),
  };
}

function overlayProviderOptions(entries: readonly ModelExplorerEntry[]) {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const slug = entry.provider.slug === "gemini" ? "google" : entry.provider.slug;
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  return OPTIMIZER_PROVIDER_OPTIONS.map((option) => ({
    ...option,
    count: counts.get(option.value) ?? 0,
  }));
}

function evidenceOf(rows: readonly OptimizerModelResult[]): {
  quality: EvidenceQuality;
  note: string | null;
} {
  if (rows.length === 0) return { quality: "unknown", note: null };
  const qualities = rows.map((row) => row.freshness.quality);
  if (qualities.every((quality) => quality === "unknown")) {
    return { quality: "unknown", note: null };
  }
  if (qualities.some((quality) => quality === "stale") && !qualities.some((quality) => quality === "current")) {
    return {
      quality: "stale",
      note: "Every model below was last observed more than 48 hours ago.",
    };
  }
  if (qualities.some((quality) => quality === "stale")) {
    return {
      quality: "stale",
      note: "Some models below were last observed more than 48 hours ago.",
    };
  }
  return { quality: "current", note: null };
}

function emptyResult(input: OptimizerInput, generatedAt: string, note: string): OptimizerReadModel {
  return {
    input,
    appliedConstraints: appliedConstraintsFromInput(input),
    bestFit: null,
    ranked: [],
    other: [],
    providerOptions: OPTIMIZER_PROVIDER_OPTIONS,
    generatedAt,
    isDemo: false,
    evidenceQuality: "unknown",
    evidenceNote: note,
    emptyReason: note,
  };
}

function rankByContext(models: OptimizerModelResult[]): {
  ranked: OptimizerModelResult[];
  other: OptimizerModelResult[];
} {
  const withContext = models
    .filter((model) => model.eligibility === "eligible" || model.eligibility === "unavailable_pricing")
    .filter((model) => model.contextWindow !== null)
    .sort(
      (left, right) =>
        (right.contextWindow ?? 0) - (left.contextWindow ?? 0) ||
        left.identity.canonicalId.localeCompare(right.identity.canonicalId),
    )
    .map((model, index) => ({
      ...model,
      eligibility: "eligible" as const,
      eligibilityLabel: optimizerEligibilityLabel("eligible"),
      rank: index + 1,
    }));

  const withoutContext = models
    .filter((model) => model.eligibility === "eligible" || model.eligibility === "unavailable_pricing")
    .filter((model) => model.contextWindow === null)
    .map((model) => ({
      ...model,
      eligibility: "unknown_evidence" as const,
      eligibilityLabel: optimizerEligibilityLabel("unknown_evidence"),
      rank: null,
      exclusionReason:
        "Context window has never been observed for this model, so it cannot win a highest-context ranking. Unknown fails closed.",
    }));

  const excluded = models.filter(
    (model) => model.eligibility === "excluded" || model.eligibility === "unknown_evidence",
  );

  return { ranked: withContext, other: [...withoutContext, ...excluded] };
}

function projectResult(
  input: OptimizerInput,
  explorerEntries: readonly ModelExplorerEntry[],
  optimizer: StackOptimizerResult,
  now: Date,
  byContext: boolean,
): OptimizerReadModel {
  const unpricedById = new Map(
    optimizer.eligibleWithoutCost.map((row) => [row.canonicalModelId, row]),
  );
  const rankedById = new Map(optimizer.ranked.map((row) => [row.canonicalModelId, row]));
  const excludedById = new Map(optimizer.excluded.map((row) => [row.canonicalModelId, row]));

  const projected: OptimizerModelResult[] = [];
  for (const entry of explorerEntries) {
    const ranked = rankedById.get(entry.canonicalModelId) ?? null;
    const unpriced = unpricedById.get(entry.canonicalModelId) ?? null;
    const excluded = excludedById.get(entry.canonicalModelId) ?? null;
    const eligibility = eligibilityFor(ranked !== null, unpriced !== null, excluded?.reasons ?? []);
    projected.push(
      projectModel(
        entry,
        ranked ?? unpriced,
        excluded,
        eligibility,
        ranked?.rank ?? null,
        now,
        optimizer.request.workload,
        optimizer.request.currency,
      ),
    );
  }

  const split = byContext
    ? rankByContext(projected)
    : {
        ranked: projected
          .filter((row) => row.eligibility === "eligible")
          .sort((left, right) => (left.rank ?? 999) - (right.rank ?? 999)),
        other: projected.filter((row) => row.eligibility !== "eligible"),
      };

  const evidence = evidenceOf([...split.ranked, ...split.other]);
  const emptyReason =
    split.ranked.length === 0 && split.other.length === 0
      ? optimizer.insufficientEvidence?.detail ?? "No models were returned for these constraints."
      : split.ranked.length === 0
        ? optimizer.insufficientEvidence?.detail ?? null
        : null;

  return {
    input,
    appliedConstraints: appliedConstraintsFromInput(input),
    bestFit: split.ranked[0] ?? null,
    ranked: split.ranked,
    other: split.other,
    providerOptions: overlayProviderOptions(explorerEntries),
    generatedAt: optimizer.generatedAt,
    isDemo: false,
    evidenceQuality: evidence.quality,
    evidenceNote: evidence.note,
    emptyReason,
  };
}

export function createCanonicalOptimizerAdapter(
  deps: CanonicalOptimizerDeps = {},
): OptimizerAdapter {
  const clock = () => deps.now?.() ?? new Date();
  const configured = deps.configured ?? (deps.port ? true : isSupabaseReadConfigured());

  return {
    id: CANONICAL_OPTIMIZER_ADAPTER_ID,
    label: "Canonical stack optimizer",
    async optimize(input: OptimizerInput): Promise<OptimizerReadModel> {
      const generatedAt = clock().toISOString();
      if (!configured) {
        return emptyResult(
          input,
          generatedAt,
          "Live catalog is not configured in this environment.",
        );
      }

      const now = clock();
      const mapped = domainPriority(input.priority);
      const costPriority: DomainPriority =
        mapped === "highest_context" ? "lowest_total_cost" : mapped;

      const optimizer = await optimizeStack(toRequest(input, costPriority), {
        port: deps.port,
        now: () => now,
      });
      const explorer = await getModelExplorer({
        port: deps.port,
        now: () => now,
      });

      return projectResult(input, explorer.entries, optimizer, now, mapped === "highest_context");
    },
  };
}

export function installCanonicalOptimizerAdapter(): void {
  registerDefaultOptimizerAdapter(() => createCanonicalOptimizerAdapter());
}
