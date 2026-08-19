/**
 * Requirement evaluation: does one canonical model satisfy one request?
 *
 * Every predicate here fails closed. A requirement whose evidence was never
 * collected produces `unknown`, and `unknown` is not eligible — the optimizer
 * would otherwise recommend a model for vision work on the strength of nobody
 * having said it lacks vision. The mirror rule is the explorer's: a `false`
 * requirement is no requirement at all, so `visionRequired: false` matches
 * every model including the ones whose vision support is unobserved.
 *
 * Checks are emitted for every requirement in a fixed order, including the
 * ones the caller did not impose (`not_applicable`). A caller reading the
 * response can therefore see the full requirement sheet for each model rather
 * than only the constraints that happened to bite.
 */

import type { ModelExplorerEntry } from "../explorer/types";
import { normalizeProviderSlug } from "../intelligence/query-engine";
import type {
  NormalizedStackOptimizerRequest,
  RequirementCheck,
  StackOptimizerRequest,
} from "./types";

const DEFAULT_CURRENCY = "USD";

function cleanList(values: readonly string[] | undefined): string[] {
  if (!values) return [];
  return [
    ...new Set(
      values.map((value) => value.trim()).filter((value) => value.length > 0),
    ),
  ].sort();
}

function nonNegativeInteger(value: number | undefined): number | null {
  if (value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function tokenCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/** Applies defaults once, so every downstream stage reads the same request. */
export function normalizeRequest(
  request: StackOptimizerRequest,
): NormalizedStackOptimizerRequest {
  return {
    workload: {
      monthlyInputTokens: tokenCount(request.workload?.monthlyInputTokens),
      monthlyOutputTokens: tokenCount(request.workload?.monthlyOutputTokens),
    },
    minContextWindow: nonNegativeInteger(request.minContextWindow),
    minMaxOutputTokens: nonNegativeInteger(request.minMaxOutputTokens),
    visionRequired: request.visionRequired === true,
    toolCallingRequired: request.toolCallingRequired === true,
    providers: cleanList(request.providers),
    activeOnly: request.activeOnly === true,
    excludeModelIds: cleanList(request.excludeModelIds),
    excludeProviders: cleanList(request.excludeProviders),
    priority: request.priority ?? "lowest_total_cost",
    limit:
      request.limit !== undefined && Number.isFinite(request.limit) && request.limit > 0
        ? Math.floor(request.limit)
        : null,
    currency: (request.currency ?? DEFAULT_CURRENCY).trim().toUpperCase() || DEFAULT_CURRENCY,
  };
}

/**
 * Provider matching accepts the canonical slug and the well-known aliases the
 * rest of the product already normalises (`claude` for Anthropic, `google` for
 * Gemini). Matching on the raw slug alone would silently drop a provider whose
 * catalog slug and colloquial name differ.
 */
export function providerMatches(
  slug: string,
  allowed: readonly string[],
): boolean {
  if (allowed.length === 0) return false;
  const raw = slug.trim().toLowerCase();
  const normalized = normalizeProviderSlug(slug);
  return allowed.some((candidate) => {
    const candidateRaw = candidate.trim().toLowerCase();
    return (
      candidateRaw === raw ||
      normalizeProviderSlug(candidate) === normalized
    );
  });
}

/** A floor is cleared only by an observation that is at least as large. */
function floorCheck(
  requirement: RequirementCheck["requirement"],
  label: string,
  observed: number | null,
  floor: number | null,
): RequirementCheck {
  if (floor === null) {
    return {
      requirement,
      label,
      required: null,
      observed,
      status: "not_applicable",
      domain: "capability",
      detail: `No ${label.toLowerCase()} floor was requested.`,
    };
  }
  if (observed === null) {
    return {
      requirement,
      label,
      required: floor,
      observed: null,
      status: "unknown",
      domain: "capability",
      detail:
        `${label} has never been observed for this model, so it cannot clear the ` +
        `floor of ${floor}. Unknown fails closed.`,
    };
  }
  return {
    requirement,
    label,
    required: floor,
    observed,
    status: observed >= floor ? "satisfied" : "unsatisfied",
    domain: "capability",
    detail:
      observed >= floor
        ? `Observed ${label.toLowerCase()} ${observed} meets the floor of ${floor}.`
        : `Observed ${label.toLowerCase()} ${observed} is below the floor of ${floor}.`,
  };
}

/** A capability requirement is satisfied only by an explicit `true`. */
function capabilityCheck(
  requirement: RequirementCheck["requirement"],
  label: string,
  observed: boolean | null,
  required: boolean,
): RequirementCheck {
  if (!required) {
    return {
      requirement,
      label,
      required: false,
      observed,
      status: "not_applicable",
      domain: "capability",
      detail: `${label} was not required.`,
    };
  }
  if (observed === null) {
    return {
      requirement,
      label,
      required: true,
      observed: null,
      status: "unknown",
      domain: "capability",
      detail:
        `${label} support has never been observed for this model. Unknown fails ` +
        `closed, so the model is not eligible.`,
    };
  }
  return {
    requirement,
    label,
    required: true,
    observed,
    status: observed ? "satisfied" : "unsatisfied",
    domain: "capability",
    detail: observed
      ? `${label} support is observed as true.`
      : `${label} support is observed as false.`,
  };
}

/**
 * The full requirement sheet for one model, in a fixed order.
 *
 * Lifecycle is judged on observed end of life only. A model whose lifecycle
 * nobody publishes is not thereby retired — that is the explorer rule, and
 * changing it here would make "active only" mean two different things on two
 * screens reading the same evidence.
 */
export function evaluateRequirements(
  entry: ModelExplorerEntry,
  request: NormalizedStackOptimizerRequest,
): RequirementCheck[] {
  const checks: RequirementCheck[] = [];

  checks.push(
    request.providers.length === 0
      ? {
          requirement: "provider_allowed",
          label: "Provider allowed",
          required: null,
          observed: entry.provider.slug,
          status: "not_applicable",
          domain: null,
          detail: "No provider constraint was requested.",
        }
      : {
          requirement: "provider_allowed",
          label: "Provider allowed",
          required: request.providers.join(", "),
          observed: entry.provider.slug,
          status: providerMatches(entry.provider.slug, request.providers)
            ? "satisfied"
            : "unsatisfied",
          domain: null,
          detail: `Requested providers: ${request.providers.join(", ")}.`,
        },
  );

  checks.push(
    request.excludeProviders.length === 0
      ? {
          requirement: "provider_not_excluded",
          label: "Provider not excluded",
          required: null,
          observed: entry.provider.slug,
          status: "not_applicable",
          domain: null,
          detail: "No provider exclusions were requested.",
        }
      : {
          requirement: "provider_not_excluded",
          label: "Provider not excluded",
          required: request.excludeProviders.join(", "),
          observed: entry.provider.slug,
          status: providerMatches(entry.provider.slug, request.excludeProviders)
            ? "unsatisfied"
            : "satisfied",
          domain: null,
          detail: `Excluded providers: ${request.excludeProviders.join(", ")}.`,
        },
  );

  checks.push(
    request.excludeModelIds.length === 0
      ? {
          requirement: "model_not_excluded",
          label: "Model not excluded",
          required: null,
          observed: entry.canonicalModelId,
          status: "not_applicable",
          domain: null,
          detail: "No model exclusions were requested.",
        }
      : {
          requirement: "model_not_excluded",
          label: "Model not excluded",
          required: request.excludeModelIds.join(", "),
          observed: entry.canonicalModelId,
          status: request.excludeModelIds.includes(entry.canonicalModelId)
            ? "unsatisfied"
            : "satisfied",
          domain: null,
          detail: `Excluded canonical model ids: ${request.excludeModelIds.join(", ")}.`,
        },
  );

  checks.push(
    request.activeOnly
      ? {
          requirement: "lifecycle_active",
          label: "Not end of life",
          required: true,
          observed: entry.lifecycle.state,
          status: entry.lifecycle.endOfLife ? "unsatisfied" : "satisfied",
          domain: "lifecycle",
          detail: entry.lifecycle.endOfLife
            ? `Lifecycle evidence reports this model as ${entry.lifecycle.state}.`
            : "No lifecycle source reports this model as deprecated or retired.",
        }
      : {
          requirement: "lifecycle_active",
          label: "Not end of life",
          required: null,
          observed: entry.lifecycle.state,
          status: "not_applicable",
          domain: "lifecycle",
          detail: "Retired and deprecated models were not excluded.",
        },
  );

  checks.push(
    floorCheck(
      "min_context_window",
      "Context window",
      entry.capabilities.contextWindow,
      request.minContextWindow,
    ),
  );
  checks.push(
    floorCheck(
      "min_max_output_tokens",
      "Max output tokens",
      entry.capabilities.maxOutputTokens,
      request.minMaxOutputTokens,
    ),
  );
  checks.push(
    capabilityCheck(
      "vision",
      "Vision",
      entry.capabilities.supportsVision,
      request.visionRequired,
    ),
  );
  checks.push(
    capabilityCheck(
      "tool_calling",
      "Tool calling",
      entry.capabilities.supportsToolCalling,
      request.toolCallingRequired,
    ),
  );

  return checks;
}

/** Eligible means every imposed requirement is satisfied. Unknown is not. */
export function isEligible(checks: readonly RequirementCheck[]): boolean {
  return checks.every(
    (check) => check.status === "satisfied" || check.status === "not_applicable",
  );
}

/** The checks that kept a model out, in requirement order. Never just one. */
export function failingChecks(
  checks: readonly RequirementCheck[],
): RequirementCheck[] {
  return checks.filter(
    (check) => check.status === "unsatisfied" || check.status === "unknown",
  );
}
