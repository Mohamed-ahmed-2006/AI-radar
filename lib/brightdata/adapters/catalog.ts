import {
  normalizeExactTokenCount,
  normalizeModalities,
  RawAnthropicCatalogRecordSchema,
  RawGeminiCatalogRecordSchema,
  RawOpenAiCatalogRecordSchema,
  RawXaiCatalogRecordSchema,
  type NormalizedCatalogRecord,
} from "../../contracts";


/**
 * Adapter for OpenAI model catalog records.
 */
export function adaptOpenAiCatalogRecord(
  raw: unknown,
  sourceUrl: string,
  collectorId: string | null = null,
  collectedAt: string | null = null,
): NormalizedCatalogRecord {
  const parsed = RawOpenAiCatalogRecordSchema.parse(raw);
  const contextWindow = normalizeExactTokenCount(parsed.context_window_raw);
  const maxOutputTokens = normalizeExactTokenCount(parsed.max_output_tokens_raw);

  const inputModalities = normalizeModalities(parsed.input_modalities);
  const outputModalities = normalizeModalities(parsed.output_modalities);

  // 3-state boolean semantics:
  // true if explicitly documented or present in input modalities / features
  // false if explicitly negated or unstated with authoritative absence
  // null if unstated/unknown
  let supportsVision: boolean | null = null;
  if (parsed.supports_vision !== undefined && parsed.supports_vision !== null) {
    supportsVision = parsed.supports_vision;
  } else if (inputModalities.includes("image")) {
    supportsVision = true;
  } else if (parsed.supported_features?.some((f) => /vision|image/i.test(f))) {
    supportsVision = true;
  }

  let supportsToolCalling: boolean | null = null;
  if (
    parsed.supports_function_calling !== undefined &&
    parsed.supports_function_calling !== null
  ) {
    supportsToolCalling = parsed.supports_function_calling;
  } else if (
    parsed.supported_features?.some((f) => /function_calling|tool/i.test(f))
  ) {
    supportsToolCalling = true;
  }

  let modelFamily: string | null = null;
  const idLower = parsed.model_id.toLowerCase();
  if (idLower.startsWith("gpt-5")) modelFamily = "GPT-5";
  else if (idLower.startsWith("gpt-4")) modelFamily = "GPT-4";
  else if (idLower.startsWith("o1") || idLower.startsWith("o3") || idLower.startsWith("o4")) modelFamily = "o-series";
  else if (idLower.startsWith("dall-e") || idLower.startsWith("gpt-image")) modelFamily = "Image";
  else if (idLower.startsWith("whisper") || idLower.startsWith("tts")) modelFamily = "Audio";

  const isPreview = /preview/i.test(parsed.model_id);
  const modelStage = isPreview ? "preview" : "ga";

  return {
    provider: "OpenAI",
    providerSlug: "openai",
    apiModelId: parsed.model_id,
    displayName: parsed.display_name ?? parsed.model_id,
    modelFamily,
    modelStage,
    contextWindow,
    maxOutputTokens,
    supportsVision,
    supportsToolCalling,
    inputModalities,
    outputModalities,
    supportedFeatures: parsed.supported_features ?? [],
    rawEvidence: parsed as unknown as Record<string, unknown>,
    provenance: {
      collectorId,
      collectedAt,
      sourceUrl: parsed.source_url ?? sourceUrl,
    },
  };
}

/**
 * Adapter for Anthropic model catalog records.
 */
export function adaptAnthropicCatalogRecord(
  raw: unknown,
  sourceUrl: string,
  collectorId: string | null = null,
  collectedAt: string | null = null,
): NormalizedCatalogRecord {
  const parsed = RawAnthropicCatalogRecordSchema.parse(raw);
  const contextWindow = normalizeExactTokenCount(parsed.context_window_raw);
  const maxOutputTokens = normalizeExactTokenCount(parsed.max_output_tokens_raw);

  const inputModalities = normalizeModalities(parsed.input_modalities);
  const outputModalities = normalizeModalities(parsed.output_modalities);

  let supportsVision: boolean | null = null;
  if (parsed.supports_vision !== undefined && parsed.supports_vision !== null) {
    supportsVision = parsed.supports_vision;
  } else if (inputModalities.includes("image")) {
    supportsVision = true;
  }

  let supportsToolCalling: boolean | null = null;
  if (parsed.supports_tool_use !== undefined && parsed.supports_tool_use !== null) {
    supportsToolCalling = parsed.supports_tool_use;
  }

  let modelFamily: string | null = parsed.model_family ?? null;
  if (!modelFamily) {
    const idLower = parsed.api_model_id.toLowerCase();
    if (idLower.includes("opus")) modelFamily = "Claude Opus";
    else if (idLower.includes("sonnet")) modelFamily = "Claude Sonnet";
    else if (idLower.includes("haiku")) modelFamily = "Claude Haiku";
    else if (idLower.includes("fable")) modelFamily = "Claude Fable";
    else if (idLower.includes("mythos")) modelFamily = "Claude Mythos";
  }

  return {
    provider: "Anthropic",
    providerSlug: "anthropic",
    apiModelId: parsed.api_model_id,
    displayName: parsed.display_name ?? parsed.api_model_id,
    modelFamily,
    modelStage: "ga",
    contextWindow,
    maxOutputTokens,
    supportsVision,
    supportsToolCalling,
    inputModalities,
    outputModalities,
    supportedFeatures: [],
    rawEvidence: parsed as unknown as Record<string, unknown>,
    provenance: {
      collectorId,
      collectedAt,
      sourceUrl: parsed.source_url ?? sourceUrl,
    },
  };
}

