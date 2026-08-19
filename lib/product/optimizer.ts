/**
 * The typed seam between Stack Optimizer and whatever backend ranks models.
 *
 * The Optimizer screen is written against this module only. Filter *controls*
 * and the query string are presentation state. Ranking, eligibility, cost
 * estimates and requirement checks are the adapter's job — components never
 * re-derive them.
 *
 * Claude's deterministic optimizer can be dropped in by implementing
 * `OptimizerAdapter` and calling `setOptimizerAdapter`. No component redesign.
 *
 * Two rules make the swap safe:
 *
 * 1. Eligibility is an explicit four-way state. "Unknown evidence" is not
 *    "excluded", and "unavailable pricing" is not "ineligible for the wrong
 *    reason".
 * 2. `boolean | null` capabilities stay tri-state: `null` is Unknown / Not
 *    observed, never "unsupported".
 */

import {
  compareHref,
  type EvidenceQuality,
  type ExplorerFilterOption,
  type FreshnessView,
  type ModelIdentityView,
  type ModelLifecycleView,
  type ObservedBoolean,
} from "./explorer";
import type { ProvenanceView } from "./provenance";

export const OPTIMIZATION_PRIORITIES = [
  "lowest_monthly_cost",
  "lowest_input_price",
  "lowest_output_price",
  "highest_context",
] as const;

export type OptimizationPriority = (typeof OPTIMIZATION_PRIORITIES)[number];

export const REQUIREMENT_CHECK_STATUSES = [
  "pass",
  "fail",
  "unknown",
  "unavailable",
] as const;

export type RequirementCheckStatus = (typeof REQUIREMENT_CHECK_STATUSES)[number];

export const OPTIMIZER_ELIGIBILITIES = [
  "eligible",
  "excluded",
  "unknown_evidence",
  "unavailable_pricing",
] as const;

export type OptimizerEligibility = (typeof OPTIMIZER_ELIGIBILITIES)[number];

/** Presentation-state optimizer controls. Adapters interpret these. */
export interface OptimizerInput {
  monthlyInputTokens: number | null;
  monthlyOutputTokens: number | null;
  minContext: number | null;
  minMaxOutput: number | null;
  visionRequired: boolean;
  toolCallingRequired: boolean;
  /** Provider slugs to include. Empty means no provider constraint. */
  providers: string[];
  activeOnly: boolean;
  priority: OptimizationPriority;
}

export const DEFAULT_OPTIMIZER_INPUT: OptimizerInput = {
  monthlyInputTokens: 10_000_000,
  monthlyOutputTokens: 1_000_000,
  minContext: 128_000,
  minMaxOutput: null,
  visionRequired: false,
  toolCallingRequired: false,
  providers: [],
  activeOnly: true,
  priority: "lowest_monthly_cost",
};

export const OPTIMIZER_PROVIDER_OPTIONS: ExplorerFilterOption[] = [
  { value: "anthropic", label: "Anthropic", count: 0 },
  { value: "openai", label: "OpenAI", count: 0 },
  { value: "google", label: "Google", count: 0 },
  { value: "xai", label: "xAI", count: 0 },
];

export interface RequirementCheck {
  id: string;
  label: string;
  status: RequirementCheckStatus;
  /** Backend-supplied explanation. Unknown must not read as unsupported. */
  detail: string;
}

export interface AppliedConstraint {
  id: string;
  label: string;
  value: string;
}

/**
 * One model as the optimizer backend classified it.
 *
 * Rank and estimated cost are supplied already computed. The UI formats them;
 * it does not calculate them.
 */
export interface OptimizerModelResult {
  identity: ModelIdentityView;
  /** 1-based rank among eligible models. Null when this model is not ranked. */
  rank: number | null;
  eligibility: OptimizerEligibility;
  eligibilityLabel: string;
  exclusionReason: string | null;
  estimatedMonthlyCost: number | null;
  estimatedMonthlyCostLabel: string;
  currency: string | null;
  inputPrice: number | null;
  outputPrice: number | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  vision: ObservedBoolean;
  toolCalling: ObservedBoolean;
  lifecycle: ModelLifecycleView;
  freshness: FreshnessView;
  provenance: ProvenanceView;
  requirementChecks: RequirementCheck[];
}

export interface OptimizerReadModel {
  input: OptimizerInput;
  appliedConstraints: AppliedConstraint[];
  bestFit: OptimizerModelResult | null;
  ranked: OptimizerModelResult[];
  other: OptimizerModelResult[];
  providerOptions: ExplorerFilterOption[];
  generatedAt: string;
  isDemo: boolean;
  evidenceQuality: EvidenceQuality;
  evidenceNote: string | null;
  emptyReason: string | null;
}

