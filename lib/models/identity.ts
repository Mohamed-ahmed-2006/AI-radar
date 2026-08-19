import type { ModelAliasRow, ModelRow } from "../supabase";

function normalizedIdentityKey(modelName: string): string {
  return modelName
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/^models\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

/** Provider-specific comparison key; never exposed as a model identifier. */
export function anthropicModelIdentityKey(modelName: string): string {
  return normalizedIdentityKey(modelName);
}

export function anthropicModelFamilyKey(modelName: string): string {
  return anthropicModelIdentityKey(modelName).replace(/-\d{8}$/, "");
}

export function geminiModelIdentityKey(modelName: string): string {
  return normalizedIdentityKey(modelName);
}

/**
 * Only numbered stable revisions get a family fallback. Preview/experimental
 * suffixes and their dates remain part of identity so distinct variants can
 * never collapse merely because their names look related.
 */
export function geminiModelFamilyKey(modelName: string): string {
  const key = geminiModelIdentityKey(modelName);
  if (/(?:^|-)(?:preview|exp|experimental)(?:-|$)/.test(key)) return key;
  return key.replace(/-\d{3}$/, "");
}

export function openAiModelIdentityKey(modelName: string): string {
  return normalizedIdentityKey(modelName);
}

/**
 * Strips snapshot dates (e.g. gpt-4o-2024-08-06 -> gpt-4o), but preserves
 * distinct variants like mini, nano, audio, realtime, preview.
 */
export function openAiModelFamilyKey(modelName: string): string {
  const key = openAiModelIdentityKey(modelName);
  return key.replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-\d{8}$/, "");
}

export function xaiModelIdentityKey(modelName: string): string {
  return normalizedIdentityKey(modelName);
}

/**
 * Strips release dates (e.g. grok-4.20-0309 -> grok-4.20), but preserves
 * distinct variants like reasoning, non-reasoning, multi-agent, build.
 */
export function xaiModelFamilyKey(modelName: string): string {
  const key = xaiModelIdentityKey(modelName);
  return key.replace(/-\d{4}$/, "").replace(/-\d{8}$/, "");
}

export interface ModelMatchPlan {
  apiModelId: string;
  model: ModelRow | null;
  createModelName: string | null;
  reason: "alias" | "exact" | "unique_family" | "new";
}

export type AnthropicModelMatchPlan = ModelMatchPlan;
export type GeminiModelMatchPlan = ModelMatchPlan;
export type OpenAiModelMatchPlan = ModelMatchPlan;
export type XaiModelMatchPlan = ModelMatchPlan;

export interface PlanModelMatchesOptions {
  /** Authoritative sources throw; pricing may safely create its own row. */
  onAmbiguity?: "throw" | "create";
}

export type PlanAnthropicModelMatchesOptions = PlanModelMatchesOptions;

interface IdentityStrategy {
  providerLabel: string;
  exactKey(value: string): string;
  familyKey(value: string): string;
}

/**
 * Shared alias/exact/family planner. Family matching is two-pass and only
 * succeeds when both the remaining canonical rows and incoming identifiers
 * are unique. This is the fail-closed identity machinery used by lifecycle
 * and catalog ingestion for every supported provider.
 */
