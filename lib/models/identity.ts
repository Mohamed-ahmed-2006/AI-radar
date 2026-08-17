import type { ModelAliasRow, ModelRow } from "../supabase";

/** Provider-specific comparison key; never exposed as a model identifier. */
export function anthropicModelIdentityKey(modelName: string): string {
  return modelName
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function anthropicModelFamilyKey(modelName: string): string {
  return anthropicModelIdentityKey(modelName).replace(/-\d{8}$/, "");
}

export interface AnthropicModelMatchPlan {
  apiModelId: string;
  model: ModelRow | null;
  createModelName: string | null;
  reason: "alias" | "exact" | "unique_family" | "new";
}

export interface PlanAnthropicModelMatchesOptions {
  /**
   * `throw` keeps authoritative lifecycle ingestion fail-closed: an ambiguous
   * identity must never silently pick a canonical row. `create` is for
   * non-authoritative sources such as pricing, where an ambiguous display name
   * must degrade to its own row rather than abort the whole provider run.
   */
  onAmbiguity?: "throw" | "create";
}

/**
 * API aliases and exact names win. A display-name family match is allowed only
 * when both the remaining existing models and the unresolved part of this
 * collector batch are unambiguous.
 *
 * Resolution happens in two passes so that a model already claimed by an alias
 * or an exact name cannot also act as the family candidate for a *different*
 * incoming identifier. Without that, a second dated sibling of an already
 * known model (`claude-3-5-sonnet-20241022` arriving next to the persisted
 * `claude-3-5-sonnet-20240620`) would be reported as ambiguous forever.
 */
export function planAnthropicModelMatches(
  apiModelIds: readonly string[],
  models: readonly ModelRow[],
  aliases: readonly ModelAliasRow[],
  options: PlanAnthropicModelMatchesOptions = {},
): AnthropicModelMatchPlan[] {
  const onAmbiguity = options.onAmbiguity ?? "throw";
  const modelById = new Map(models.map((model) => [model.id, model]));
  const aliasToModel = new Map(
    aliases
      .filter((alias) => alias.alias_type === "api_model_id")
      .map((alias) => [anthropicModelIdentityKey(alias.alias), modelById.get(alias.model_id)]),
  );
  const exactModels = new Map<string, ModelRow[]>();
  for (const model of models) {
    const exact = anthropicModelIdentityKey(model.model_name);
    exactModels.set(exact, [...(exactModels.get(exact) ?? []), model]);
  }

  // Pass 1 — identity-grade matches, which also consume their model rows.
  const resolved = new Map<string, AnthropicModelMatchPlan>();
  const consumedModelIds = new Set<string>();
  for (const apiModelId of apiModelIds) {
    const exactKey = anthropicModelIdentityKey(apiModelId);
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

  // Pass 2 — family fallback, over what pass 1 left unclaimed on both sides.
  const familyModels = new Map<string, ModelRow[]>();
  for (const model of models) {
    if (consumedModelIds.has(model.id)) continue;
    const family = anthropicModelFamilyKey(model.model_name);
    familyModels.set(family, [...(familyModels.get(family) ?? []), model]);
  }
  const unresolvedFamilyCounts = new Map<string, number>();
  for (const apiModelId of apiModelIds) {
    if (resolved.has(apiModelId)) continue;
    const family = anthropicModelFamilyKey(apiModelId);
    unresolvedFamilyCounts.set(family, (unresolvedFamilyCounts.get(family) ?? 0) + 1);
  }

  return apiModelIds.map((apiModelId) => {
    const alreadyResolved = resolved.get(apiModelId);
    if (alreadyResolved) return alreadyResolved;
    const exactKey = anthropicModelIdentityKey(apiModelId);
    const exact = (exactModels.get(exactKey) ?? []).filter(
      (model) => !consumedModelIds.has(model.id),
    );
    const family = anthropicModelFamilyKey(apiModelId);
    const familyMatches = familyModels.get(family) ?? [];
    if (familyMatches.length === 1 && unresolvedFamilyCounts.get(family) === 1) {
      return {
        apiModelId,
        model: familyMatches[0],
        createModelName: null,
        reason: "unique_family",
      };
    }
    if (exact.length > 0 || familyMatches.length > 0) {
      if (onAmbiguity === "throw") {
        throw new Error(
          `Ambiguous Anthropic model identity for ${apiModelId}; refusing to create a duplicate`,
        );
      }
      return { apiModelId, model: null, createModelName: apiModelId, reason: "new" };
    }
    return { apiModelId, model: null, createModelName: apiModelId, reason: "new" };
  });
}