export interface OptimizerAdapter {
  readonly id: string;
  readonly label: string;
  optimize(input: OptimizerInput): Promise<OptimizerReadModel>;
}

let installedAdapter: OptimizerAdapter | null = null;
let defaultAdapterFactory: (() => OptimizerAdapter) | null = null;

export function registerDefaultOptimizerAdapter(factory: () => OptimizerAdapter): void {
  defaultAdapterFactory = factory;
}

export function setOptimizerAdapter(adapter: OptimizerAdapter | null): void {
  installedAdapter = adapter;
}

export function getOptimizerAdapter(): OptimizerAdapter {
  if (installedAdapter) return installedAdapter;
  if (!defaultAdapterFactory) {
    throw new Error(
      "No optimizer adapter is installed. Import the fixture adapter or call setOptimizerAdapter().",
    );
  }
  installedAdapter = defaultAdapterFactory();
  return installedAdapter;
}

export function optimizationPriorityLabel(priority: OptimizationPriority): string {
  switch (priority) {
    case "lowest_monthly_cost":
      return "Lowest monthly cost";
    case "lowest_input_price":
      return "Lowest input price";
    case "lowest_output_price":
      return "Lowest output price";
    case "highest_context":
      return "Highest context";
  }
}

export function optimizerEligibilityLabel(eligibility: OptimizerEligibility): string {
  switch (eligibility) {
    case "eligible":
      return "Eligible";
    case "excluded":
      return "Excluded";
    case "unknown_evidence":
      return "Unknown evidence";
    case "unavailable_pricing":
      return "Pricing unavailable";
  }
}

export function requirementCheckStatusLabel(status: RequirementCheckStatus): string {
  switch (status) {
    case "pass":
      return "Pass";
    case "fail":
      return "Fail";
    case "unknown":
      return "Unknown";
    case "unavailable":
      return "Unavailable";
  }
}

function paramGet(
  params: URLSearchParams | Record<string, string | undefined>,
  key: string,
): string | null {
  if (params instanceof URLSearchParams) return params.get(key);
  return params[key] ?? null;
}