function planProviderModelMatches(
  apiModelIds: readonly string[],
  models: readonly ModelRow[],
  aliases: readonly ModelAliasRow[],
  strategy: IdentityStrategy,
  options: PlanModelMatchesOptions = {},
): ModelMatchPlan[] {
  const onAmbiguity = options.onAmbiguity ?? "throw";
  const modelById = new Map(models.map((model) => [model.id, model]));
  const aliasToModel = new Map(
    aliases
      .filter((alias) => alias.alias_type === "api_model_id")
      .map((alias) => [strategy.exactKey(alias.alias), modelById.get(alias.model_id)]),
  );
  const exactModels = new Map<string, ModelRow[]>();
  for (const model of models) {
    const exact = strategy.exactKey(model.model_name);
    exactModels.set(exact, [...(exactModels.get(exact) ?? []), model]);
  }

  const resolved = new Map<string, ModelMatchPlan>();
  const consumedModelIds = new Set<string>();
  for (const apiModelId of apiModelIds) {
    const exactKey = strategy.exactKey(apiModelId);
    const aliased = aliasToModel.get(exactKey);
    if (aliased) {
      resolved.set(apiModelId, { apiModelId, model: aliased, createModelName: null, reason: "alias" });
      consumedModelIds.add(aliased.id);
      continue;
    }
    const exact = exactModels.get(exactKey) ?? [];
    if (exact.length === 1) {
      resolved.set(apiModelId, { apiModelId, model: exact[0], createModelName: null, reason: "exact" });
      consumedModelIds.add(exact[0].id);
    }
  }

  const familyModels = new Map<string, ModelRow[]>();
  for (const model of models) {
    if (consumedModelIds.has(model.id)) continue;
    const family = strategy.familyKey(model.model_name);
    familyModels.set(family, [...(familyModels.get(family) ?? []), model]);
  }
  const unresolvedFamilyCounts = new Map<string, number>();
  for (const apiModelId of apiModelIds) {
    if (resolved.has(apiModelId)) continue;
    const family = strategy.familyKey(apiModelId);
    unresolvedFamilyCounts.set(family, (unresolvedFamilyCounts.get(family) ?? 0) + 1);
  }

  return apiModelIds.map((apiModelId) => {
    const alreadyResolved = resolved.get(apiModelId);
    if (alreadyResolved) return alreadyResolved;
    const exactKey = strategy.exactKey(apiModelId);
    const exact = (exactModels.get(exactKey) ?? []).filter(
      (model) => !consumedModelIds.has(model.id),
    );
    const family = strategy.familyKey(apiModelId);
    const familyMatches = familyModels.get(family) ?? [];
    if (familyMatches.length === 1 && unresolvedFamilyCounts.get(family) === 1) {
      return { apiModelId, model: familyMatches[0], createModelName: null, reason: "unique_family" };
    }
    if (exact.length > 0 || familyMatches.length > 0) {
      if (onAmbiguity === "throw") {
        throw new Error(
          `Ambiguous ${strategy.providerLabel} model identity for ${apiModelId}; refusing to create a duplicate`,
        );
      }
    }
    return { apiModelId, model: null, createModelName: apiModelId, reason: "new" };
  });
}

export function planAnthropicModelMatches(
  apiModelIds: readonly string[],
  models: readonly ModelRow[],
  aliases: readonly ModelAliasRow[],
  options: PlanAnthropicModelMatchesOptions = {},
): AnthropicModelMatchPlan[] {
  return planProviderModelMatches(apiModelIds, models, aliases, {
    providerLabel: "Anthropic",
    exactKey: anthropicModelIdentityKey,
    familyKey: anthropicModelFamilyKey,
  }, options);
}

export function planGeminiModelMatches(
  apiModelIds: readonly string[],
  models: readonly ModelRow[],
  aliases: readonly ModelAliasRow[],
  options: PlanModelMatchesOptions = {},
): GeminiModelMatchPlan[] {
  return planProviderModelMatches(apiModelIds, models, aliases, {
    providerLabel: "Gemini",
    exactKey: geminiModelIdentityKey,
    familyKey: geminiModelFamilyKey,
  }, options);
}

export function planOpenAiModelMatches(
  apiModelIds: readonly string[],
  models: readonly ModelRow[],
  aliases: readonly ModelAliasRow[],
  options: PlanModelMatchesOptions = {},
): OpenAiModelMatchPlan[] {
  return planProviderModelMatches(apiModelIds, models, aliases, {
    providerLabel: "OpenAI",
    exactKey: openAiModelIdentityKey,
    familyKey: openAiModelFamilyKey,
  }, options);
}

export function planXaiModelMatches(
  apiModelIds: readonly string[],
  models: readonly ModelRow[],
  aliases: readonly ModelAliasRow[],
  options: PlanModelMatchesOptions = {},
): XaiModelMatchPlan[] {
  return planProviderModelMatches(apiModelIds, models, aliases, {
    providerLabel: "xAI",
    exactKey: xaiModelIdentityKey,
    familyKey: xaiModelFamilyKey,
  }, options);
}

export function planCatalogModelMatches(
  providerSlug: "openai" | "anthropic" | "gemini" | "xai",
  apiModelIds: readonly string[],
  models: readonly ModelRow[],
  aliases: readonly ModelAliasRow[],
  options: PlanModelMatchesOptions = {},
): ModelMatchPlan[] {
  switch (providerSlug) {
    case "openai":
      return planOpenAiModelMatches(apiModelIds, models, aliases, options);
    case "anthropic":
      return planAnthropicModelMatches(apiModelIds, models, aliases, options);
    case "gemini":
      return planGeminiModelMatches(apiModelIds, models, aliases, options);
    case "xai":
      return planXaiModelMatches(apiModelIds, models, aliases, options);
  }
}