/**
 * Adapter for Gemini model catalog records.
 */
export function adaptGeminiCatalogRecord(
  raw: unknown,
  sourceUrl: string,
  collectorId: string | null = null,
  collectedAt: string | null = null,
): NormalizedCatalogRecord {
  const parsed = RawGeminiCatalogRecordSchema.parse(raw);
  const contextWindow = normalizeExactTokenCount(parsed.context_window_raw);
  const maxOutputTokens = normalizeExactTokenCount(parsed.max_output_tokens_raw);

  const inputModalities = normalizeModalities(parsed.input_modalities);
  const outputModalities = normalizeModalities(parsed.output_modalities);

  let supportsVision: boolean | null = null;
  if (parsed.supports_vision !== undefined && parsed.supports_vision !== null) {
    supportsVision = parsed.supports_vision;
  } else if (inputModalities.includes("image")) {
    supportsVision = true;
  }

  let supportsToolCalling: boolean | null = null;
  if (
    parsed.supports_function_calling !== undefined &&
    parsed.supports_function_calling !== null
  ) {
    supportsToolCalling = parsed.supports_function_calling;
  } else if (
    parsed.supported_features?.some((f) => /function_calling|tool/i.test(f))
  ) {
    supportsToolCalling = true;
  }

  const isPreview = /preview|exp|experimental/i.test(parsed.model_id);
  const modelStage = isPreview ? "preview" : "stable";

  return {
    provider: "Google",
    providerSlug: "gemini",
    apiModelId: parsed.model_id,
    displayName: parsed.display_name ?? parsed.model_id,
    modelFamily: parsed.model_group ?? "Gemini",
    modelStage,
    contextWindow,
    maxOutputTokens,
    supportsVision,
    supportsToolCalling,
    inputModalities,
    outputModalities,
    supportedFeatures: parsed.supported_features ?? [],
    rawEvidence: parsed as unknown as Record<string, unknown>,
    provenance: {
      collectorId,
      collectedAt,
      sourceUrl: parsed.source_url ?? sourceUrl,
    },
  };
}

/**
 * Adapter for xAI model catalog records.
 */
export function adaptXaiCatalogRecord(
  raw: unknown,
  sourceUrl: string,
  collectorId: string | null = null,
  collectedAt: string | null = null,
): NormalizedCatalogRecord {
  const parsed = RawXaiCatalogRecordSchema.parse(raw);
  const contextWindow = normalizeExactTokenCount(parsed.max_prompt_length);

  const inputModalities = normalizeModalities(parsed.input_modalities);
  const outputModalities = normalizeModalities(parsed.output_modalities);

  let supportsVision: boolean | null = null;
  if (inputModalities.length > 0) {
    supportsVision = inputModalities.includes("image");
  }

  let supportsToolCalling: boolean | null = null;
  if (parsed.features?.functionCalling !== undefined) {
    supportsToolCalling = parsed.features.functionCalling;
  }

  const supportedFeatures: string[] = [];
  if (parsed.features?.functionCalling) supportedFeatures.push("functionCalling");
  if (parsed.features?.structuredOutputs) supportedFeatures.push("structuredOutputs");
  if (parsed.features?.reasoning) supportedFeatures.push("reasoning");

  let modelFamily = "Grok";
  if (parsed.name.toLowerCase().startsWith("grok-build")) modelFamily = "Grok Build";
  else if (parsed.name.toLowerCase().startsWith("grok-imagine")) modelFamily = "Grok Imagine";

  const isPreview = /preview|beta|exp|experimental/i.test(parsed.name);
  const modelStage = isPreview ? "preview" : "ga";

  return {
    provider: "xAI",
    providerSlug: "xai",
    apiModelId: parsed.name,
    displayName: parsed.name,
    modelFamily,
    modelStage,
    contextWindow,
    maxOutputTokens: null, // xAI publishes prompt length rather than a hard output limit in this table
    supportsVision,
    supportsToolCalling,
    inputModalities,
    outputModalities,
    supportedFeatures,
    rawEvidence: parsed as unknown as Record<string, unknown>,
    provenance: {
      collectorId,
      collectedAt,
      sourceUrl: parsed.source_url ?? sourceUrl,
    },
  };
}