function parsePositiveNumber(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

function parseProviders(raw: string | null): string[] {
  if (!raw) return [];
  const allowed = new Set(OPTIMIZER_PROVIDER_OPTIONS.map((option) => option.value));
  const seen = new Set<string>();
  const providers: string[] = [];
  for (const part of raw.split(",")) {
    const value = part.trim().toLowerCase();
    if (!value || !allowed.has(value) || seen.has(value)) continue;
    seen.add(value);
    providers.push(value);
  }
  return providers;
}

function isPriority(value: string): value is OptimizationPriority {
  return (OPTIMIZATION_PRIORITIES as readonly string[]).includes(value);
}

/** Reads optimizer controls out of the URL. Unknown keys are ignored. */
export function optimizerInputFromParams(
  params: URLSearchParams | Record<string, string | undefined>,
): OptimizerInput {
  const priority = paramGet(params, "priority");
  return {
    monthlyInputTokens: parsePositiveNumber(paramGet(params, "inTokens")),
    monthlyOutputTokens: parsePositiveNumber(paramGet(params, "outTokens")),
    minContext: parsePositiveNumber(paramGet(params, "minContext")),
    minMaxOutput: parsePositiveNumber(paramGet(params, "minMaxOutput")),
    visionRequired: paramGet(params, "vision") === "1",
    toolCallingRequired: paramGet(params, "tools") === "1",
    providers: parseProviders(paramGet(params, "providers")),
    activeOnly: paramGet(params, "active") === "1",
    priority: priority && isPriority(priority) ? priority : DEFAULT_OPTIMIZER_INPUT.priority,
  };
}

/**
 * Merges parsed URL state with defaults so a bare `/optimizer` still has a
 * usable starting workload. Explicit empty numeric fields stay empty.
 */
export function optimizerInputWithDefaults(
  parsed: OptimizerInput,
  params: URLSearchParams | Record<string, string | undefined>,
): OptimizerInput {
  const specified = (key: string): boolean => paramGet(params, key) !== null;
  return {
    monthlyInputTokens: specified("inTokens")
      ? parsed.monthlyInputTokens
      : DEFAULT_OPTIMIZER_INPUT.monthlyInputTokens,
    monthlyOutputTokens: specified("outTokens")
      ? parsed.monthlyOutputTokens
      : DEFAULT_OPTIMIZER_INPUT.monthlyOutputTokens,
    minContext: specified("minContext")
      ? parsed.minContext
      : DEFAULT_OPTIMIZER_INPUT.minContext,
    minMaxOutput: specified("minMaxOutput")
      ? parsed.minMaxOutput
      : DEFAULT_OPTIMIZER_INPUT.minMaxOutput,
    visionRequired: parsed.visionRequired,
    toolCallingRequired: parsed.toolCallingRequired,
    providers: parsed.providers,
    activeOnly: specified("active") ? parsed.activeOnly : DEFAULT_OPTIMIZER_INPUT.activeOnly,
    priority: specified("priority") ? parsed.priority : DEFAULT_OPTIMIZER_INPUT.priority,
  };
}

export function optimizerSearchParams(input: OptimizerInput): URLSearchParams {
  const params = new URLSearchParams();
  if (input.monthlyInputTokens !== null) params.set("inTokens", String(input.monthlyInputTokens));
  if (input.monthlyOutputTokens !== null) {
    params.set("outTokens", String(input.monthlyOutputTokens));
  }
  if (input.minContext !== null) params.set("minContext", String(input.minContext));
  if (input.minMaxOutput !== null) params.set("minMaxOutput", String(input.minMaxOutput));
  if (input.visionRequired) params.set("vision", "1");
  if (input.toolCallingRequired) params.set("tools", "1");
  if (input.providers.length > 0) params.set("providers", input.providers.join(","));
  params.set("active", input.activeOnly ? "1" : "0");
  params.set("priority", input.priority);
  return params;
}

export function optimizerHref(input: OptimizerInput = DEFAULT_OPTIMIZER_INPUT): string {
  const query = optimizerSearchParams(input).toString();
  return query ? `/optimizer?${query}` : "/optimizer";
}

export function compareEligibleHref(results: readonly OptimizerModelResult[]): string {
  const ids = results
    .filter((result) => result.eligibility === "eligible")
    .map((result) => result.identity.canonicalId);
  return compareHref(ids);
}

export function toggleOptimizerProvider(
  selected: readonly string[],
  provider: string,
): string[] {
  const value = provider.trim().toLowerCase();
  if (!value) return [...selected];
  if (selected.includes(value)) return selected.filter((item) => item !== value);
  return [...selected, value];
}

/** Presentational labels for the submitted controls. Not a ranking step. */
export function appliedConstraintsFromInput(input: OptimizerInput): AppliedConstraint[] {
  const constraints: AppliedConstraint[] = [];
  if (input.monthlyInputTokens !== null) {
    constraints.push({
      id: "monthly_input",
      label: "Monthly input tokens",
      value: formatTokenCount(input.monthlyInputTokens),
    });
  }
  if (input.monthlyOutputTokens !== null) {
    constraints.push({
      id: "monthly_output",
      label: "Monthly output tokens",
      value: formatTokenCount(input.monthlyOutputTokens),
    });
  }
  if (input.minContext !== null) {
    constraints.push({
      id: "min_context",
      label: "Minimum context",
      value: formatTokenCount(input.minContext),
    });
  }
  if (input.minMaxOutput !== null) {
    constraints.push({
      id: "min_max_output",
      label: "Minimum max output",
      value: formatTokenCount(input.minMaxOutput),
    });
  }
  if (input.visionRequired) {
    constraints.push({ id: "vision", label: "Vision", value: "Required" });
  }
  if (input.toolCallingRequired) {
    constraints.push({ id: "tools", label: "Tool calling", value: "Required" });
  }
  if (input.providers.length > 0) {
    constraints.push({
      id: "providers",
      label: "Providers",
      value: input.providers
        .map(
          (slug) =>
            OPTIMIZER_PROVIDER_OPTIONS.find((option) => option.value === slug)?.label ?? slug,
        )
        .join(", "),
    });
  }
  if (input.activeOnly) {
    constraints.push({ id: "active", label: "Lifecycle", value: "Active only" });
  }
  constraints.push({
    id: "priority",
    label: "Priority",
    value: optimizationPriorityLabel(input.priority),
  });
  return constraints;
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return Number.isInteger(millions) ? `${millions}M` : `${millions.toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    const thousands = tokens / 1_000;
    return Number.isInteger(thousands) ? `${thousands}K` : `${thousands.toFixed(1)}K`;
  }
  return String(tokens);
}
